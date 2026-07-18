import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const enc=new TextEncoder(),dec=new TextDecoder();
function unb64(v:string){return Uint8Array.from(atob(v),c=>c.charCodeAt(0));}
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
function label(value:any){return value?.ar||value?.fr||value?.en||value||'';}
function profileNo(value:any){const match=String(value||'').match(/\d+/);return match?Number(match[0]):9999;}
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
    const input=f?.customer_input||{};
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
  const [{data:accounts},{data:slots},{data:allocations}]=await Promise.all([
    db.from('inventory_accounts').select('id,service_id,label,encrypted_credentials,capacity,status,expires_at,created_at').order('created_at'),
    db.from('inventory_slots').select('id,account_id,label,encrypted_secret,status,created_at').order('created_at'),
    db.from('fulfillment_allocations').select('id,account_id,slot_id,starts_at,ends_at,status,admin_notes,sheet_version,fulfillments!inner(order_id,order_item_index,service_id)').order('created_at',{ascending:false}),
  ]);
  const orderIds=[...new Set((allocations||[]).map((a:any)=>a.fulfillments?.order_id).filter(Boolean))];
  const {data:orders}=orderIds.length?await db.from('orders').select('id,created_at,customer_info,items,total_payable,status').in('id',orderIds):{data:[]};
  const orderMap=new Map((orders||[]).map((o:any)=>[o.id,o]));
  const allocationBySlot=new Map();
  for(const a of allocations||[])if(a.slot_id&&!allocationBySlot.has(a.slot_id)&&a.status==='active')allocationBySlot.set(a.slot_id,a);
  const accountMap=new Map();
  for(const a of accounts||[])accountMap.set(a.id,{...a,credentials:await decrypt(a.encrypted_credentials)});
  const rows=[];
  for(const slot of slots||[]){
    const account=accountMap.get(slot.account_id);if(!account)continue;
    const secret=await decrypt(slot.encrypted_secret);const allocation=slot.status==='assigned'?allocationBySlot.get(slot.id)||null:null;
    const fulfillment=allocation?.fulfillments||{};const order=orderMap.get(fulfillment.order_id)||null;
    const item=order?.items?.[Number(fulfillment.order_item_index||0)]||{};const customer=order?.customer_info||{};
    rows.push({
      service_id:account.service_id,account_id:account.id,account_label:account.label,account_status:account.status,
      account_created_at:account.created_at,slot_created_at:slot.created_at,
      slot_id:slot.id,slot_status:slot.status,profile:slot.label,pin:secret.pin||secret.code||'',
      account_email:account.credentials.email||'',password:account.credentials.password||'',
      allocation_id:allocation?.id||'',order_id:allocation?order?.id||'':'',sheet_version:allocation?.sheet_version||0,
      order_created_at:allocation?order?.created_at||'':'',client_name:allocation?[customer.first_name||customer.firstname,customer.last_name||customer.lastname].filter(Boolean).join(' '):'',
      duration:label(item.durLabelData)||item.durLabel||'',ends_at:allocation?.ends_at||'',
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
    const {data}=await db.from('fulfillments').select('order_id,updated_at').eq('mode','manual_activation').order('updated_at',{ascending:false}).limit(max);
    return uniqueOrderEvents(data||[],`scope:${normalized}`,max);
  }
  if(normalized==='problems'){
    const {data}=await db.from('problem_reports').select('order_id,created_at').order('created_at',{ascending:false}).limit(max);
    return uniqueOrderEvents(data||[],`scope:${normalized}`,max);
  }
  if(normalized==='orders'||normalized==='customers'){
    const {data}=await db.from('orders').select('id,created_at').order('created_at',{ascending:false}).limit(max);
    return uniqueOrderEvents(data||[],`scope:${normalized}`,max);
  }
  const [{data:manualFulfillments},{data:problemRows},{data:recentOrders}]=await Promise.all([
    db.from('fulfillments').select('order_id,updated_at').eq('mode','manual_activation').order('updated_at',{ascending:false}).limit(max),
    db.from('problem_reports').select('order_id,created_at').order('created_at',{ascending:false}).limit(max),
    db.from('orders').select('id,created_at').order('created_at',{ascending:false}).limit(max),
  ]);
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
    let jwtRole='';
    try{jwtRole=JSON.parse(dec.decode(unb64(provided.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))))?.role||'';}catch{/* not a JWT */}
    if(!provided)return new Response('Unauthorized',{status:401});
    if(provided!==service&&!(cron&&provided===cron)&&!['service_role','postgres'].includes(jwtRole))return new Response('Unauthorized',{status:401});
    const webhook=Deno.env.get('GOOGLE_SHEETS_WEBHOOK_URL'),secret=Deno.env.get('GOOGLE_SHEETS_SYNC_SECRET');
    const requestBody=await req.json().catch(()=>({}));
    if(requestBody?.diagnostic===true)return new Response(JSON.stringify({success:true,webhook_configured:!!webhook,secret_configured:!!secret}),{headers:{'Content-Type':'application/json'}});
    if(!webhook||!secret)return new Response(JSON.stringify({success:false,error:'Google Sheets is not configured',missing:[!webhook?'GOOGLE_SHEETS_WEBHOOK_URL':null,!secret?'GOOGLE_SHEETS_SYNC_SECRET':null].filter(Boolean)}),{status:503,headers:{'Content-Type':'application/json'}});
    const db=createClient(url,service);
    const directProblemId=requestBody?.problem_report_id;
    const directOrderId=requestBody?.order_id;
    let directEvents:any[]|null=null;
    if(directProblemId){
      const {data:problem}=await db.from('problem_reports').select('id,order_id').eq('id',directProblemId).maybeSingle();
      if(!problem)return new Response(JSON.stringify({success:false,error:'Problem report not found'}),{status:404,headers:{'Content-Type':'application/json'}});
      directEvents=[{id:null,event_type:'problem_reported',aggregate_id:problem.id,payload:{order_id:problem.order_id,problem_report_id:problem.id},attempts:0}];
    }else if(directOrderId){
      directEvents=[{id:null,event_type:'direct_order_refresh',aggregate_id:directOrderId,payload:{order_id:directOrderId,source:requestBody?.source||'direct'},attempts:0}];
    }else if(requestBody?.full_refresh===true){
      const max=Math.max(3,Math.min(Number(requestBody?.limit||8),20));
      directEvents=await scopedEvents(db,requestBody?.refresh_scope||requestBody?.scope||'all_light',max);
    }
    const {data:events}=directEvents?{data:directEvents}:await db.from('integration_outbox').select('*').in('status',['pending','failed']).lt('attempts',5).order('id').limit(8);
    let sent=0;
    const queue=(events&&events.length)?events:[{id:null,event_type:'inventory_refresh',aggregate_id:'manual-refresh',payload:{inventory:true,source:'manual_refresh'},attempts:0}];
    const includeInventory=requestBody?.include_inventory===true||requestBody?.full_refresh===true||!directEvents;
    const sharedInventory=includeInventory?await inventorySnapshot(db):[];
    const failures:any[]=[];
    for(let idx=0;idx<(queue||[]).length;idx++){
      const ev=queue[idx];
      const orderId=ev.payload?.order_id||ev.aggregate_id;
      const {data:order}=await db.from('orders').select('id,created_at,status,total_payable,payment_method,customer_info,items,fulfillment_status').eq('id',orderId).maybeSingle();
      const {data:allocations}=order?await db.from('fulfillment_allocations').select('id,starts_at,ends_at,status,admin_notes,sheet_version,fulfillments!inner(order_id,service_id,user_id)').eq('fulfillments.order_id',orderId):{data:[]};
      const {data:fulfillments}=order?await db.from('fulfillments').select('id,order_id,order_item_index,service_id,mode,status,quantity,customer_input,delivery_summary,encrypted_delivery,delivered_at,email_status,email_error,updated_at,created_at').eq('order_id',orderId).order('order_item_index'):{data:[]};
      const {data:problems}=order?await db.from('problem_reports').select('*').eq('order_id',orderId).order('created_at',{ascending:false}):{data:[]};
      const problemIds=(problems||[]).map((problem:any)=>problem.id);
      const {data:problemMessages}=problemIds.length?await db.from('problem_messages').select('problem_id,sender_role,message,created_at').in('problem_id',problemIds).order('created_at'):{data:[]};
      const safeFulfillments=(fulfillments||[]).map((f:any)=>({...f,encrypted_delivery:undefined}));
      const payload={secret,event:{id:ev.id,type:ev.event_type,source:ev.payload?.source||requestBody?.source||'',scope:requestBody?.refresh_scope||requestBody?.scope||''},order:order?{...order,customer_info:{first_name:order.customer_info?.first_name,last_name:order.customer_info?.last_name,email:order.customer_info?.email,phone:order.customer_info?.phone,marketing_email_opt_in:!!order.customer_info?.marketing_email_opt_in,marketing_whatsapp_opt_in:!!order.customer_info?.marketing_whatsapp_opt_in}}:null,subscriptions:allocations||[],fulfillments:safeFulfillments,problems:await enrichProblems(problems||[],fulfillments||[],order,problemMessages||[]),problem_messages:problemMessages||[],inventory:idx===0?sharedInventory:[]};
      try{
        const response=await fetch(webhook,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
        const responseText=await response.text();
        let sheetResult:any=null;
        try{sheetResult=JSON.parse(responseText);}catch{/* Apps Script may return plain text on platform errors */}
        if(!response.ok||sheetResult?.success===false)throw new Error(sheetResult?.error||responseText||`Google Sheets webhook failed (${response.status})`);
        const processedAt=new Date().toISOString();
        if(ev.id) {
          await db.from('integration_outbox').update({status:'sent',attempts:(ev.attempts||0)+1,processed_at:processedAt,last_error:null}).eq('id',ev.id);
        } else if(directEvents) {
          if(ev.event_type==='inventory_refresh') {
            const {error:ackInventoryError}=await db.rpc('ops_ack_sheet_snapshot',{p_scope:requestBody?.refresh_scope||requestBody?.scope||'inventory',p_order_id:null});
            if(ackInventoryError)throw ackInventoryError;
          }
          if(order) {
            const {error:ackOrderError}=await db.rpc('ops_ack_sheet_snapshot',{p_scope:requestBody?.refresh_scope||requestBody?.scope||'',p_order_id:order.id});
            if(ackOrderError)throw ackOrderError;
          }
        }
        sent++;
      }catch(e:any){
        failures.push({event:ev.event_type,order_id:orderId,error:String(e?.message||e).slice(0,500)});
        if(ev.id)await db.from('integration_outbox').update({status:'failed',last_error:String(e?.message||e).slice(0,500)}).eq('id',ev.id);
      }
    }
    return new Response(JSON.stringify({success:failures.length===0,processed:queue.length,sent,failed:failures.length,failures}),{status:failures.length?502:200,headers:{'Content-Type':'application/json'}});
  }catch(e:any){return new Response(JSON.stringify({success:false,error:e?.message||String(e)}),{status:500,headers:{'Content-Type':'application/json'}});}
});
