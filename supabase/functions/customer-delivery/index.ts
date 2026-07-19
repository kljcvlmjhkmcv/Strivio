import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json'
};
const enc=new TextEncoder(),dec=new TextDecoder();
function unb64(v:string){return Uint8Array.from(atob(v),c=>c.charCodeAt(0));}
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

async function ensureFulfilled(url:string,service:string,order:any){
  if(!['paid','completed'].includes(order.status))return;
  if(order.fulfillment_status==='delivered')return;
  await fetch(`${url}/functions/v1/fulfill-order`,{
    method:'POST',
    headers:{Authorization:`Bearer ${service}`,'Content-Type':'application/json'},
    body:JSON.stringify({order_id:order.id})
  }).catch(()=>null);
}

const RENEWAL_DURATION_LABELS = {
  ar: ['شهر واحد', 'شهران', '3 أشهر', '6 أشهر', 'سنة كاملة'],
  fr: ['1 mois', '2 mois', '3 mois', '6 mois', '1 an'],
  en: ['1 month', '2 months', '3 months', '6 months', '1 year']
};

serve(async req=>{
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
      const {data:requestedOrders}=await db.from('orders').select('id,user_id,customer_info').in('id',requested);
      const allowed=(requestedOrders||[]).filter((item:any)=>isAdmin||item.user_id===user.id||String(item.customer_info?.email||'').trim().toLowerCase()===String(user.email||'').trim().toLowerCase()).map((item:any)=>item.id);
      const {data:summaries}=allowed.length?await db.from('fulfillments').select('id,order_id,status,delivery_summary,service_id,mode,quantity').in('order_id',allowed).order('order_item_index'): {data:[]};
      return new Response(JSON.stringify({success:true,fulfillments:summaries||[]}),{headers:cors});
    }
    const {order_id}=body;
    const {data:order}=await db.from('orders').select('id,user_id,status,total_payable,items,created_at,fulfillment_status,customer_info').eq('id',order_id).single();
    const emailMatches=!!order&&String(order.customer_info?.email||'').trim().toLowerCase()===String(user.email||'').trim().toLowerCase();
    if(!order||(!isAdmin&&order.user_id!==user.id&&!emailMatches))return new Response(JSON.stringify({success:false,error:'Order not found'}),{status:404,headers:cors});
    if(!order.user_id&&emailMatches){
      await db.from('orders').update({user_id:user.id,updated_at:new Date().toISOString()}).eq('id',order.id).is('user_id',null);
      await db.from('fulfillments').update({user_id:user.id,updated_at:new Date().toISOString()}).eq('order_id',order.id).is('user_id',null);
      order.user_id=user.id;
    }
    await ensureFulfilled(url,service,order);
    const {data:rows}=await db.from('fulfillments').select('id,service_id,mode,status,quantity,order_item_index,customer_input,delivery_summary,encrypted_delivery,delivered_at').eq('order_id',order.id).order('order_item_index');
    const fulfillmentIds=(rows||[]).map((row:any)=>row.id);
    const serviceIds=[...new Set((rows||[]).map((row:any)=>row.service_id).filter(Boolean))];
    const [{data:allocations},{data:services}]=await Promise.all([
      fulfillmentIds.length
        ? db.from('fulfillment_allocations').select('id,fulfillment_id,ends_at,status,renewal_count,inventory_slots(label)').in('fulfillment_id',fulfillmentIds).order('created_at')
        : Promise.resolve({data:[]}),
      serviceIds.length
        ? db.from('services').select('id,n,p,f,type_prices,types,show_types,fulfillment_mode,icon_type,icon_src,bg').in('id',serviceIds)
        : Promise.resolve({data:[]})
    ]);
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
      const allRowAllocations=(allocations||[]).filter((item:any)=>item.fulfillment_id===row.id);
      const rowAllocations=allRowAllocations.filter((item:any)=>String(item.status||'').toLowerCase()==='active'&&eligible(item.ends_at));
      let visibleDelivery=delivery;
      if(allRowAllocations.length&&delivery&&Array.isArray(delivery.entries)){
        const activeAllocationIds=new Set(rowAllocations.map((item:any)=>item.id));
        const activeLabels=new Set(rowAllocations.map((item:any)=>String(item.inventory_slots?.label||'').trim().toLowerCase()).filter(Boolean));
        const allocationByLabel=new Map((allRowAllocations||[]).map((item:any)=>[
          String(item.inventory_slots?.label||'').trim().toLowerCase(), item
        ]));
        visibleDelivery={...delivery,entries:delivery.entries.filter((entry:any,index:number)=>{
          const matchingAllocation=allRowAllocations[index];
          if(matchingAllocation)return activeAllocationIds.has(matchingAllocation.id);
          return activeLabels.has(String(entry.profile||entry.label||'').trim().toLowerCase());
        }).map((entry:any,index:number)=>{
          const byLabel=allocationByLabel.get(String(entry.profile||entry.label||'').trim().toLowerCase());
          const byIndex=allRowAllocations[index];
          const allocation=byLabel||byIndex;
          return allocation ? {...entry,ends_at:allocation.ends_at||null,allocation_id:allocation.id} : entry;
        })};
      }
      const summaryEnd=row.delivery_summary?.ends_at||delivery?.ends_at||null;
      const renewalTargets=rowAllocations.length
        ? rowAllocations.map((item:any)=>({
            id:item.id,
            kind:'allocation',
            label:item.inventory_slots?.label||'Profile',
            ends_at:item.ends_at,
            renewal_count:Number(item.renewal_count||0)
          }))
        : eligible(summaryEnd)&&['delivered','completed','awaiting_admin','awaiting_customer_input'].includes(String(row.status||'').toLowerCase())
          ? [{id:row.id,kind:'fulfillment',label:serviceRow.n?.ar||serviceRow.n?.fr||serviceRow.n?.en||row.service_id,ends_at:summaryEnd}]
          : [];
      fulfillments.push({
        ...row,
        encrypted_delivery:undefined,
        delivery:visibleDelivery,
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
  }catch(e:any){return new Response(JSON.stringify({success:false,error:e?.message||String(e)}),{status:500,headers:cors});}
});
