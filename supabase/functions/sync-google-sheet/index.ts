import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const enc=new TextEncoder(),dec=new TextDecoder();
function unb64(v:string){return Uint8Array.from(atob(v),c=>c.charCodeAt(0));}
async function constantTimeEqual(left:string,right:string){
  const [leftHash,rightHash]=await Promise.all([
    crypto.subtle.digest('SHA-256',enc.encode(left)),
    crypto.subtle.digest('SHA-256',enc.encode(right)),
  ]);
  const a=new Uint8Array(leftHash),b=new Uint8Array(rightHash);
  let diff=left.length^right.length;
  for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  return diff===0;
}
async function decrypt(value?:string|null){
  if(!value)return {};
  const raw=Deno.env.get('FULFILLMENT_ENCRYPTION_KEY')||'';
  if(raw.length<32)throw new Error('Inventory encryption is not configured');
  const hash=await crypto.subtle.digest('SHA-256',enc.encode(raw));
  const key=await crypto.subtle.importKey('raw',hash,'AES-GCM',false,['decrypt']);
  const [,iv,cipher]=value.split('.');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},key,unb64(cipher));
  return JSON.parse(dec.decode(plain));
}
async function visibleCustomerInput(value:any){
  if(!value||typeof value!=='object')return {};
  const input={...value};
  if(input.account_password_cipher){
    try{
      const secret=await decrypt(String(input.account_password_cipher));
      input.account_password=String(secret?.password||'');
    }catch(error:any){
      throw new Error(`Unable to decrypt customer account password: ${error?.message||String(error)}`);
    }
    delete input.account_password_cipher;
  }
  return input;
}
function queryError(context:string,error:any){
  return new Error(`${context}: ${error?.message||error?.details||String(error)}`);
}
function requireRows(result:any,context:string){
  if(result?.error)throw queryError(context,result.error);
  if(!Array.isArray(result?.data))throw new Error(`${context}: database returned no row set`);
  return result.data;
}
function requiresOrder(event:any){
  if(event?.payload?.order_id)return true;
  return !['inventory_changed','inventory_refresh','admin_sheet_refresh'].includes(String(event?.event_type||''));
}
function label(value:any){return value?.ar||value?.fr||value?.en||value||'';}
function sheetDate(value:any){return value?String(value).slice(0,10):'';}
function profileNo(value:any){const match=String(value||'').match(/\d+/);return match?Number(match[0]):9999;}
function expiryMeta(value:any){
  if(!value)return {days_remaining:null,expiry_state:'none',expiry_color:'#171717'};
  const days=Math.ceil((new Date(value).getTime()-Date.now())/86400000);
  if(days<0)return {days_remaining:days,expiry_state:'expired',expiry_color:'#5b1111'};
  if(days<=3)return {days_remaining:days,expiry_state:'critical',expiry_color:'#ff4d4d'};
  if(days<=7)return {days_remaining:days,expiry_state:'warning',expiry_color:'#ff9f43'};
  if(days<=14)return {days_remaining:days,expiry_state:'soon',expiry_color:'#ffd166'};
  return {days_remaining:days,expiry_state:'active',expiry_color:'#39ff14'};
}
function itemName(item:any){return label(item?.nameData)||item?.name||item?.title||item?.id||'';}
function deliveryDetails(value:any){
  if(!value)return '';
  if(Array.isArray(value.entries))return value.entries.map((e:any)=>[
    e.email?`email=${e.email}`:'',
    e.password?`password=${e.password}`:'',
    e.profile?`profile=${e.profile}`:'',
    e.pin?`pin=${e.pin}`:'',
    e.code?`code=${e.code}`:'',
  ].filter(Boolean).join(' | ')).join('\n');
  return JSON.stringify(value);
}
async function enrichProblems(problems:any[],fulfillments:any[],order:any,messages:any[]=[]){
  const fulfillmentMap=new Map((fulfillments||[]).map((f:any)=>[f.id,f]));
  const customer=order?.customer_info||{};
  const rows=[];
  for(const p of problems||[]){
    const f=fulfillmentMap.get(p.fulfillment_id)||null;
    const item=(order?.items||[])[Number(f?.order_item_index||0)]||{};
    const delivery=await decrypt(f?.encrypted_delivery);
    const input=await visibleCustomerInput(f?.customer_input);
    rows.push({
      ...p,
      product_name:p.product_name||itemName(item)||f?.service_id||p.service_id||'',
      duration:label(item?.durLabelData)||item?.durLabel||'',
      quantity:item?.qty||f?.quantity||'',
      fulfillment_mode:f?.mode||'',
      fulfillment_status:f?.status||'',
      customer_account_email:input.account_email||'',
      customer_account_password:input.account_password||'',
      customer_note:input.note||'',
      customer_name:p.customer_name||[customer.first_name||customer.firstname,customer.last_name||customer.lastname].filter(Boolean).join(' '),
      customer_email:p.customer_email||customer.email||'',
      customer_phone:p.customer_phone||customer.phone||'',
      delivery_details:deliveryDetails(delivery),
      delivery_summary:f?.delivery_summary||{},
      conversation:(messages||[]).filter((message:any)=>message.problem_id===p.id).map((message:any)=>({sender_role:message.sender_role,message:message.message,created_at:message.created_at})),
    });
  }
  return rows;
}

async function inventorySnapshot(db:any){
  const [accountsResult,slotsResult,allocationsResult,sharedAllocationsResult]=await Promise.all([
    db.from('inventory_accounts').select('id,service_id,label,encrypted_credentials,capacity,pool_kind,status,expires_at,created_at').order('created_at'),
    db.from('inventory_slots').select('id,account_id,label,encrypted_secret,status,max_shared_allocations,created_at').order('created_at'),
    db.from('fulfillment_allocations').select('id,account_id,slot_id,starts_at,ends_at,status,admin_notes,sheet_version,renewal_count,fulfillments!inner(order_id,order_item_index,service_id)').order('created_at',{ascending:false}),
    db.from('shared_profile_allocations').select('id,benefit_id,fulfillment_id,account_id,slot_id,starts_at,ends_at,status,created_at,fulfillments!inner(order_id,order_item_index,service_id)').order('created_at',{ascending:false}),
  ]);
  const accounts=requireRows(accountsResult,'Loading inventory accounts');
  const slots=requireRows(slotsResult,'Loading inventory slots');
  const allocations=requireRows(allocationsResult,'Loading inventory allocations');
  const sharedAllocations=requireRows(sharedAllocationsResult,'Loading shared promotional allocations');
  const orderIds=[...new Set([...(allocations||[]),...(sharedAllocations||[])].map((a:any)=>a.fulfillments?.order_id).filter(Boolean))];
  let orders:any[]=[];
  if(orderIds.length){
    const ordersResult=await db.from('orders').select('id,created_at,customer_info,items,total_payable,status').in('id',orderIds);
    orders=requireRows(ordersResult,'Loading inventory customer orders');
  }
  const orderMap=new Map((orders||[]).map((o:any)=>[o.id,o]));
  const allocationBySlot=new Map();
  for(const a of allocations||[])if(a.slot_id&&!allocationBySlot.has(a.slot_id)&&a.status==='active')allocationBySlot.set(a.slot_id,a);
  const sharedBySlot=new Map();
  for(const allocation of sharedAllocations||[]){
    if(!allocation.slot_id||['released','revoked','cancelled','expired'].includes(String(allocation.status||'').toLowerCase()))continue;
    const sharedEnd=allocation.ends_at?new Date(allocation.ends_at).getTime():Infinity;
    if(Number.isFinite(sharedEnd)&&sharedEnd<=Date.now())continue;
    if(!sharedBySlot.has(allocation.slot_id))sharedBySlot.set(allocation.slot_id,[]);
    sharedBySlot.get(allocation.slot_id).push(allocation);
  }
  const accountMap=new Map();
  for(const a of accounts||[])accountMap.set(a.id,{...a,credentials:await decrypt(a.encrypted_credentials)});
  const rows=[];
  for(const slot of slots||[]){
    const account=accountMap.get(slot.account_id);
    if(!account)throw new Error(`Inventory slot ${slot.id||'unknown'} references a missing account`);
    const secret=await decrypt(slot.encrypted_secret);const allocation=slot.status==='assigned'?allocationBySlot.get(slot.id)||null:null;
    const sharedAssignments=(sharedBySlot.get(slot.id)||[]).map((shared:any)=>{
      const nested=shared.fulfillments||{};
      const sharedOrder=orderMap.get(nested.order_id)||null;
      const sharedItem=sharedOrder?.items?.[Number(nested.order_item_index||0)]||{};
      const sharedCustomer=sharedOrder?.customer_info||{};
      return {
        allocation_id:shared.id,benefit_id:shared.benefit_id||'',order_id:nested.order_id||'',
        customer_name:[sharedCustomer.first_name||sharedCustomer.firstname,sharedCustomer.last_name||sharedCustomer.lastname].filter(Boolean).join(' '),
        customer_email:sharedCustomer.email||'',customer_phone:sharedCustomer.phone||'',duration:label(sharedItem.durLabelData)||sharedItem.durLabel||'',
        starts_at:sheetDate(shared.starts_at),ends_at:sheetDate(shared.ends_at),status:shared.status||''
      };
    });
    const fulfillment=allocation?.fulfillments||{};const order=orderMap.get(fulfillment.order_id)||null;
    if(allocation&&fulfillment.order_id&&!order)throw new Error(`Inventory allocation ${allocation.id||'unknown'} references a missing order`);
    const item=order?.items?.[Number(fulfillment.order_item_index||0)]||{};const customer=order?.customer_info||{};
    rows.push({
      service_id:account.service_id,account_id:account.id,account_label:account.label,account_status:account.status,pool_kind:account.pool_kind||'standard',
      account_created_at:sheetDate(account.created_at),slot_created_at:sheetDate(slot.created_at),
      slot_id:slot.id,slot_status:slot.status,profile:slot.label,pin:secret.pin||secret.code||'',
      max_shared_allocations:slot.max_shared_allocations??'',shared_assignment_count:sharedAssignments.length,shared_assignments:sharedAssignments,
      account_email:account.credentials.email||'',password:account.credentials.password||'',
      allocation_id:allocation?.id||'',order_id:allocation?order?.id||'':'',sheet_version:allocation?.sheet_version||0,renewal_count:Number(allocation?.renewal_count||0),
      order_created_at:allocation?sheetDate(order?.created_at):'',client_name:allocation?[customer.first_name||customer.firstname,customer.last_name||customer.lastname].filter(Boolean).join(' '):'',
      duration:label(item.durLabelData)||item.durLabel||'',ends_at:sheetDate(allocation?.ends_at),...expiryMeta(allocation?.ends_at),
      unit_price:Number(item.unitPrice||item.price||0),pay:allocation?.status==='active'?'paid':'unpaid',
      profile_status:allocation?.status==='active'?(String(allocation?.admin_notes||'').includes('[PROBLEM OPEN]')?'problem':'sold'):slot.status==='available'?'available':slot.status==='maintenance'?'maintenance':slot.status==='disabled'?'disabled':slot.status,
      client_number:allocation?customer.phone||'':'',client_email:allocation?customer.email||'':'',admin_notes:allocation?.admin_notes||''
    });
  }
  rows.sort((a:any,b:any)=>String(a.service_id||'').localeCompare(String(b.service_id||''))||String(a.account_created_at||'').localeCompare(String(b.account_created_at||''))||String(a.account_id||'').localeCompare(String(b.account_id||''))||profileNo(a.profile)-profileNo(b.profile)||String(a.profile||'').localeCompare(String(b.profile||''))||String(a.slot_created_at||'').localeCompare(String(b.slot_created_at||'')));
  return rows;
}

function uniqueOrderEvents(rows:any[], source:string, max:number){
  const seen=new Set<string>();
  const events:any[]=[];
  for(const row of rows||[]){
    const id=String(row?.id||row?.order_id||'').trim();
    if(!id||seen.has(id))continue;
    seen.add(id);
    events.push({id:null,event_type:'full_refresh',aggregate_id:id,payload:{order_id:id,source},attempts:0});
    if(events.length>=max)break;
  }
  return events;
}

async function scopedEvents(db:any, scope:string, max:number){
  const normalized=String(scope||'all_light').toLowerCase();
  if(normalized==='inventory'||normalized==='netflix'||normalized==='netflix_inventory'){
    return [{id:null,event_type:'inventory_refresh',aggregate_id:'inventory-refresh',payload:{inventory:true,source:`scope:${normalized}`},attempts:0}];
  }
  if(normalized==='spotify'||normalized==='activations'){
    const result=await db.from('fulfillments').select('order_id,updated_at').eq('mode','manual_activation').order('updated_at',{ascending:false}).limit(max);
    return uniqueOrderEvents(requireRows(result,'Loading manual activations'),`scope:${normalized}`,max);
  }
  if(normalized==='problems'){
    const result=await db.from('problem_reports').select('order_id,created_at').order('created_at',{ascending:false}).limit(max);
    return uniqueOrderEvents(requireRows(result,'Loading problem reports'),`scope:${normalized}`,max);
  }
  if(normalized==='orders'||normalized==='customers'){
    const result=await db.from('orders').select('id,created_at').order('created_at',{ascending:false}).limit(max);
    return uniqueOrderEvents(requireRows(result,'Loading recent orders'),`scope:${normalized}`,max);
  }
  const [manualResult,problemResult,orderResult]=await Promise.all([
    db.from('fulfillments').select('order_id,updated_at').eq('mode','manual_activation').order('updated_at',{ascending:false}).limit(max),
    db.from('problem_reports').select('order_id,created_at').order('created_at',{ascending:false}).limit(max),
    db.from('orders').select('id,created_at').order('created_at',{ascending:false}).limit(max),
  ]);
  const manualFulfillments=requireRows(manualResult,'Loading manual activations');
  const problemRows=requireRows(problemResult,'Loading problem reports');
  const recentOrders=requireRows(orderResult,'Loading recent orders');
  return uniqueOrderEvents([
    ...(manualFulfillments||[]),
    ...(problemRows||[]),
    ...(recentOrders||[]),
  ],`scope:${normalized}`,max);
}

serve(async req=>{
  try{
    const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,cron=Deno.env.get('SYNC_SECRET')||'';
    const provided=req.headers.get('x-sync-secret')||req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';
    if(!provided)return new Response('Unauthorized',{status:401});
    const [serviceMatch,syncSecretMatch]=await Promise.all([
      constantTimeEqual(provided,service),
      constantTimeEqual(provided,cron),
    ]);
    if(!serviceMatch&&!(cron&&syncSecretMatch))return new Response('Unauthorized',{status:401});
    const webhook=Deno.env.get('GOOGLE_SHEETS_WEBHOOK_URL'),secret=Deno.env.get('GOOGLE_SHEETS_SYNC_SECRET');
    const requestBody=await req.json().catch(()=>({}));
    if(requestBody?.diagnostic===true)return new Response(JSON.stringify({success:true,webhook_configured:!!webhook,secret_configured:!!secret}),{headers:{'Content-Type':'application/json'}});
    if(!webhook||!secret)return new Response(JSON.stringify({success:false,error:'Google Sheets is not configured',missing:[!webhook?'GOOGLE_SHEETS_WEBHOOK_URL':null,!secret?'GOOGLE_SHEETS_SYNC_SECRET':null].filter(Boolean)}),{status:503,headers:{'Content-Type':'application/json'}});
    const db=createClient(url,service);
    const directProblemId=requestBody?.problem_report_id;
    const directOrderId=requestBody?.order_id;
    let directEvents:any[]|null=null;
    if(directProblemId){
      const {data:problem,error:problemError}=await db.from('problem_reports').select('id,order_id').eq('id',directProblemId).maybeSingle();
      if(problemError)throw queryError('Loading requested problem report',problemError);
      if(!problem)return new Response(JSON.stringify({success:false,error:'Problem report not found'}),{status:404,headers:{'Content-Type':'application/json'}});
      directEvents=[{id:null,event_type:'problem_reported',aggregate_id:problem.id,payload:{order_id:problem.order_id,problem_report_id:problem.id},attempts:0}];
    }else if(directOrderId){
      directEvents=[{id:null,event_type:'direct_order_refresh',aggregate_id:directOrderId,payload:{order_id:directOrderId,source:requestBody?.source||'direct'},attempts:0}];
    }else if(requestBody?.full_refresh===true){
      const max=Math.max(3,Math.min(Number(requestBody?.limit||8),20));
      directEvents=await scopedEvents(db,requestBody?.refresh_scope||requestBody?.scope||'all_light',max);
      if(!directEvents.length)directEvents=[{id:null,event_type:'inventory_refresh',aggregate_id:'inventory-refresh',payload:{inventory:true,source:`scope:${requestBody?.refresh_scope||requestBody?.scope||'all_light'}`},attempts:0}];
    }
    const requestedEventKeys=new Set<string>();
    const hadDirectRequest=directEvents!==null;
    if(directEvents){
      const queuedEvents=directEvents.map((event:any)=>{
        requestedEventKeys.add(`${event.event_type}\u0000${event.aggregate_id}`);
        return {
          event_type:event.event_type,
          aggregate_id:String(event.aggregate_id),
          payload:{...(event.payload||{}),direct_refresh:true},
        };
      });
      const {error:enqueueError}=await db.from('integration_outbox').insert(queuedEvents);
      if(enqueueError)throw queryError('Queueing direct Google Sheets refresh',enqueueError);
      directEvents=null;
    }
    const workerId=`sheet-sync:${crypto.randomUUID()}`;
    let events:any[]=directEvents||[];
    if(!directEvents){
      const {data:claimed,error:claimError}=await db.rpc('claim_sheet_outbox',{
        p_worker_id:workerId,
        p_limit:hadDirectRequest?20:8,
        p_lease_seconds:300,
      });
      if(claimError)throw queryError('Claiming Google Sheets outbox',claimError);
      if(claimed!==null&&!Array.isArray(claimed))throw new Error('Claiming Google Sheets outbox: database returned an invalid result');
      events=claimed||[];
    }
    let sent=0;
    let processed=0;
    const queue=events||[];
    if(!queue.length)return new Response(JSON.stringify({success:true,queued:hadDirectRequest,processed:0,sent:0,failed:0,failures:[]}),{status:hadDirectRequest?202:200,headers:{'Content-Type':'application/json'}});
    const includeInventory=requestBody?.include_inventory===true||requestBody?.full_refresh===true||!hadDirectRequest||queue.some((event:any)=>event?.payload?.inventory===true||['inventory_changed','inventory_refresh','admin_sheet_refresh'].includes(String(event?.event_type||'')));
    let sharedInventory:any[]|null=null;
    const failures:any[]=[];
    const completedEventKeys=new Set<string>();
    for(let idx=0;idx<(queue||[]).length;idx++){
      const ev=queue[idx];
      const orderId=ev.payload?.order_id||ev.aggregate_id||'';
      try{
        if(ev.id){
          const {data:renewed,error:renewError}=await db.rpc('renew_sheet_outbox_lease',{p_worker_id:workerId});
          if(renewError)throw queryError('Renewing Google Sheets outbox lease',renewError);
          if(typeof renewed!=='number'||renewed<1)throw new Error('Sheet outbox lease was lost before delivery');
        }

        if(includeInventory&&idx===0)sharedInventory=await inventorySnapshot(db);

        const mustLoadOrder=requiresOrder(ev)||Boolean(ev.payload?.order_id);
        if(mustLoadOrder&&!orderId)throw new Error(`Sheet event ${ev.event_type||'unknown'} is missing its order id`);
        let order:any=null;
        let allocations:any[]=[];
        let fulfillments:any[]=[];
        let problems:any[]=[];
        let problemMessages:any[]=[];
        let benefits:any[]=[];
        let sharedBenefitAllocations:any[]=[];
        if(mustLoadOrder){
          const orderResult=await db.from('orders').select('id,created_at,status,total_payable,payment_method,customer_info,items,fulfillment_status').eq('id',orderId).maybeSingle();
          if(orderResult.error)throw queryError(`Loading order ${orderId}`,orderResult.error);
          order=orderResult.data;
          if(!order)throw new Error(`Order ${orderId} was not found for Sheet event ${ev.event_type||'unknown'}`);

          const [allocationResult,fulfillmentResult,problemResult,benefitResult,sharedBenefitResult]=await Promise.all([
            db.from('fulfillment_allocations').select('id,starts_at,ends_at,status,admin_notes,sheet_version,renewal_count,fulfillments!inner(order_id,service_id,user_id)').eq('fulfillments.order_id',orderId),
            db.from('fulfillments').select('id,order_id,order_item_index,service_id,mode,status,quantity,customer_input,delivery_summary,encrypted_delivery,delivered_at,email_status,email_error,updated_at,created_at').eq('order_id',orderId).order('order_item_index'),
            db.from('problem_reports').select('*').eq('order_id',orderId).order('created_at',{ascending:false}),
            db.from('order_benefits').select('*').eq('order_id',orderId).order('created_at'),
            db.from('shared_profile_allocations').select('id,benefit_id,fulfillment_id,account_id,slot_id,starts_at,ends_at,status,created_at,inventory_accounts(label,service_id),inventory_slots(label),fulfillments!inner(order_id,order_item_index,service_id)').eq('fulfillments.order_id',orderId).order('created_at'),
          ]);
          allocations=requireRows(allocationResult,`Loading subscriptions for order ${orderId}`);
          fulfillments=requireRows(fulfillmentResult,`Loading fulfillments for order ${orderId}`);
          problems=requireRows(problemResult,`Loading problems for order ${orderId}`);
          benefits=requireRows(benefitResult,`Loading promotional gifts for order ${orderId}`);
          sharedBenefitAllocations=requireRows(sharedBenefitResult,`Loading promotional gift assignments for order ${orderId}`);
          const problemIds=problems.map((problem:any)=>problem.id).filter(Boolean);
          if(problemIds.length){
            const messagesResult=await db.from('problem_messages').select('problem_id,sender_role,message,created_at').in('problem_id',problemIds).order('created_at');
            problemMessages=requireRows(messagesResult,`Loading problem conversation for order ${orderId}`);
          }
        }

        const safeFulfillments=await Promise.all(fulfillments.map(async(f:any)=>({
          ...f,
          encrypted_delivery:undefined,
          customer_input:await visibleCustomerInput(f.customer_input)
        })));
        const safeSubscriptions=allocations.map((a:any)=>({...a,...expiryMeta(a.ends_at)}));
        const safeBenefits=benefits.map((benefit:any)=>({
          ...benefit,
          shared_allocations:sharedBenefitAllocations.filter((allocation:any)=>allocation.benefit_id===benefit.id).map((allocation:any)=>({
            id:allocation.id,fulfillment_id:allocation.fulfillment_id,account_id:allocation.account_id,slot_id:allocation.slot_id,
            account_label:allocation.inventory_accounts?.label||'',profile:allocation.inventory_slots?.label||'',
            starts_at:sheetDate(allocation.starts_at),ends_at:sheetDate(allocation.ends_at),status:(allocation.ends_at&&new Date(allocation.ends_at).getTime()<=Date.now())?'expired':allocation.status,created_at:allocation.created_at
          }))
        }));
        const payload={secret,event:{id:ev.id,type:ev.event_type,source:ev.payload?.source||requestBody?.source||'',scope:requestBody?.refresh_scope||requestBody?.scope||''},order:order?{...order,customer_info:{first_name:order.customer_info?.first_name,last_name:order.customer_info?.last_name,email:order.customer_info?.email,phone:order.customer_info?.phone,marketing_email_opt_in:!!order.customer_info?.marketing_email_opt_in,marketing_whatsapp_opt_in:!!order.customer_info?.marketing_whatsapp_opt_in}}:null,subscriptions:safeSubscriptions,fulfillments:safeFulfillments,benefits:safeBenefits,problems:await enrichProblems(problems,fulfillments,order,problemMessages),problem_messages:problemMessages,inventory:idx===0?(sharedInventory||[]):[]};
        const response=await fetch(webhook,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
        const responseText=await response.text();
        if(!response.ok)throw new Error(`Google Sheets webhook failed (${response.status}): ${responseText.trim().slice(0,300)||'empty response'}`);
        let sheetResult:any;
        try{sheetResult=JSON.parse(responseText);}catch{
          throw new Error(`Google Sheets webhook returned invalid JSON: ${responseText.trim().slice(0,300)||'empty response'}`);
        }
        if(!sheetResult||typeof sheetResult!=='object'||Array.isArray(sheetResult)||sheetResult.success!==true){
          throw new Error(String(sheetResult?.error||'Google Sheets webhook did not confirm success').slice(0,500));
        }
        if(ev.id) {
          const {data:completed,error:completeError}=await db.rpc('complete_sheet_outbox',{
            p_event_id:ev.id,
            p_worker_id:workerId,
          });
          if(completeError)throw queryError('Completing Google Sheets outbox event',completeError);
          if(completed!==true)throw new Error('Sheet outbox lease was lost before completion');
        }
        completedEventKeys.add(`${ev.event_type}\u0000${ev.aggregate_id}`);
        sent++;
        processed++;
      }catch(e:any){
        const cleanupErrors:string[]=[];
        const primaryError=String(e?.message||e).slice(0,500);
        processed++;
        if(ev.id){
          const {data:failed,error:failError}=await db.rpc('fail_sheet_outbox',{
            p_event_id:ev.id,
            p_worker_id:workerId,
            p_error:primaryError,
          });
          if(failError)cleanupErrors.push(queryError('Failing Google Sheets outbox event',failError).message);
          else if(failed!==true)cleanupErrors.push('Google Sheets outbox event was no longer owned while recording its failure');
          const {data:released,error:releaseError}=await db.rpc('release_sheet_outbox_lease',{p_worker_id:workerId});
          if(releaseError)cleanupErrors.push(queryError('Releasing Google Sheets outbox lease',releaseError).message);
          else if(typeof released!=='number'||released<0)cleanupErrors.push('Releasing Google Sheets outbox lease returned an invalid result');
          failures.push({event:ev.event_type,order_id:orderId,error:[primaryError,...cleanupErrors].join(' | ').slice(0,1000)});
          break;
        }
        failures.push({event:ev.event_type,order_id:orderId,error:primaryError});
      }
    }
    const requestedStillQueued=hadDirectRequest&&[...requestedEventKeys].some(key=>!completedEventKeys.has(key));
    return new Response(JSON.stringify({success:failures.length===0,queued:requestedStillQueued,processed,sent,failed:failures.length,failures}),{status:failures.length?502:requestedStillQueued?202:200,headers:{'Content-Type':'application/json'}});
  }catch(e:any){return new Response(JSON.stringify({success:false,error:e?.message||String(e)}),{status:500,headers:{'Content-Type':'application/json'}});}
});
