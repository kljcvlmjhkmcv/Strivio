import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=process.cwd();
const htmlFiles=fs.readdirSync(root).filter(name=>name.endsWith('.html'));
const failures=[];
const check=(ok,message)=>{if(!ok)failures.push(message)};

for(const name of htmlFiles){
  const source=fs.readFileSync(path.join(root,name),'utf8');
  check(!source.includes('cdn.tailwindcss.com'),`${name}: production Tailwind CDN remains`);
  check(!source.includes('user-scalable=no'),`${name}: zoom is disabled`);
  const inline=[...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).filter(Boolean);
  inline.forEach((code,index)=>{
    try{new vm.Script(code,{filename:`${name}:inline-${index+1}`})}catch(error){failures.push(`${name}: inline script ${index+1}: ${error.message}`)}
  });
}

for(const name of ['privacy.html','terms.html','warranty.html','refund.html','assets/tailwind.css']){
  check(fs.existsSync(path.join(root,name)),`Missing ${name}`);
}

for(const name of ['index.html','cart.html','faq.html']){
  const source=fs.readFileSync(path.join(root,name),'utf8');
  check(source.includes('site-nav-inner'),`${name}: public header does not use the shared navigation shell`);
  check(source.includes('id="CTB2"')&&source.includes('id="CNBM"'),`${name}: mobile cart control is inconsistent`);
  check(source.includes('header-unified-0720'),`${name}: shared header assets are not cache-busted together`);
}
const cartPage=fs.readFileSync(path.join(root,'cart.html'),'utf8');
check(!cartPage.includes('ANTI-CLONE TRAP'),'cart.html: decorative anti-clone markup can alter the real layout');

const allText=['schema.sql','backend-production-upgrade.sql','supabase-client.js','admin.html']
  .map(name=>fs.readFileSync(path.join(root,name),'utf8')).join('\n');
check(!/\d{8,12}:[A-Za-z0-9_-]{30,}/.test(allText),'A Telegram bot token is committed in source');
check(allText.includes('get_public_settings'),'Filtered public settings RPC is missing');

for(const name of ['admin-inventory','customer-delivery','fulfill-order','simulate-payment']){
  const source=fs.readFileSync(path.join(root,'supabase','functions',name,'index.ts'),'utf8');
  check(!/Access-Control-Allow-Origin['"]?\s*:\s*['"]\*/.test(source),`${name}: wildcard CORS remains`);
}
const delivery=fs.readFileSync(path.join(root,'supabase','functions','customer-delivery','index.ts'),'utf8');
check(delivery.includes("save_customer_input"),'Spotify/customer activation input endpoint is missing');
check(delivery.includes("send_activation_message"),'Customer activation chat endpoint is missing');
check(delivery.includes("activation_messages"),'Activation conversation data is missing from delivery');
const account=fs.readFileSync(path.join(root,'my-account.html'),'utf8');
check(account.includes('saveActivationInput'),'Customer activation form is missing');
check(account.includes('sendActivationMessage'),'Customer activation chat UI is missing');
check(account.includes('screen'+"'"+'+(count===1'), 'Netflix screen count rendering is missing');
check(account.includes('ORDER_DEEP_LINK_PATTERN'),'Account order links are not validated as UUIDs');
check(account.includes('new URLSearchParams(location.search).get("order")'),'Account page does not read the order deep link');
check(account.includes('encodeURIComponent(currentAccountReturnTarget())'),'Account login redirect drops the requested order');
check(account.includes('await showDetails(linkedOrderId)'),'Account page does not open a linked owned order');
check(account.includes('renewalStateForSource'),'Customer orders do not show the independent renewal state');
check(account.includes('.from("renewal_requests")'),'Customer account cannot load renewal payment state');
check(account.includes('paymentOrders = o.data || []'),'Customer payment history still hides renewal invoices');
const deepLinkStart=account.indexOf('const ORDER_DEEP_LINK_PATTERN');
const deepLinkEnd=account.indexOf('      const renewalDurationLabels',deepLinkStart);
check(deepLinkStart>=0&&deepLinkEnd>deepLinkStart,'Account deep-link helpers are missing');
if(deepLinkStart>=0&&deepLinkEnd>deepLinkStart){
  const deepLinkSource=account.slice(deepLinkStart,deepLinkEnd);
  const requested=(search)=>{
    const context={URL,URLSearchParams,location:{search,href:`https://www.striviodz.store/my-account${search}`,hash:''},history:{pushState(){},replaceState(){}}};
    vm.createContext(context);
    return vm.runInContext(`${deepLinkSource};requestedOrderId()`,context);
  };
  check(requested('?order=566b81ac-79ed-4a3b-bd00-5a130df57161')==='566b81ac-79ed-4a3b-bd00-5a130df57161','A valid owned-order deep link is rejected');
  check(requested('?order=not-a-uuid')==='','A malformed order deep link is accepted');
}
const operations=fs.readFileSync(path.join(root,'operations.html'),'utf8');
check(operations.includes('openActivationModal'),'Operations activation conversation is missing');
check(operations.includes('activationCredentialsHtml'),'Activation credentials are missing from service records');
check(allText.includes('ops_send_activation_message'),'Admin activation chat RPC is missing');
for(const action of ['confirm_manual_payment','choose_manual_delivery','deliver_manual_credentials']){
  check(operations.includes(`action: "${action}"`),`Operations manual fulfillment UI is missing ${action}`);
}
check(operations.includes('data-manual-account'),'Operations cannot submit multiple manual account entries');
check(operations.includes('result.fulfillment_error || result.retryable'),'Operations hides a recoverable fulfillment failure after manual payment confirmation');
check(operations.includes('result.already_delivered'),'Operations can claim that replacement credentials were saved after a concurrent delivery');
check(operations.includes('paymentOrders: []'),'Operations discards technical renewal invoices');
check(operations.includes('paymentOrderFor(renewal.order_id)'),'Renewal register cannot resolve its payment invoice');
check(operations.includes('manualPaymentAction(invoice)'),'Renewal payment cannot be approved or repaired from its register');
check(operations.includes('حالة الدفع')&&operations.includes('حالة التجديد'),'Renewal payment and application states are still conflated');
const activationLinkStart=operations.indexOf('function activationOrderLink()');
const activationLinkEnd=operations.indexOf('async function chooseManualDelivery',activationLinkStart);
check(activationLinkStart>=0&&activationLinkEnd>activationLinkStart,'Operations safe order-link builder is missing');
if(activationLinkStart>=0&&activationLinkEnd>activationLinkStart){
  const activationLinkSource=operations.slice(activationLinkStart,activationLinkEnd);
  check(activationLinkSource.includes('"/my-account?order="'),'Manual activation link does not deep-link to the same order');
  check(!/account_(?:email|password)|customer_info|credentials|password/i.test(activationLinkSource),'Manual activation URL can expose customer credentials');
}

const auth=fs.readFileSync(path.join(root,'auth.html'),'utf8');
check(auth.includes('resetPasswordForEmail'),'Forgot-password request is missing');
check(auth.includes("event==='PASSWORD_RECOVERY'"),'Password recovery session is not handled');
check(auth.includes('auth.updateUser({password})'),'New password cannot be saved');
check(auth.includes("current!=='recovery'"),'Recovery links can be redirected away before the password is changed');
const nextStart=auth.indexOf('function nextUrl()');
const nextEnd=auth.indexOf('\n    function mode',nextStart);
check(nextStart>=0&&nextEnd>nextStart,'Safe auth return-path resolver is missing');
if(nextStart>=0&&nextEnd>nextStart){
  const nextSource=auth.slice(nextStart,nextEnd);
  const resolveNext=(search)=>{
    const context={URL,URLSearchParams,location:{search,origin:'https://www.striviodz.store',pathname:'/auth'}};
    vm.createContext(context);
    return vm.runInContext(`${nextSource};nextUrl()`,context);
  };
  check(resolveNext('?next=javascript%3Aalert(1)')==='my-account','Auth accepts a javascript: return target');
  check(resolveNext('?next=%2F%2Fevil.example')==='my-account','Auth accepts a protocol-relative external target');
  check(resolveNext('?next=https%3A%2F%2Fevil.example')==='my-account','Auth accepts an external absolute target');
  check(resolveNext('?next=%5C%5Cevil.example')==='my-account','Auth accepts a backslash-based external target');
  check(resolveNext('?next=my-account.html%3Forder%3D123')==='my-account?order=123','Auth rejects a valid clean account return path');
  check(resolveNext('?next=%2Fcart%3Frenewal%3D1')==='cart?renewal=1','Auth rejects a valid cart return path');
}

const notifications=fs.readFileSync(path.join(root,'notification-center.js'),'utf8');
check(!notifications.includes('subtree: true, childList: true'),'Notification language observer can recurse on its own renders');
check(notifications.includes('overflow:visible!important'),'Notification badge can be clipped by the trigger');
const sharedClient=fs.readFileSync(path.join(root,'supabase-client.js'),'utf8');
check(sharedClient.includes("b.matches('[data-notification-trigger]')"),'Notification trigger is not excluded from the clipping ripple');
check(sharedClient.includes("from('service_bundle_rules')"),'Active bundle rules are not loaded from the database');
check(sharedClient.includes('bundle_offers'),'Bundle rules are not attached to storefront services');
check(sharedClient.includes('source_type_idx'),'Bundle rules do not preserve package-specific eligibility');
check(sharedClient.includes('gift_duration_idx'),'Bundle rules do not preserve a fixed gift duration');
const bundleHelperPath=path.join(root,'bundle-rules.js');
check(fs.existsSync(bundleHelperPath),'Shared bundle-rule helper is missing');
if(fs.existsSync(bundleHelperPath)){
  const bundleContext={window:{}};
  vm.createContext(bundleContext);
  vm.runInContext(fs.readFileSync(bundleHelperPath,'utf8'),bundleContext);
  const bundles=bundleContext.window.StrivioBundles;
  const service={bundle_offers:[
    {id:'wildcard',source_duration_idx:2,source_type_idx:null,gift_service_id:'prime',priority:100},
    {id:'specific',source_duration_idx:2,source_type_idx:1,gift_service_id:'prime',priority:200},
    {id:'other-gift',source_duration_idx:2,source_type_idx:null,gift_service_id:'canva',priority:50},
    {id:'wrong-duration',source_duration_idx:3,source_type_idx:1,gift_service_id:'spotify',priority:1},
  ]};
  const matched=Array.from(bundles.matchingRules(service,2,1),value=>value.id);
  check(JSON.stringify(matched)===JSON.stringify(['other-gift','specific']),'Package-specific bundle matching or multi-gift ordering is wrong');
  check(bundles.giftDurationIndex({gift_duration_strategy:'fixed',gift_duration_idx:1},3)===1,'Fixed gift duration is ignored');
  check(bundles.giftDurationIndex({gift_duration_strategy:'same'},3)===3,'Same-duration gift mapping is wrong');
  check(bundles.effectiveStatus({active:true,starts_at:'2099-01-01T00:00:00Z'},'2026-01-01T00:00:00Z')==='scheduled','Scheduled bundle status is wrong');
  check(bundles.effectiveStatus({active:true,ends_at:'2020-01-01T00:00:00Z'},'2026-01-01T00:00:00Z')==='expired','Expired bundle status is wrong');
  check(bundles.effectiveStatus({active:false,metadata:{archived_at:'2026-01-01T00:00:00Z'}},'2026-01-02T00:00:00Z')==='archived','Archived bundle status is wrong');
  check(bundles.validateDraft({source_service_id:'netflix',source_duration_idx:2,source_type_idx:null,gift_service_id:'prime',gift_duration_strategy:'fixed',gift_duration_idx:null,gift_quantity:1,quantity_mode:'fixed',allocation_policy:'shared_reusable',priority:100}).includes('gift_duration_idx'),'A fixed promotion can be saved without a gift duration');
}
const storefront=fs.readFileSync(path.join(root,'index.html'),'utf8');
check(storefront.includes('bundleOffersAt(curSvc, i, selType)'),'Duration cards do not match server-defined offers by package');
check(storefront.includes('BUNDLE-COMPACT'),'Promotional gift copy is not rendered in the compact duration-note slot');
check(!storefront.includes('class="BUNDLE-NOTE"'),'Promotional gift still adds a separate oversized duration-card row');
check(storefront.includes('display_only:true'),'Cart gift preview is not explicitly display-only');
check(cartPage.includes('CI-GIFT')&&cartPage.includes('cartBundlePreviews'),'Cart does not show every included promotional gift');
check(!cartPage.includes('item.bundlePreview && item.bundlePreview.display_only===true'),'Cart can advertise a stale or disabled promotional gift');
check(operations.includes('promotion_shared'),'Operations cannot create shared promotional inventory');
check(operations.includes('sharedAllocationsFor'),'Operations cannot display multiple shared profile assignments');
for(const token of ['data-tab="promotions"','id="promotion-form"','save_bundle_rule','set_bundle_rule_active','archive_bundle_rule','delete_bundle_rule','promotion-source-type','promotion-gift-duration','promotion-include-renewals','promotion-starts-at','promotion-label-ar']){
  check(operations.includes(token),`Operations bundle control is missing ${token}`);
}
check(!operations.includes('.from("service_bundle_rules")\n              .select("*")\n              .eq("active", true)'),'Operations still loads active promotions only');
const sheetSync=fs.readFileSync(path.join(root,'supabase','functions','sync-google-sheet','index.ts'),'utf8');
check(sheetSync.includes("from('order_benefits')"),'Sheet sync does not load order benefits');
check(sheetSync.includes("from('shared_profile_allocations')"),'Sheet sync does not load shared gift assignments');
const appsScriptPath=path.join(root,'integrations','strivio-operations-apps-script.gs');
check(fs.existsSync(appsScriptPath),'Versioned Strivio Operations Apps Script is missing');
if(fs.existsSync(appsScriptPath)){
  const appsScript=fs.readFileSync(appsScriptPath,'utf8');
  check(appsScript.includes("name: 'Promotional Gifts'"),'Promotional Gifts sheet definition is missing');
  check(appsScript.includes('writePromotionalGiftRows_'),'Promotional Gifts webhook writer is missing');
  check(appsScript.includes("if (!expectedSecret) return json_"),'Google Sheets webhook fails open when its sync secret is missing');
}

const bundleMigration=fs.readFileSync(path.join(root,'supabase','migrations','202607210100_promotional_bundles.sql'),'utf8');
check(bundleMigration.includes('orders_attach_active_bundle_gifts'),'Server-authoritative bundle trigger is missing');
check(bundleMigration.includes("'netflix', 2, 'prime'"),'Netflix 3-month Prime gift rule is missing');
check(bundleMigration.includes("'netflix', 3, 'prime'"),'Netflix 6-month Prime gift rule is missing');
check(bundleMigration.includes("'gift_duration_months', 'benefit_id', 'renewal'"),'Client-controlled renewal/promotion fields are not stripped');
check(bundleMigration.includes("account.pool_kind = 'promotion_shared'"),'Shared promotion allocator is not isolated from standard inventory');
check(bundleMigration.includes("allocation_kind', ''), 'standard') = 'shared'"),'Credential rotation does not validate shared allocations');
check(bundleMigration.includes("profiles_per_account = 6"),'Prime operations capacity is not configured for six profiles');
check(bundleMigration.includes("if tg_op = 'DELETE' then\n    return old;"),'Promotion delete events can poison the order-scoped Sheet retry queue');
const bundleControlMigration=fs.readFileSync(path.join(root,'supabase','migrations','202607230100_bundle_operations_control.sql'),'utf8');
check(bundleControlMigration.includes('and not v_is_renewal'),'Unsafe renewal gifts are not blocked by the server');
check(bundleControlMigration.includes('service_bundle_rules_current_offer_idx'),'Archived campaigns still block replacement offers');
check(bundleControlMigration.includes('sync_order_benefit_from_fulfillment'),'Manual promotional gifts are not synchronized after delivery');
check(bundleControlMigration.includes('distinct on (r.gift_service_id)'),'A wildcard and package-specific rule can grant the same gift twice');
check(bundleControlMigration.includes("'bundlePreview', 'bundlePreviews', 'renewal'"),'Client bundle previews are not stripped by the server');
check(bundleControlMigration.includes('least(20'),'Gift quantity can exceed allocator limits');
check(bundleControlMigration.includes("quantity_mode in ('per_screen', 'per_unit') then 1"),'Per-unit promotions can silently exceed allocator capacity');
check(bundleControlMigration.includes('v_fixed_rule_ids'),'A fixed promotion can be granted repeatedly across duplicate cart rows');
check(bundleControlMigration.includes('touch_service_bundle_rule'),'Bundle rule updated_at is not maintained');
check(bundleControlMigration.includes('revoke insert, update, delete'),'Browser roles can mutate bundle rules directly');
const manualFulfillmentMigration=fs.readFileSync(path.join(root,'supabase','migrations','202607250100_manual_payment_fulfillment.sql'),'utf8');
check(manualFulfillmentMigration.includes('ops_confirm_manual_payment'),'Manual payment confirmation RPC is missing');
check(manualFulfillmentMigration.includes('ops_choose_manual_delivery'),'Manual delivery strategy RPC is missing');
check(manualFulfillmentMigration.includes('ops_complete_manual_delivery'),'Manual credential delivery RPC is missing');
check(manualFulfillmentMigration.includes('if not public.is_admin()'),'Manual fulfillment RPCs are not admin-guarded');
check(manualFulfillmentMigration.includes("customer_input='{}'::jsonb"),'Switching to a Strivio account does not purge customer credentials safely');
check(!manualFulfillmentMigration.includes("customer_input=null"),'Manual delivery violates the non-null customer_input constraint');
check(manualFulfillmentMigration.includes("'changed',v_changed"),'Repeated manual routing cannot be detected as a no-op');
const inventoryAdmin=fs.readFileSync(path.join(root,'supabase','functions','admin-inventory','index.ts'),'utf8');
for(const action of ['confirm_manual_payment','retry_fulfillment','retry_service_fulfillments','choose_manual_delivery','deliver_manual_credentials']){
  check(inventoryAdmin.includes(`action === "${action}"`),`Admin inventory endpoint is missing ${action}`);
}
const manualConfirmStart=inventoryAdmin.indexOf('action === "confirm_manual_payment"');
const manualConfirmEnd=inventoryAdmin.indexOf('action === "choose_manual_delivery"',manualConfirmStart);
check(manualConfirmStart>=0&&manualConfirmEnd>manualConfirmStart,'Manual payment confirmation handler is incomplete');
if(manualConfirmStart>=0&&manualConfirmEnd>manualConfirmStart){
  const manualConfirmSource=inventoryAdmin.slice(manualConfirmStart,manualConfirmEnd);
  check(manualConfirmSource.includes('/functions/v1/fulfill-order'),'Manual payment confirmation does not start fulfillment for the same order');
  check(manualConfirmSource.includes('body: JSON.stringify({ order_id: orderId })'),'Manual payment confirmation does not pass the confirmed order to fulfillment');
}
check(inventoryAdmin.includes('validateBundleRule'),'Admin bundle mutations are not server-validated');
check(inventoryAdmin.includes('auditBundleRule'),'Admin bundle changes are not audited');
check(inventoryAdmin.includes('bundle_rules: bundleRulesResult.data'),'Operations cannot load disabled or archived bundle rules through the admin backend');
check(inventoryAdmin.includes('This promotion has customer delivery history'),'Used bundle rules can be hard-deleted');
check(inventoryAdmin.includes('Archive it and create a new offer'),'Used bundle rule semantics can be rewritten retroactively');
check(inventoryAdmin.includes('action === "complete_activation"')&&inventoryAdmin.includes('/functions/v1/fulfill-order'),'Manual source completion does not retry dependent promotional gifts');
check(inventoryAdmin.includes('submittedAccounts.length !== expectedQuantity'),'Manual account delivery can under-deliver a multi-unit order');
check(inventoryAdmin.includes('entries,')&&inventoryAdmin.includes('requested: expectedQuantity'),'Manual delivery does not persist every required account entry');
check(inventoryAdmin.includes('action === "release_allocation"'),'Admin inventory cannot safely release an active customer profile');
check(inventoryAdmin.includes('ops_update_subscription_end'),'Admin inventory cannot select per-profile or whole-item expiry updates');
check(operations.includes('end-date-scope'),'Operations expiry editor has no per-profile/all-profiles scope');
check(operations.includes('openReleaseSubscription'),'Operations cannot release a profile without the unsafe status toggle');
check(operations.includes("retryOrderFulfillment("),'Operations cannot retry a paid order after stock is added');
check(operations.includes("action: \"retry_fulfillment\""),'Operations retry button is not connected to the admin backend');
check(operations.includes("retryServiceFulfillments(")&&operations.includes("تسليم الطلبات المنتظرة"),'Operations cannot retry every waiting order for one service');
check(operations.includes("إيقاف الحساب للصيانة")&&operations.includes("إعادة الحساب للعمل"),'Service accounts cannot be paused and restored from their register');
check(operations.includes('id="inventory-alerts"')&&operations.includes('renderInventoryAlerts()'),'Operations does not render low/out-of-stock alerts');
check(operations.includes('inventoryCallsInFlight'),'Duplicate admin inventory mutations are not guarded');
check(operations.includes('data-tab="chatbot"')&&operations.includes('renderChatbot()'),'Operations has no Meta conversation inbox');
check(operations.includes('mode: "admin_reply"')&&operations.includes('mode: "conversation_update"'),'Meta inbox is not connected to secure admin actions');
check(operations.includes('id="chatbot-test-input"')&&operations.includes('mode: "test"'),'Operations cannot test chatbot replies safely before publishing');
const metaChatbot=fs.readFileSync(path.join(root,'supabase','functions','meta-chatbot','index.ts'),'utf8');
check(metaChatbot.includes('isAdminReply')&&metaChatbot.includes('sender_role: "admin"'),'Meta chatbot cannot send and audit an admin reply');
check(metaChatbot.includes('isConversationUpdate')&&metaChatbot.includes('conversation_mode'),'Meta chatbot cannot hand conversations back to automation');
const socialChatbot=fs.readFileSync(path.join(root,'supabase','functions','social-chatbot','index.ts'),'utf8');
check(socialChatbot.includes('/functions/v1/meta-chatbot')&&socialChatbot.includes('x-hub-signature-256')===false,'Neutral chatbot proxy is missing or rewrites signed requests');
check(cartPage.includes('checkoutInFlight')&&cartPage.includes('setCheckoutBusy(true'),'Checkout can be submitted repeatedly while an order is being created');
const lifecycleMigration=fs.readFileSync(path.join(root,'supabase','migrations','202607250200_subscription_lifecycle.sql'),'utf8');
check(lifecycleMigration.includes('ops_update_subscription_end'),'Scoped subscription expiry RPC is missing');
check(lifecycleMigration.includes("v_scope not in ('allocation','fulfillment')"),'Subscription expiry scope is not server-validated');
check(lifecycleMigration.includes('ops_release_subscription_allocation'),'Safe manual subscription release RPC is missing');
check(lifecycleMigration.includes('expire_due_subscriptions'),'Automatic subscription expiry worker is missing');
check(lifecycleMigration.includes("'strivio-subscription-expiry'"),'Automatic subscription expiry is not scheduled');
check(lifecycleMigration.includes("set status='available'"),'Expired inventory capacity is not released');
check(lifecycleMigration.includes("'subscription.expired'"),'Customers are not notified when a subscription expires');
const manualDeliveryHandler=inventoryAdmin.slice(inventoryAdmin.indexOf('action === "deliver_manual_credentials"'),inventoryAdmin.indexOf('action === "complete_activation"'));
check(!manualDeliveryHandler.includes('p_event_type: "fulfillment.delivered"'),'Manual delivery can enqueue a duplicate credential email outside fulfill-order');
const fulfillOrder=fs.readFileSync(path.join(root,'supabase','functions','fulfill-order','index.ts'),'utf8');
for(const mode of ['automatic_slot','automatic_account','automatic_license','automatic_shared_slot']){
  check(fulfillOrder.includes(`"${mode}"`),`Automatic inventory path ${mode} was removed by manual fulfillment changes`);
}
check(fulfillOrder.includes('delivery.entries = await allocateSlots('),'Automatic account/profile allocation is no longer invoked');
check(fulfillOrder.includes('delivery.entries = await allocateLicenses('),'Automatic license allocation is no longer invoked');
check(fulfillOrder.includes('allocate_shared_promotion_slots_atomic'),'Shared promotion allocator is not used by fulfillment');
check(fulfillOrder.includes('.eq("pool_kind", "standard")'),'Exclusive fulfillment can consume shared promotion stock');
check(fulfillOrder.includes('outOfStock && !isPromotionGift'),'A free gift stock miss can block the paid product');
const myAccountSource=fs.readFileSync(path.join(root,'my-account.html'),'utf8');
check(myAccountSource.includes('giftsBySource')&&myAccountSource.includes('termsAfter[termsTarget.id] = source'),'Promotional gift details can render below Netflix usage terms');
check(myAccountSource.includes('let entries = f.delivery?.entries || []'),'My Account no longer reads delivered Strivio account entries');
check(myAccountSource.includes('body=activationDone&&entries.length'),'Completed manual delivery can hide Strivio account credentials');
check(myAccountSource.includes('f.delivery?.instructions ||'),'Manual delivery instructions are hidden from the customer');
check(fulfillOrder.includes('isPromotionGift && !promotionSourceReady'),'A promotional gift can be delivered before its paid source item');
check(fulfillOrder.includes('renewalGiftContext'),'Renewal promotions are not fulfilled after extending the original subscription');
const deliveryApi=fs.readFileSync(path.join(root,'supabase','functions','customer-delivery','index.ts'),'utf8');
check(deliveryApi.includes("isPromotionGift?[]:rowAllocations.length"),'Free promotional gifts can incorrectly be renewed');
check(deliveryApi.includes("allocation_kind:'shared_promotion'"),'Customer delivery does not validate shared allocations');
check(deliveryApi.includes("accountStatusById"),'Customer delivery does not expose maintenance state safely');
check(deliveryApi.includes("subscription_state:subscriptionState")&&deliveryApi.includes("expired_at:expiredAt"),'Customer delivery does not expose inactive subscription state safely');
check(deliveryApi.includes("expired_entries:expiredAllocations.map"),'Customer delivery does not expose expired profile labels without credentials');
check(myAccountSource.includes('maintenanceTitle')&&myAccountSource.includes('accountUnderMaintenance'),'My Account does not warn customers when their inventory account is under maintenance');
check(myAccountSource.includes('expiredProfile')&&myAccountSource.includes('badge(inactive ? "expired" : f.status)')&&myAccountSource.includes('entries = entries.filter'), 'My Account does not render expired subscriptions safely');
check(myAccountSource.includes('allDatedSubscriptionsExpired')&&myAccountSource.includes('hasActiveSubscription'),'Expired order cards can show a non-functional renewal button');
const bundleRenewalMigration=fs.readFileSync(path.join(root,'supabase','migrations','202607260100_bundle_renewal_dates.sql'),'utf8');
check(bundleRenewalMigration.includes('extend_bundle_gifts_for_renewal'),'Bundle gifts are not extended from the server during renewal');
check(bundleRenewalMigration.includes("'gift_updates'"),'Renewal result does not expose gift date updates');
check(bundleRenewalMigration.includes("'new_ends_at',latest_end"),'Renewal result does not expose the updated parent expiry');
check(bundleRenewalMigration.includes('and v_allocation_count=0'),'Expired gift allocations can be reported as renewed by changing only their summary');
check(fulfillOrder.includes('renewalGiftUpdates')&&fulfillOrder.includes('gift_updates: renewalGiftUpdates'),'Renewal notifications do not include updated gift subscriptions');

const emailTemplate=fs.readFileSync(path.join(root,'supabase','functions','_shared','strivio-email.ts'),'utf8');
check(emailTemplate.includes('const CTA ='),'Transactional emails do not have event-specific CTA labels');
check(emailTemplate.includes('credentialsChanged: "Afficher les nouveaux identifiants"'),'Credential-change emails use the generic CTA');
check(emailTemplate.includes('problemReply: "Read the reply and continue the report"'),'Problem reply emails use the generic CTA');
check(emailTemplate.includes('${ctaLabel}: ${ctx.actionUrl}'),'Plain-text emails do not use the event-specific CTA');
const dispatchNotifications=fs.readFileSync(path.join(root,'supabase','functions','dispatch-notifications','index.ts'),'utf8');
const adminInventory=fs.readFileSync(path.join(root,'supabase','functions','admin-inventory','index.ts'),'utf8');
check(dispatchNotifications.includes('decrypted?.instructions'),'Manual delivery notes are not read from encrypted delivery for email');
check(dispatchNotifications.includes('entry_kind: entry.entry_kind || defaultEntryKind'),'Manual accounts can still be rendered as profiles in email');
check(emailTemplate.includes('unicode-bidi:plaintext')&&emailTemplate.includes('function mixedText('),'Mixed Arabic and Latin delivery notes are not isolated safely');
check(emailTemplate.includes('function stripEmailUrls(')&&emailTemplate.includes('externalLinkNotice(lang)'),'Credential emails do not remove external URLs from the message body');
check(emailTemplate.includes('const hasSensitiveCredentials =')&&emailTemplate.includes('hasSensitiveCredentials ? sensitiveDeliveryHint'),'Credential emails still include a clickable CTA');
check(!emailTemplate.includes('<a href="https://www.striviodz.store"'),'The email logo still creates a second link');
check(emailTemplate.includes('entry.entry_kind === "account"'),'Ready-account emails still use the generic profile label');
check(emailTemplate.includes('${credentialBlock}${messageBlock}')&&emailTemplate.indexOf('plainEntries(entries, lang)')<emailTemplate.lastIndexOf('formattedAdminNote.plain'),'Manual delivery notes are not placed below the account details');
check(emailTemplate.includes("font-family:Tahoma,'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:600"),'Manual delivery notes do not use the improved readable font style');
check(adminInventory.includes('has_instructions: Boolean(note)')&&!adminInventory.includes('admin_note: note'),'Manual delivery notes are copied into plaintext delivery summaries');
check(myAccountSource.includes('mixedTextHtml(note)')&&myAccountSource.includes('credentialLabel = accountEntry ? copy.account : copy.profile'),'My Account does not render ready-account notes and labels safely');
check(fulfillOrder.includes('تم تأكيد الدفع وطلبك قيد التجهيز')&&fulfillOrder.includes('Paiement confirmé — commande en préparation'),'Processing email does not combine payment confirmation with order preparation');
check(dispatchNotifications.includes('const trusted = configured?.protocol === "https:"'),'Notification action URLs are not restricted to the Strivio HTTPS origin');
const manualPaymentMigration=fs.readFileSync(path.join(root,'supabase','migrations','202607250100_manual_payment_fulfillment.sql'),'utf8');
check(/'payment\.confirmed'[\s\S]*?\n\s*false,\s*\n\s*concat\('manual-payment-confirmed:/.test(manualPaymentMigration),'Manual payment confirmation still sends a duplicate email');

if(failures.length){console.error(failures.map(x=>'FAIL '+x).join('\n'));process.exit(1)}
console.log(`Smoke checks passed for ${htmlFiles.length} pages.`);
