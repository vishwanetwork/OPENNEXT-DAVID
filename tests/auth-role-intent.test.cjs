'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../OpenNEXT-auth.js'),'utf8');
const freshUser={id:'new-user',email:'new@example.test',onboardingCompleted:false,role:null,csrfToken:'verified-csrf'};
function setup({search='',pathname='/',storage=new Map(),fetcher}={}){
  const calls=[],events=[];
  const sessionStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  const window={location:{search,pathname,hostname:'terminal.opennextlab.ai',assign:url=>{calls.push({redirect:url});}},sessionStorage,dispatchEvent:event=>events.push(event)};
  const sandbox={window,URLSearchParams,CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail;}},fetch:async(endpoint,options={})=>{calls.push({endpoint,options});return fetcher?fetcher(endpoint,options):{ok:true,json:async()=>({user:freshUser})};}};
  vm.runInNewContext(source,sandbox);
  return {api:window.OpenNEXTAuth,window,storage,calls,events,sandbox};
}
function selected(html,role){return html.includes('data-onboarding-role="'+role+'" aria-pressed="true"');}
function root(){
  const attributes=()=>({values:{},setAttribute(k,v){this.values[k]=v;}});
  const buyer={...attributes(),dataset:{onboardingRole:'buyer'},disabled:false},seller={...attributes(),dataset:{onboardingRole:'seller'},disabled:false};
  const next={disabled:true},back={},box={hidden:true,textContent:'',focus(){}};
  return {buyer,seller,next,box,host:{matches:()=>true,querySelector:selector=>({'[data-auth-back]':back,'[data-onboarding-next]':next,'[data-auth-error]':box})[selector]||null,querySelectorAll:selector=>selector==='[data-onboarding-role]'?[buyer,seller]:[]}};
}
test('Buyer and Seller URL hints preselect first-time onboarding without sending requests',()=>{
  for(const role of ['buyer','seller']){const h=setup({search:'?role='+role});const html=h.api.renderOnboarding(freshUser);assert.equal(h.api.getPreferredRole(),role);assert.ok(selected(html,role));assert.ok(!html.includes('data-onboarding-next disabled'));assert.equal(h.calls.length,0);assert.equal(h.api.getUser().role,null);}
});
test('Invalid, missing and Broker hints do not preselect or authorize a role',()=>{
  for(const search of ['', '?role=broker','?role=admin','?role=%3Cscript%3E']){const h=setup({search});const html=h.api.renderOnboarding(freshUser);assert.equal(h.api.getPreferredRole(),'');assert.match(html,/data-onboarding-next disabled/);assert.equal(h.api.setPreferredRole('broker'),false);assert.equal(h.calls.length,0);}
});
test('Explicit CTA setter and manual onboarding selection remain editable and survive rerender/reload',()=>{
  const h=setup({search:'?role=buyer'});h.api.renderOnboarding(freshUser);const ui=root();h.api.bindOnboarding(ui.host,{});assert.equal(ui.buyer.values['aria-pressed'],'true');assert.equal(ui.next.disabled,false);
  ui.seller.onclick();assert.equal(ui.seller.values['aria-pressed'],'true');assert.equal(ui.buyer.values['aria-pressed'],'false');assert.equal(h.api.getPreferredRole(),'seller');
  h.api.bindOnboarding(ui.host,{});assert.equal(ui.seller.values['aria-pressed'],'true');
  const reloaded=setup({search:'?role=buyer',storage:h.storage});assert.ok(selected(reloaded.api.renderOnboarding(freshUser),'seller'));
  assert.equal(reloaded.api.setPreferredRole('buyer'),true);assert.ok(selected(reloaded.api.renderOnboarding(freshUser),'buyer'));assert.equal(h.calls.length,0);
});
test('Hint survives an email/OAuth same-tab return without the query parameter',async()=>{
  const start=setup({search:'?role=seller'});assert.equal(start.api.getPreferredRole(),'seller');
  const callback=setup({search:'?oauth=complete',storage:start.storage});await callback.api.boot();assert.equal(callback.api.getPreferredRole(),'seller');assert.ok(selected(callback.api.renderOnboarding(callback.api.getUser()),'seller'));
  assert.deepEqual(callback.calls.map(c=>c.endpoint),['/api/auth/session']);
  const copiedTab=setup({storage:new Map(start.storage)});assert.ok(selected(copiedTab.api.renderOnboarding(freshUser),'seller'));
});
test('Changed CTA query replaces an earlier preference but never switches an existing account',async()=>{
  const start=setup({search:'?role=buyer'}),second=setup({search:'?role=seller',storage:start.storage});assert.equal(second.api.getPreferredRole(),'seller');
  const existing={...freshUser,role:'buyer',onboardingCompleted:true};const loggedIn=setup({search:'?role=seller',storage:second.storage,fetcher:async()=>({ok:true,json:async()=>({user:existing})})});await loggedIn.api.boot();
  assert.equal(loggedIn.api.getUser().role,'buyer');assert.equal(loggedIn.api.getPreferredRole(),'');assert.equal(loggedIn.api.setPreferredRole('seller'),false);assert.equal(loggedIn.storage.size,0);
  const html=loggedIn.api.renderOnboarding(existing);assert.doesNotMatch(html,/data-onboarding-role|data-onboarding-next|Your first \$100/);assert.deepEqual(loggedIn.calls.map(c=>c.endpoint),['/api/auth/session']);
});
test('Role is sent only on explicit Next with the verified CSRF token; failure keeps the selection',async()=>{
  const h=setup({search:'?role=seller',fetcher:async()=>({ok:false,status:503,json:async()=>({error:'Please try again.'})})});h.api.renderOnboarding(freshUser);const ui=root();h.api.bindOnboarding(ui.host,{});assert.equal(h.calls.length,0);
  await ui.next.onclick();assert.equal(h.calls.length,1);assert.equal(h.calls[0].endpoint,'/api/auth/onboarding');assert.deepEqual(JSON.parse(h.calls[0].options.body),{role:'seller'});assert.equal(h.calls[0].options.headers['X-CSRF-Token'],'verified-csrf');assert.equal(h.api.getUser().onboardingCompleted,false);assert.equal(h.api.getPreferredRole(),'seller');assert.equal(ui.next.disabled,false);assert.equal(ui.seller.disabled,false);assert.match(ui.box.textContent,/Please try again/);
});
test('Completed onboarding and successful/expired-session logout clear intent; failed logout preserves it',async()=>{
  const completed=setup({search:'?role=seller'});completed.api.renderOnboarding({...freshUser,onboardingCompleted:true,role:'seller'});assert.equal(completed.api.getPreferredRole(),'');assert.equal(completed.storage.size,0);
  for(const status of [200,401,503]){const h=setup({search:'?role=buyer',fetcher:async()=>({ok:status===200,status,json:async()=>({error:'Unavailable'})})});h.api.renderOnboarding(freshUser);if(status===503){await assert.rejects(h.api.logout(),/Unavailable/);assert.equal(h.api.getPreferredRole(),'buyer');}else{await h.api.logout();assert.equal(h.api.getPreferredRole(),'');assert.equal(h.storage.size,0);assert.equal(h.api.getUser(),null);}}
});
test('Account-bound hints cannot leak into another first-time account and Demo storage is separate',()=>{
  const h=setup({search:'?role=seller'});h.api.renderOnboarding(freshUser);h.api.renderOnboarding({...freshUser,id:'different-user'});assert.equal(h.api.getPreferredRole(),'');
  const production=setup({search:'?role=buyer'}),demo=setup({pathname:'/demo/',search:'?role=seller',storage:production.storage});assert.equal(demo.api.getPreferredRole(),'seller');
  const restored=setup({storage:production.storage});assert.equal(restored.api.getPreferredRole(),'buyer');
});
test('Blocked sessionStorage is non-fatal and query preference remains usable in memory',()=>{
  const calls=[],window={location:{search:'?role=seller',pathname:'/'},dispatchEvent(){}};Object.defineProperty(window,'sessionStorage',{get(){throw Error('Blocked');}});
  vm.runInNewContext(source,{window,URLSearchParams,CustomEvent:class{},fetch:async()=>{calls.push('fetch');}});
  assert.ok(selected(window.OpenNEXTAuth.renderOnboarding(freshUser),'seller'));assert.equal(window.OpenNEXTAuth.setPreferredRole('buyer'),true);assert.ok(selected(window.OpenNEXTAuth.renderOnboarding(freshUser),'buyer'));assert.equal(calls.length,0);
});
