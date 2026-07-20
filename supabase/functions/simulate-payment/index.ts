import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const cors={
  "Access-Control-Allow-Origin":"https://www.striviodz.store",
  "Vary":"Origin",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json"
};

serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const url=Deno.env.get("SUPABASE_URL")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
    if(!token)return new Response(JSON.stringify({success:false,error:"Authentication required"}),{status:401,headers:cors});
    const db=createClient(url,service);
    const {data:{user},error:userError}=await db.auth.getUser(token);
    if(userError||!user)return new Response(JSON.stringify({success:false,error:"Authentication required"}),{status:401,headers:cors});
    const {data:admin}=await db.from("admin_users").select("user_id").eq("user_id",user.id).maybeSingle();
    if(!admin)return new Response(JSON.stringify({success:false,error:"Admin only"}),{status:403,headers:cors});
    const {order_id}=await req.json();
    const {data:order,error:orderError}=await db.from("orders").select("id,user_id,status,customer_info").eq("id",String(order_id||"")).maybeSingle();
    if(orderError||!order)return new Response(JSON.stringify({success:false,error:"Order not found"}),{status:404,headers:cors});
    const sameOwner=order.user_id===user.id||String(order.customer_info?.email||"").toLowerCase()===String(user.email||"").toLowerCase();
    if(!sameOwner)return new Response(JSON.stringify({success:false,error:"Test payment is limited to your own admin orders"}),{status:403,headers:cors});
    if(!["paid","completed"].includes(String(order.status||"").toLowerCase())){
      const now=new Date().toISOString();
      const {error:updateError}=await db.from("orders").update({status:"paid",payment_completed:true,invoice_completed:true,invoice_status:"paid",paid_at:now,updated_at:now}).eq("id",order.id).in("status",["pending","pending_payment"]);
      if(updateError)throw updateError;
    }
    const fulfillmentResponse=await fetch(`${url}/functions/v1/fulfill-order`,{method:"POST",headers:{Authorization:`Bearer ${service}`,"Content-Type":"application/json"},body:JSON.stringify({order_id:order.id})});
    const fulfillment=await fulfillmentResponse.json().catch(()=>null);
    if(!fulfillmentResponse.ok||!fulfillment?.success)throw new Error(fulfillment?.error||"Payment was marked paid but fulfillment failed");
    return new Response(JSON.stringify({success:true,order_id:order.id,fulfillment_status:fulfillment.fulfillment_status||"processing"}),{headers:cors});
  }catch(error:any){return new Response(JSON.stringify({success:false,error:error?.message||String(error)}),{status:500,headers:cors});}
});
