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
const operations=fs.readFileSync(path.join(root,'operations.html'),'utf8');
check(operations.includes('openActivationModal'),'Operations activation conversation is missing');
check(operations.includes('activationCredentialsHtml'),'Activation credentials are missing from service records');
check(allText.includes('ops_send_activation_message'),'Admin activation chat RPC is missing');

const auth=fs.readFileSync(path.join(root,'auth.html'),'utf8');
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

if(failures.length){console.error(failures.map(x=>'FAIL '+x).join('\n'));process.exit(1)}
console.log(`Smoke checks passed for ${htmlFiles.length} pages.`);
