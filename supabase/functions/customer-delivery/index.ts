import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const allowedOrigins=new Set([
  'https://www.striviodz.store',
  'https://striviodz.store',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);
function corsHeaders(req:Request){
  const origin=req.headers.get('origin')||'';
  return {
  'Access-Control-Allow-Origin':allowedOrigins.has(origin)?origin:'https://www.striviodz.store',
  'Vary':'Origin',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json',
  'Cache-Control':'no-store, max-age=0',
  'Pragma':'no-cache',
  'X-Content-Type-Options':'nosniff'
  };
}
const enc=new TextEncoder(),dec=new TextDecoder();
function unb64(v:string){return Uint8Array.from(atob(v),c=>c.charCodeAt(0));}
function b64(v:Uint8Array){return btoa(String.fromCharCode(...v));}
async function encrypt(value:unknown){
  const raw=Deno.env.get('FULFILLMENT_ENCRYPTION_KEY')||'';
  if(raw.length<32)throw new Error('Delivery is not configured');
  const hash=await crypto.subtle.digest('SHA-256',enc.encode(raw));
  const key=await crypto.subtle.importKey('raw',hash,'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(JSON.stringify(value)));
  return `v1.${b64(iv)}.${b64(new Uint8Array(cipher))}`;
}
async function decrypt(value?:string|null){
  if(!value)return null;
  const raw=Deno.env.get('FULFILLMENT_ENCRYPTION_KEY')||'';
  if(raw.length<32)throw new Error('Delivery is not configured');
  const hash=await crypto.subtle.digest('SHA-256',enc.encode(raw));
  const key=await crypto.subtle.importKey('raw',hash,'AES-GCM',false,['decrypt']);
  const [,iv,cipher]=value.split('.');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},key,unb64(cipher));
  return JSON.parse(dec.decode(plain));
}
async function exposeCustomerInput(input:any){
  if(!input||typeof input!=='object')return input||{};
  const visible={...input};
  if(visible.account_password_cipher){
    try{
      const secret=await decrypt(String(visible.account_password_cipher));
      visible.account_password=String(secret?.password||'');
    }catch{
      visible.account_password='';
    }
    delete visible.account_password_cipher;
  }
  return visible;
}

async function ensureFulfilled(db:any,url:string,service:string,order:any){
  if(!['paid','completed'].includes(order.status))return;
  // A crashed worker may leave only part of a paid order behind. The fulfillment
  // worker is idempotent, preserves completed manual activations, and owns an
  // order lease, so the customer portal can safely wake it when it detects a
  // missing item, a recoverable state, or an unpersisted email queue state.
  const {data:rows,error:rowsError}=await db.from('fulfillments')
    .select('id,order_item_index,status,email_status')
    .eq('order_id',order.id);
  if(rowsError)throw rowsError;
  const expectedItems=Array.isArray(order.items)?order.items.length:0;
  const presentIndexes=new Set((rows||[]).map((row:any)=>Number(row.order_item_index)));
  const missingItem=expectedItems>0&&(
    (rows||[]).length!==expectedItems||
    Array.from({length:expectedItems},(_,index)=>index).some(index=>!presentIndexes.has(index))
  );
  const recoverableStatuses=new Set(['pending','processing','failed','out_of_stock']);
  const needsStateRecovery=(rows||[]).some((row:any)=>
    recoverableStatuses.has(String(row.status||'').toLowerCase())
  );
  const finalEmailStatuses=new Set(['sent','delivered','suppressed','dead','cancelled','skipped']);
  const needsEmailRecovery=(rows||[]).some((row:any)=>
    !finalEmailStatuses.has(String(row.email_status||'pending').toLowerCase())
  );
  const emptyOrderNeedsFinalize=expectedItems===0&&order.fulfillment_status!=='delivered';
  const allRowsDelivered=(rows||[]).length>0&&(rows||[]).every((row:any)=>
    ['delivered','completed'].includes(String(row.status||'').toLowerCase())
  );
  const orderSummaryMismatch=allRowsDelivered&&order.fulfillment_status!=='delivered';
  if(!missingItem&&!needsStateRecovery&&!needsEmailRecovery&&!emptyOrderNeedsFinalize&&!orderSummaryMismatch)return;

  const response=await fetch(`${url}/functions/v1/fulfill-order`,{
    method:'POST',
    headers:{Authorization:`Bearer ${service}`,'Content-Type':'application/json'},
    body:JSON.stringify({order_id:order.id})
  }).catch(()=>null);
  if(response)await response.text().catch(()=>null);
}

const RENEWAL_DURATION_LABELS = {
  ar: ['شهر واحد', 'شهران', '3 أشهر', '6 أشهر', 'سنة كاملة'],
  fr: ['1 mois', '2 mois', '3 mois', '6 mois', '1 an'],
  en: ['1 month', '2 months', '3 months', '6 months', '1 year']
};

serve(async req=>{
  const cors=corsHeaders(req);
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
    if(!token)return new Response(JSON.stringify({success:false,error:'Authentication required'}),{status:401,headers:cors});
    const db=createClient(url,service);
    const {data:{user},error:userError}=await db.auth.getUser(token);
    if(userError||!user||!user.email_confirmed_at)return new Response(JSON.stringify({success:false,error:'A verified account is required'}),{status:401,headers:cors});
    const {data:admin}=await db.from('admin_users').select('user_id').eq('user_id',user.id).maybeSingle();
    const isAdmin=!!admin;
    const body=await req.json();
    if(Array.isArray(body?.order_ids)){
      const requested=[...new Set(body.order_ids.map((id:any)=>String(id||'')).filter(Boolean))].slice(0,500);
      if(!requested.length)return new Response(JSON.stringify({success:true,fulfillments:[]}),{headers:cors});
      const {data:requestedOrders,error:requestedOrdersError}=await db.from('orders').select('id,user_id,customer_info').in('id',requested);
      if(requestedOrdersError)throw requestedOrdersError;
      const userEmail=String(user.email||'').trim().toLowerCase();
      const allowed=(requestedOrders||[]).filter((item:any)=>isAdmin||item.user_id===user.id||(
        !item.user_id&&userEmail!==''&&String(item.customer_info?.email||'').trim().toLowerCase()===userEmail
      )).map((item:any)=>item.id);
      const summariesResult=allowed.length?await db.from('fulfillments').select('id,order_id,status,delivery_summary,service_id,mode,quantity,customer_input,delivered_at,updated_at').in('order_id',allowed).order('order_item_index'): {data:[],error:null};
      if(summariesResult.error)throw summariesResult.error;
      const summaries=summariesResult.data;
      const visibleSummaries=await Promise.all((summaries||[]).map(async(row:any)=>({
        ...row,
        customer_input:await exposeCustomerInput(row.customer_input)
      })));
      return new Response(JSON.stringify({success:true,fulfillments:visibleSummaries}),{headers:cors});
    }
    const {order_id}=body;
    let {data:order,error:orderError}=await db.from('orders').select('id,user_id,status,total_payable,items,created_at,fulfillment_status,customer_info').eq('id',order_id).single();
    if(orderError&&!String(orderError.code||'').includes('PGRST116'))throw orderError;
    const userEmail=String(user.email||'').trim().toLowerCase();
    const emailMatches=!!order&&!order.user_id&&userEmail!==''&&String(order.customer_info?.email||'').trim().toLowerCase()===userEmail;
    if(!order||(!isAdmin&&order.user_id!==user.id&&!emailMatches))return new Response(JSON.stringify({success:false,error:'Order not found'}),{status:404,headers:cors});
    if(!order.user_id&&emailMatches){
      const orderClaim=await db.from('orders').update({user_id:user.id,updated_at:new Date().toISOString()}).eq('id',order.id).is('user_id',null);
      if(orderClaim.error)throw orderClaim.error;
      const fulfillmentClaim=await db.from('fulfillments').update({user_id:user.id,updated_at:new Date().toISOString()}).eq('order_id',order.id).is('user_id',null);
      if(fulfillmentClaim.error)throw fulfillmentClaim.error;
      order.user_id=user.id;
    }
    if(body?.action==='send_activation_message'){
      const fulfillmentId=String(body?.fulfillment_id||'').trim();
      const message=String(body?.message||'').trim().slice(0,2000);
      if(!fulfillmentId)return new Response(JSON.stringify({success:false,error:'Fulfillment is required'}),{status:400,headers:cors});
      if(!message)return new Response(JSON.stringify({success:false,error:'Message is required'}),{status:400,headers:cors});
      const {data:fulfillment,error:fulfillmentError}=await db.from('fulfillments')
        .select('id,order_id,service_id,mode,status,delivery_summary')
        .eq('id',fulfillmentId).eq('order_id',order.id).maybeSingle();
      if(fulfillmentError||!fulfillment)return new Response(JSON.stringify({success:false,error:'Activation request not found'}),{status:404,headers:cors});
      if(String(fulfillment.mode)!=='manual_activation')return new Response(JSON.stringify({success:false,error:'This product does not have an activation conversation'}),{status:400,headers:cors});
      if(['delivered','completed','cancelled','failed'].includes(String(fulfillment.status||'').toLowerCase()))return new Response(JSON.stringify({success:false,error:'This activation conversation is closed'}),{status:409,headers:cors});
      const {data:updatedFulfillment,error:updateError}=await db.from('fulfillments').update({
        status:'awaiting_admin',
        delivery_summary:{...(fulfillment.delivery_summary||{}),message:'The customer replied. Activation is awaiting the Strivio team.',last_activation_message_at:new Date().toISOString()},
        updated_at:new Date().toISOString()
      }).eq('id',fulfillment.id).eq('order_id',order.id)
        .in('status',['processing','pending','awaiting_customer','awaiting_admin'])
        .select('id').maybeSingle();
      if(updateError)throw updateError;
      if(!updatedFulfillment)return new Response(JSON.stringify({success:false,error:'This activation conversation is closed'}),{status:409,headers:cors});
      const {error:messageError}=await db.from('activation_messages').insert({
        fulfillment_id:fulfillment.id,sender_id:user.id,sender_role:'customer',message
      });
      if(messageError)throw messageError;
      const replyWarnings:string[]=[];
      const outboxResult=await db.from('integration_outbox').insert({
        event_type:'activation_message_created',aggregate_id:fulfillment.id,
        payload:{order_id:order.id,fulfillment_id:fulfillment.id,service_id:fulfillment.service_id,status:'awaiting_admin',source:'customer_reply',notify_admin:true}
      });
      if(outboxResult.error)replyWarnings.push(`Sheet update was not queued: ${outboxResult.error.message||String(outboxResult.error)}`);
      return new Response(JSON.stringify({success:true,fulfillment_id:fulfillment.id,status:'awaiting_admin',post_commit_warnings:replyWarnings}),{headers:cors});
    }
    if(body?.action==='save_customer_input'){
      const fulfillmentId=String(body?.fulfillment_id||'').trim();
      const accountEmail=String(body?.account_email||'').trim().toLowerCase();
      const accountPassword=String(body?.account_password||'');
      const note=String(body?.note||'').trim();
      if(!fulfillmentId)return new Response(JSON.stringify({success:false,error:'Fulfillment is required'}),{status:400,headers:cors});
      if(!/^\S+@\S+\.\S+$/.test(accountEmail)||accountEmail.length>254)return new Response(JSON.stringify({success:false,error:'Enter a valid account email'}),{status:400,headers:cors});
      if(accountPassword.length<2||accountPassword.length>500)return new Response(JSON.stringify({success:false,error:'Enter a valid account password'}),{status:400,headers:cors});
      if(note.length>2000)return new Response(JSON.stringify({success:false,error:'The note is too long'}),{status:400,headers:cors});
      const {data:fulfillment,error:fulfillmentError}=await db.from('fulfillments')
        .select('id,order_id,service_id,mode,status,customer_input,delivery_summary')
        .eq('id',fulfillmentId).eq('order_id',order.id).maybeSingle();
      if(fulfillmentError||!fulfillment)return new Response(JSON.stringify({success:false,error:'Activation request not found'}),{status:404,headers:cors});
      if(String(fulfillment.mode)!=='manual_activation')return new Response(JSON.stringify({success:false,error:'This product does not accept customer account details'}),{status:400,headers:cors});
      if(['delivered','completed','cancelled','failed'].includes(String(fulfillment.status||'').toLowerCase()))return new Response(JSON.stringify({success:false,error:'This activation can no longer be edited'}),{status:409,headers:cors});
      const customerInput={
        account_email:accountEmail,
        account_password_cipher:await encrypt({password:accountPassword}),
        note,
        submitted_at:new Date().toISOString()
      };
      const {data:updatedFulfillment,error:updateError}=await db.from('fulfillments').update({
        customer_input:customerInput,
        status:'awaiting_admin',
        delivery_summary:{...(fulfillment.delivery_summary||{}),message:'Customer account information received. Activation is awaiting the Strivio team.'},
        updated_at:new Date().toISOString()
      }).eq('id',fulfillment.id).eq('order_id',order.id)
        .in('status',['processing','pending','awaiting_customer','awaiting_admin'])
        .select('id').maybeSingle();
      if(updateError)throw updateError;
      if(!updatedFulfillment)return new Response(JSON.stringify({success:false,error:'This activation can no longer be edited'}),{status:409,headers:cors});
      const postCommitWarnings:string[]=[];
      const activationMessageResult=await db.from('activation_messages').insert({
        fulfillment_id:fulfillment.id,sender_id:user.id,sender_role:'system',
        message:fulfillment.customer_input?.submitted_at?'Account details updated.':'Account details submitted.'
      });
      if(activationMessageResult.error)postCommitWarnings.push(`Activation history was not recorded: ${activationMessageResult.error.message||String(activationMessageResult.error)}`);
      const activationOutboxResult=await db.from('integration_outbox').insert({
        event_type:'activation_updated',
        aggregate_id:fulfillment.id,
        payload:{order_id:order.id,fulfillment_id:fulfillment.id,service_id:fulfillment.service_id,status:'awaiting_admin',source:'customer_portal'}
      });
      if(activationOutboxResult.error)postCommitWarnings.push(`Sheet update was not queued: ${activationOutboxResult.error.message||String(activationOutboxResult.error)}`);
      const syncPromise=fetch(`${url}/functions/v1/sync-google-sheet`,{
        method:'POST',headers:{Authorization:`Bearer ${service}`}
      }).catch(()=>null);
      const edgeRuntime=(globalThis as any).EdgeRuntime;
      if(edgeRuntime?.waitUntil)edgeRuntime.waitUntil(syncPromise);
      return new Response(JSON.stringify({
        success:true,
        fulfillment_id:fulfillment.id,
        status:'awaiting_admin',
        post_commit_warnings:postCommitWarnings,
        customer_input:{account_email:accountEmail,account_password:accountPassword,note,submitted_at:customerInput.submitted_at}
      }),{headers:cors});
    }
    await ensureFulfilled(db,url,service,order);
    const {data:freshOrder,error:freshOrderError}=await db.from('orders').select('id,user_id,status,total_payable,items,created_at,fulfillment_status,customer_info').eq('id',order.id).maybeSingle();
    if(freshOrderError)throw freshOrderError;
    if(freshOrder)order=freshOrder;
    const {data:rows,error:rowsError}=await db.from('fulfillments').select('id,service_id,mode,status,quantity,order_item_index,customer_input,delivery_summary,encrypted_delivery,delivered_at,updated_at').eq('order_id',order.id).order('order_item_index');
    if(rowsError)throw rowsError;
    const fulfillmentIds=(rows||[]).map((row:any)=>row.id);
    const serviceIds=[...new Set((rows||[]).map((row:any)=>row.service_id).filter(Boolean))];
    const [allocationsResult,sharedAllocationsResult,benefitsResult,servicesResult,activationMessagesResult]=await Promise.all([
      fulfillmentIds.length
        ? db.from('fulfillment_allocations').select('id,fulfillment_id,ends_at,status,renewal_count,inventory_slots(label)').in('fulfillment_id',fulfillmentIds).order('created_at')
        : Promise.resolve({data:[],error:null}),
      fulfillmentIds.length
        ? db.from('shared_profile_allocations').select('id,fulfillment_id,benefit_id,slot_id,ends_at,status,renewal_count,inventory_slots(label)').in('fulfillment_id',fulfillmentIds).order('created_at')
        : Promise.resolve({data:[],error:null}),
      fulfillmentIds.length
        ? db.from('order_benefits').select('id,fulfillment_id,source_item_index,gift_item_index,gift_service_id,duration_months,quantity,allocation_policy,status,metadata').in('fulfillment_id',fulfillmentIds)
        : Promise.resolve({data:[],error:null}),
      serviceIds.length
        ? db.from('services').select('id,n,p,f,type_prices,types,show_types,fulfillment_mode,icon_type,icon_src,bg').in('id',serviceIds)
        : Promise.resolve({data:[],error:null}),
      fulfillmentIds.length
        ? db.from('activation_messages').select('id,fulfillment_id,sender_role,message,created_at').in('fulfillment_id',fulfillmentIds).order('created_at')
        : Promise.resolve({data:[],error:null})
    ]);
    if(allocationsResult.error)throw allocationsResult.error;
    if(sharedAllocationsResult.error)throw sharedAllocationsResult.error;
    if(benefitsResult.error)throw benefitsResult.error;
    if(servicesResult.error)throw servicesResult.error;
    if(activationMessagesResult.error)throw activationMessagesResult.error;
    const allocations=[
      ...(allocationsResult.data||[]).map((item:any)=>({...item,allocation_kind:'standard'})),
      ...(sharedAllocationsResult.data||[]).map((item:any)=>({...item,allocation_kind:'shared_promotion'}))
    ];
    const benefits=benefitsResult.data||[];
    const services=servicesResult.data;
    const activationMessages=activationMessagesResult.data;
    const serviceById=new Map((services||[]).map((item:any)=>[item.id,item]));
    // Renewal is available for any active, non-expired subscription. The
    // payment flow itself still validates the selected targets and ownership.
    const eligible=(endsAt?:string|null)=>{
      if(!endsAt)return true;
      return new Date(endsAt).getTime()>=Date.now();
    };
    const fulfillments=[];
    for(const row of rows||[]){
      const delivery=await decrypt(row.encrypted_delivery);
      const serviceRow:any=serviceById.get(row.service_id)||{};
      const sourceItem:any=Array.isArray(order.items)?order.items[Number(row.order_item_index||0)]||{}:{};
      const isPromotionGift=sourceItem?.is_promotional_gift===true&&sourceItem?.included_free===true;
      const promotionBenefit=(benefits||[]).find((item:any)=>item.fulfillment_id===row.id)||null;
      const allRowAllocations=(allocations||[]).filter((item:any)=>item.fulfillment_id===row.id);
      const rowAllocations=allRowAllocations.filter((item:any)=>String(item.status||'').toLowerCase()==='active'&&eligible(item.ends_at));
      let visibleDelivery=delivery;
      if(allRowAllocations.length&&delivery&&Array.isArray(delivery.entries)){
        const activeAllocationIds=new Set(rowAllocations.map((item:any)=>item.id));
        const matchingAllocation=(entry:any)=>{
          if(entry.allocation_id){
            const byId=allRowAllocations.find((item:any)=>String(item.id)===String(entry.allocation_id));
            if(byId)return byId;
          }
          if(entry.slot_id){
            const bySlot=allRowAllocations.find((item:any)=>String(item.slot_id)===String(entry.slot_id));
            if(bySlot)return bySlot;
          }
          const entryLabel=String(entry.profile||entry.label||'').trim().toLowerCase();
          if(!entryLabel)return null;
          const labelMatches=allRowAllocations.filter((item:any)=>
            String(item.inventory_slots?.label||'').trim().toLowerCase()===entryLabel
          );
          // Legacy rows did not store stable IDs. Only use a label when it is
          // unambiguous; hiding an uncertain entry is safer than exposing the
          // credentials for another account/profile.
          return labelMatches.length===1?labelMatches[0]:null;
        };
        visibleDelivery={...delivery,entries:delivery.entries.map((entry:any)=>{
          const allocation=matchingAllocation(entry);
          return allocation&&activeAllocationIds.has(allocation.id)
            ? {...entry,ends_at:allocation.ends_at||null,allocation_id:allocation.id,slot_id:allocation.slot_id||entry.slot_id}
            : null;
        }).filter(Boolean)};
      }
      const summaryEnd=row.delivery_summary?.ends_at||delivery?.ends_at||null;
      const renewalTargets=isPromotionGift?[]:rowAllocations.length
        ? rowAllocations.map((item:any)=>({
            id:item.id,
            kind:'allocation',
            label:item.inventory_slots?.label||'Profile',
            ends_at:item.ends_at,
            renewal_count:Number(item.renewal_count||0)
          }))
        : eligible(summaryEnd)&&['delivered','completed'].includes(String(row.status||'').toLowerCase())
          ? [{id:row.id,kind:'fulfillment',label:serviceRow.n?.ar||serviceRow.n?.fr||serviceRow.n?.en||row.service_id,ends_at:summaryEnd}]
          : [];
      fulfillments.push({
        ...row,
        customer_input:await exposeCustomerInput(row.customer_input),
        encrypted_delivery:undefined,
        delivery:visibleDelivery,
        activation_messages:(activationMessages||[]).filter((message:any)=>message.fulfillment_id===row.id),
        promotion_benefit:promotionBenefit?{
          id:promotionBenefit.id,
          status:promotionBenefit.status,
          source_item_index:promotionBenefit.source_item_index,
          duration_months:promotionBenefit.duration_months,
          quantity:promotionBenefit.quantity,
          allocation_policy:promotionBenefit.allocation_policy,
          included_free:true,
          label_i18n:promotionBenefit.metadata?.label_i18n||sourceItem.bundle_label_i18n||{}
        }:null,
        renewal_targets:renewalTargets,
        renewal_options:{
          durations:RENEWAL_DURATION_LABELS,
          service_name:serviceRow.n||{},
          prices:serviceRow.p||[],
          type_prices:serviceRow.type_prices||[],
          types:serviceRow.types||{},
          show_types:!!serviceRow.show_types,
          fulfillment_mode:serviceRow.fulfillment_mode||row.mode||'manual_delivery',
          source_type_idx:Number(sourceItem.typeIdx||0),
          icon_type:(serviceRow.icon_type==='img'&&(serviceRow.icon_src||sourceItem.iconSrc))?'img':(serviceRow.icon_type||sourceItem.iconType||'text'),
          icon_src:serviceRow.icon_src||sourceItem.iconSrc||String(serviceRow.n?.en||row.service_id||'?').slice(0,1),
          bg:serviceRow.bg||sourceItem.bg||'#171717'
        }
      });
    }
    return new Response(JSON.stringify({success:true,order,fulfillments}),{headers:cors});
  }catch(e:any){
    console.error('customer-delivery request failed',String(e?.message||e||'unknown').slice(0,300));
    return new Response(JSON.stringify({
      success:false,
      error:'Request could not be completed. Please try again.',
      code:'CUSTOMER_DELIVERY_FAILED'
    }),{status:500,headers:cors});
  }
});
