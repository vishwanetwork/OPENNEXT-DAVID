'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const syncFs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const os=require('node:os');
const countries=require('../OpenNEXT-countries.js');
const {createMarketplaceService}=require('../OpenNEXT-marketplace-service.cjs');
const source=syncFs.readFileSync(path.join(__dirname,'../OpenNEXT-quote-preview.js'),'utf8');
const procurementSource=syncFs.readFileSync(path.join(__dirname,'../OpenNEXT-procurement.js'),'utf8');
const buyer={id:'quote-buyer-1',email:'buyer@example.test',name:'Buyer',role:'buyer',onboardingCompleted:true};
const offer={id:'reference-on-demand-H100',model:'H100',country:'Singapore',term:'On-demand',gpuCount:8,vcpu:128,memory:80,perGpuHourly:2,instanceHourly:16};
function harness(){
  let current={...buyer};const storage=new Map(),events={},documentEvents={},calls=[];
  const S={user:current,role:'Buyer',identity:{name:'Buyer',email:current.email},notifications:[],rfqs:[],orders:[],model:'H100',region:'All regions',count:8,term:'Spot'};
  const document={activeElement:null,hidden:false,querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(name,fn)=>{documentEvents[name]=fn;}};
  const scope={OpenNEXTCountries:countries,OpenNEXTAuth:{getUser:()=>current},OpenNEXTProcurement:{modal:()=>null},OpenNEXTExchange:{api:async route=>{calls.push(route);return {rfqs:[],notifications:[]};}},addEventListener:(name,fn)=>{events[name]=fn;}};
  const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
  const sandbox={window:scope,document,localStorage,setInterval:()=>0,Intl,Date,Set,Map,console};
  vm.runInNewContext(source,sandbox);
  const opened=[],toasts=[];
  const ctx={S,open:(...args)=>opened.push(args),go:route=>{S.route=route;},toast:text=>toasts.push(text),esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money:v=>'$'+Number(v).toFixed(2),persist(){},render(){}};
  return {api:scope.OpenNEXTQuotePreview,ctx,scope,sandbox,calls,opened,toasts,events,documentEvents,storage,setUser:value=>{current=value;S.user=value;}};
}
test('Ask for quote uses the native RFQ form with a bounded, complete resource snapshot',()=>{
  const h=harness();assert.equal(h.api.open(h.ctx,offer),true);
  const [type,{prefill}]=h.opened[0];assert.equal(type,'rfq-form');
  assert.equal(prefill.requestKind,'quote_request');assert.equal(prefill.model,'H100');assert.equal(prefill.region,'Singapore');assert.equal(prefill.term,'On-demand');assert.equal(prefill.count,8);assert.equal(prefill.budget,2);assert.equal(prefill.vcpu,128);assert.equal(prefill.memory,80);
  assert.deepEqual(JSON.parse(JSON.stringify(prefill.selectedOffer)),offer);
  assert.equal(prefill.notes,'');assert.equal(prefill.originSupply,undefined);assert.equal(prefill.ownerId,undefined);assert.equal(prefill.title,undefined);assert.equal(prefill.project,undefined);
  assert.equal(h.api.testHelpers.prefill({...offer,country:'UAE'}).region,'United Arab Emirates');
  assert.equal(h.api.testHelpers.prefill({...offer,country:'Not a country'}).region,'');
  assert.equal(h.api.testHelpers.prefill({...offer,memory:null}).memory,'');
  assert.equal(h.api.testHelpers.prefill({...offer,memory:null}).selectedOffer.memory,null);
});
test('Quote snapshot rejects nonpositive, malformed and unbounded numbers without manufacturing a price',()=>{
  const h=harness(),prefill=h.api.testHelpers.prefill({...offer,vcpu:-1,memory:'not memory',perGpuHourly:Infinity,instanceHourly:1e20,gpuCount:1.5,id:'x'.repeat(1000),country:'Singapore\n'});
  assert.equal(prefill.vcpu,'');assert.equal(prefill.memory,'');assert.equal(prefill.budget,'');assert.equal(prefill.selectedOffer.vcpu,null);assert.equal(prefill.selectedOffer.memory,null);assert.equal(prefill.selectedOffer.perGpuHourly,null);assert.equal(prefill.selectedOffer.instanceHourly,null);assert.equal(prefill.selectedOffer.gpuCount,null);assert.equal(prefill.selectedOffer.id.length,160);assert.equal(prefill.region,'Singapore');
});
test('Quote hardware prefill matches native form and API bounds, preserving their inclusive endpoints',()=>{
  const h=harness(),prefill=fields=>h.api.testHelpers.prefill({...offer,...fields});
  for(const vcpu of [0,0.5,65537]){assert.equal(prefill({vcpu}).vcpu,'');assert.equal(prefill({vcpu}).selectedOffer.vcpu,null);}
  for(const memory of [0,0.009,65536.01]){assert.equal(prefill({memory}).memory,'');assert.equal(prefill({memory}).selectedOffer.memory,null);}
  for(const vcpu of [1,65536])assert.equal(prefill({vcpu}).vcpu,vcpu);
  for(const memory of [0.01,65536])assert.equal(prefill({memory}).memory,memory);
  assert.equal(prefill({perGpuHourly:0.0000001}).budget,'');assert.equal(prefill({perGpuHourly:0.000001}).budget,0.000001);
  assert.equal(prefill({country:'x'.repeat(101)}).selectedOffer.country.length,100);
});
test('Native form retains editable schedule, duration, acceptance requirements and verified submit route',()=>{
  const h=harness();h.scope.OpenNEXTExchange={...h.scope.OpenNEXTExchange,kindOf:r=>r?.kind||'gpu_rental',get:()=>null,deliveryMethod:()=> 'SSH / root access',budgetRange:()=>null};
  vm.runInNewContext(procurementSource,h.sandbox);
  h.api.open(h.ctx,{...offer,term:'Reserved'});
  const view=h.scope.OpenNEXTProcurement.modal(h.ctx,'rfq-form',h.opened[0][1]);
  assert.match(view.body,/data-form="proc-rfq"/);
  for(const name of ['requestKind','selectedOffer','region','model','vcpu','memory','count','hours','budget','start','quoteDeadline','notes'])assert.ok(view.body.includes('name="'+name+'"'));
  assert.doesNotMatch(view.body,/name="(?:title|project)"/);
  assert.match(view.body,/Submit request/);
  assert.match(procurementSource,/case'proc-rfq':\s+void submitRecord\(c,formEl,'rfq',data\);return true/);
  assert.match(procurementSource,/\/api\/marketplace\/.*rfqs/);
  assert.match(view.body,/No payment is taken/);
});
test('Anonymous and seller sessions cannot open buyer request submission',()=>{
  const h=harness();h.setUser(null);assert.equal(h.api.open(h.ctx,offer),false);assert.equal(h.opened.length,0);
  h.setUser({...buyer,role:'seller'});assert.equal(h.api.open(h.ctx,offer),false);assert.equal(h.opened.length,0);
  h.setUser({...buyer});assert.equal(h.api.open(h.ctx,{...offer,term:'Spot'}),false);
});
test('Only account-owned notifications appear; latest ten and full history remain native',()=>{
  const h=harness();h.ctx.S.notifications=Array.from({length:25},(_,i)=>({id:'N-'+i,ownerId:buyer.id,subject:'Notice '+i,message:'Update',created:new Date(1900000000000+i*1000).toISOString(),read:false}));
  h.ctx.S.notifications.push({id:'foreign',ownerId:'another-user',subject:'Private record'},{id:'legacy',role:'Buyer',subject:'Owner unknown'});
  h.api.bell(h.ctx);assert.equal(h.api.testHelpers.notices().length,25);
  const history=h.api.history(h.ctx);assert.equal((history.match(/data-qp-action="notification"/g)||[]).length,20);assert.match(history,/1–20 of 25 notifications/);assert.doesNotMatch(history,/Private record|Owner unknown/);
  h.api.testHelpers.markRead(['N-0']);assert.equal(h.api.testHelpers.notices().find(n=>n.id==='N-0').read,true);
  h.setUser({...buyer,id:'second-buyer'});h.api.bell(h.ctx);assert.equal(h.api.testHelpers.notices().length,0);assert.equal(h.api.testHelpers.quoteRequests().length,0);
  h.ctx.S.notifications=[{id:'N-0',ownerId:'second-buyer',subject:'Second user',read:false}];assert.equal(h.api.testHelpers.notices()[0].read,false);
});
test('Refresh uses authenticated marketplace API; late previous-account response is discarded',async()=>{
  const h=harness();let release;h.scope.OpenNEXTExchange.api=route=>{h.calls.push(route);return new Promise(resolve=>{release=resolve;});};
  h.api.bell(h.ctx);const pending=h.api.refresh(true);
  h.setUser({...buyer,id:'second-buyer'});h.ctx.S.notifications=[];h.api.bell(h.ctx);
  release({rfqs:[{id:'old',ownerId:buyer.id}],notifications:[{id:'private',ownerId:buyer.id,subject:'Old user'}]});await pending;
  assert.deepEqual(h.calls,['/api/marketplace/me']);assert.equal(h.ctx.S.notifications.length,0);assert.equal(h.api.testHelpers.notices().length,0);
});
test('Structured quote requests and legacy records are included only for the signed-in owner',()=>{
  const h=harness();h.ctx.S.rfqs=[{id:'new',ownerId:buyer.id,requestKind:'quote_request',term:'On-demand',notes:''},{id:'legacy',ownerId:buyer.id,term:'Reserved',notes:'OpenNEXT Terminal quote request\nEarlier listing snapshot'},{id:'ordinary',ownerId:buyer.id,requestKind:'rfq',term:'On-demand',notes:''},{id:'foreign',ownerId:'another-user',requestKind:'quote_request',term:'Reserved'}];
  h.api.bell(h.ctx);assert.deepEqual(Array.from(h.api.testHelpers.quoteRequests(),r=>r.id).sort(),['legacy','new']);
});
test('Quote request and RFQ notification clicks open read-only submitted details',async()=>{
  const h=harness(),request={id:'RFQ-ABCD',ownerId:buyer.id,requestKind:'quote_request',term:'Reserved'},notification={id:'N-1',ownerId:buyer.id,rfqId:request.id,subject:'Request update'};
  h.scope.OpenNEXTExchange.api=async()=>({rfqs:[request],notifications:[notification]});h.api.bind(h.ctx);await h.api.refresh(true);
  const click=(action,id)=>{const button={dataset:{qpAction:action,qpId:id}};h.documentEvents.click({target:{closest:selector=>selector==='[data-qp-action]'?button:null},preventDefault(){},stopPropagation(){}});};
  click('request',request.id);click('notification',notification.id);
  assert.equal(h.opened.length,2);for(const [type,data]of h.opened){assert.equal(type,'proc-request-details');assert.equal(data.id,request.id);}
});
test('Quote notes are safely escaped in account views and no simulator endpoint or false email claim remains',()=>{
  const h=harness();h.ctx.S.notifications=[{id:'one',ownerId:buyer.id,subject:'<script>bad</script>',message:'<img src=x onerror=bad()>',created:new Date().toISOString()}];
  const html=h.api.history(h.ctx);assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(source,/\/api\/demo\/preview|preview-console|Email is queued|email.*sent in this preview/);
  assert.match(source,/Email delivery depends on the configured notification service/);
});
test('Selected quote enters the real Console Reviewing queue with full snapshot and server receipt',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'opennext-quote-release-'));t.after(async()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});});
  const now=Date.now(),service=createMarketplaceService({dataDir:dir,now:()=>now}),h=harness();
  const request={...h.api.testHelpers.prefill(offer),count:32,hours:720,start:new Date(now+72*3600000).toISOString(),quoteDeadline:new Date(now+24*3600000).toISOString(),clientSubmissionId:'release-quote-0001'};
  const saved=await service.saveRfq(buyer,request);assert.equal(saved.status,'Reviewing');assert.equal(saved.reviewStatus,'Reviewing');assert.equal(saved.submission.status,'Received');assert.match(saved.submission.receiptId,/^RCPT-/);
  const consoleData=await service.admin(),row=consoleData.rfqs.find(r=>r.id===saved.id);assert.ok(row);assert.equal(row.requestKind,'quote_request');assert.equal(row.term,'On-demand');assert.equal(row.vcpu,128);assert.equal(row.memory,80);assert.deepEqual(row.selectedOffer,JSON.parse(JSON.stringify(request.selectedOffer)));assert.equal(row.count,32);assert.equal(row.hours,720);assert.equal(row.notes,request.notes);assert.equal(row.ownerEmail,buyer.email);assert.deepEqual((await service.publicMarket()).rfqs,[]);
  const mine=await service.mine(buyer);h.ctx.S.rfqs=mine.rfqs;h.ctx.S.notifications=mine.notifications;assert.match(h.api.requests(h.ctx),/Reviewing/);assert.equal(h.api.testHelpers.notices().length,1);
  const demo=createMarketplaceService({dataDir:path.join(dir,'demo'),now:()=>now,provenanceKind:'demo'});const demoSaved=await demo.saveRfq({...buyer,id:'demo-buyer',demo:true},request);assert.equal(demoSaved.provenance.kind,'demo');assert.equal((await service.admin()).rfqs.length,1);assert.equal((await demo.admin()).rfqs.length,1);
});
