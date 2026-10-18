'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','OpenNEXT-console-marketplace.js'),'utf8');
const snapshot=(extra={})=>({rfqs:[],supplies:[],kyb:[],featured:[],generatedAt:'2026-10-18T03:00:00.000Z',...extra});
const received={receiptId:'RCPT-123',source:'terminal',status:'Received',receivedAt:'2026-10-18T02:00:00.000Z',updatedAt:'2026-10-18T02:30:00.000Z',revision:2};
const rental={id:'RFQ-RENTAL',ownerId:'user-1',ownerEmail:'buyer@example.test',ownerName:'Buyer One',company:'Example Company',kind:'gpu_rental',model:'H200',region:'Singapore',title:'Training cluster',project:'Research',count:8,hours:72,term:'On-demand',budget:2.15,status:'Open',createdAt:'2026-10-18T02:00:00.000Z',updatedAt:'2026-10-18T02:30:00.000Z',submission:received,requestId:'REQ-client-1',notes:'Dedicated bare metal',network:'Full NVSwitch',storage:'30 TB NVMe',image:'Ubuntu',sla:'99.9%',shareClosingPrice:true,visibility:'Public requirements'};
const model={id:'RFQ-MODEL',ownerEmail:'model@example.test',kind:'model_capacity',model:'Model A',region:'Germany',title:'Model workload',inputMillion:4,outputMillion:2,days:30,tps:100,budget:34,status:'Quoted',count:0,hours:0,notes:'Authorized API access'};
const hardware={id:'RFQ-HARDWARE',ownerEmail:'hardware@example.test',kind:'physical_gpu',model:'H100 PCIe',region:'Japan',title:'Hardware purchase',count:2,hours:0,budget:39500,status:'Open',condition:'New',shippingAddress:'Business address',incoterms:'DAP',warranty:'12 months'};

class Element{
  constructor(){this.dataset={};this.listeners=new Map();this.hidden=false;this.isConnected=true;this.value='';this.innerHTML='';this.textContent='';this.disabled=false;this.classList={toggle(){}};}
  addEventListener(type,fn,options={}){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);options.signal?.addEventListener('abort',()=>this.removeEventListener(type,fn),{once:true});}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  emit(type,extra={}){return Promise.all([...(this.listeners.get(type)||[])].map(fn=>fn({target:this,preventDefault(){},stopPropagation(){},...extra})));}
  showModal(){this.open=true;}
  close(){this.open=false;this.emit('close');}
  remove(){this.isConnected=false;}
  focus(){this.focused=true;}
}
function setup(initial=snapshot()){
  const root=new Element(),nodes=new Map(),requests=[],timers=new Map(),dialogs=[];
  for(const selector of ['h1','.market-console-status','.market-console-sync','.market-console-results','.market-console-table','[data-market-action="refresh"]','[data-market-query]','[data-market-kind]','[data-market-status]','[data-review-filter]'])nodes.set(selector,new Element());
  const tabs=['rfqs','supplies','kyb','featured'].map(name=>{const e=new Element();e.dataset.marketTab=name;return e;}),counts=tabs.map(tab=>{const e=new Element();e.dataset.marketCount=tab.dataset.marketTab;return e;});
  root.querySelector=selector=>nodes.get(selector);root.querySelectorAll=selector=>selector==='[data-market-tab]'?tabs:selector==='[data-market-count]'?counts:[];
  const document=new Element();document.hidden=false;document.activeElement=new Element();document.querySelector=selector=>selector==='.on-marketplace-console'?root:null;document.createElement=()=>new Element();document.body={append:el=>dialogs.push(el)};
  const window=new Element();let next=initial,id=0;
  const context={window,document,AbortController,console,FormData:class{constructor(form){return Object.entries(form.formValues||{});}},setInterval:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearInterval:key=>timers.delete(key),fetch:async(url,options)=>{requests.push({url,options});if(typeof next==='function')return next(url,options);if(next instanceof Error)throw next;return {ok:!next.error,status:next.status||200,json:async()=>next};}};
  vm.runInNewContext(source,context);
  const api=window.OpenNEXTConsoleMarketplace;
  const action=(name,id,workspace)=>({closest:selector=>selector==='[data-market-action]'?{dataset:{marketAction:name,id,workspace}}:null});
  return {api,root,nodes,counts,document,window,requests,timers,dialogs,load:async(selected='rfqs',options={})=>{api.render(selected,options);api.mount();await api.refresh();},setNext:value=>{next=value;},table:()=>nodes.get('.market-console-table').innerHTML,click:(name,id,workspace)=>root.emit('click',{target:action(name,id,workspace)}),tab:name=>root.emit('click',{target:{closest:selector=>selector==='[data-market-tab]'?{dataset:{marketTab:name}}:null}}),filter:(selector,value,event='change')=>{const el=nodes.get(selector);el.value=value;el.emit(event);},tick:async()=>{for(const timer of timers.values())timer.fn();await api.refresh();}};
}

test('Console lists production submissions with independent receipts and market-aware units',async()=>{
  const s=setup(snapshot({rfqs:[rental,model,hardware]}));await s.load();
  const html=s.table();
  assert.match(html,/8 GPUs/);assert.match(html,/72 hours/);assert.match(html,/USD \/ GPU-hour/);
  assert.match(html,/4M input \/ 2M output tokens/);assert.match(html,/30 days/);assert.match(html,/USD total request/);
  assert.match(html,/One-time hardware purchase/);assert.match(html,/\$39,500\.00/);
  assert.match(html,/RCPT-123/);assert.match(html,/Received/);assert.match(html,/Receipt not available/);assert.match(html,/Recorded/);
  assert.equal(s.nodes.get('.market-console-results').textContent,'3 of 3 records');assert.equal(s.counts[0].textContent,'3');
  assert.match(s.nodes.get('.market-console-sync').textContent,/Last synced/);assert.equal(s.requests[0].options.credentials,'same-origin');assert.equal(s.requests[0].options.cache,'no-store');
  assert.doesNotMatch(html,/0 GPU|0 hours|Preview buyer/);s.api.destroy();
});

test('supply rows show the unmarked quoted price without inventing missing values',async()=>{
  const supply={...rental,id:'SUP-1',budget:undefined,netPrice:2,buyerPrice:2.1,status:'Awaiting agent',agentStatus:'Pending'};
  const s=setup(snapshot({supplies:[supply,{...hardware,id:'SUP-2',netPrice:null,buyerPrice:null}]}));await s.load('supplies');
  assert.match(s.table(),/\$2\.00/);assert.doesNotMatch(s.table(),/\$2\.10/);assert.match(s.table(),/Agent: Pending/);assert.match(s.table(),/Not provided/);assert.doesNotMatch(s.table(),/\$0\.00/);
  s.api.destroy();
});

test('market, state and account search filters work together with accurate counts',async()=>{
  const s=setup(snapshot({rfqs:[rental,model,hardware]}));await s.load();
  s.filter('[data-market-kind]','model_capacity');assert.match(s.table(),/RFQ-MODEL/);assert.doesNotMatch(s.table(),/RFQ-RENTAL|RFQ-HARDWARE/);
  s.filter('[data-market-status]','Open');assert.match(s.table(),/No matching records/);
  s.filter('[data-market-status]','All');s.filter('[data-market-kind]','All');s.filter('[data-market-query]','buyer@example.test','input');assert.match(s.table(),/RFQ-RENTAL/);assert.doesNotMatch(s.table(),/RFQ-MODEL/);assert.equal(s.nodes.get('.market-console-results').textContent,'1 of 3 records');
  s.api.destroy();
});

test('details include full requirements, receipt revision and account while escaping customer content',async()=>{
  const s=setup(snapshot({rfqs:[{...rental,notes:'<script>alert(1)</script>'}]}));await s.load();s.click('details',rental.id);
  const html=s.dialogs.at(-1).innerHTML;
  for(const text of ['Account ID','user-1','Company','Example Company','Receipt revision','RCPT-123','REQ-client-1','Full NVSwitch','30 TB NVMe','Ubuntu','99.9%','Share closing price'])assert.ok(html.includes(text),text);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.doesNotMatch(html,/name="decision"/);s.api.destroy();
});

test('refresh keeps a successful snapshot with a stale warning on failure, but clears it on auth loss',async()=>{
  const s=setup(snapshot({rfqs:[rental]}));await s.load();s.setNext(Error('Backend unavailable.'));await s.api.refresh();
  assert.match(s.table(),/RFQ-RENTAL/);assert.match(s.nodes.get('.market-console-status').textContent,/last successful snapshot is retained/);assert.match(s.nodes.get('.market-console-sync').textContent,/out of date/);
  s.setNext({error:'Administrator session expired.',status:401});await s.api.refresh();
  assert.doesNotMatch(s.table(),/buyer@example.test|RFQ-RENTAL/);assert.match(s.table(),/Administrator access required/);assert.equal(s.counts[0].textContent,'0');
  s.setNext(snapshot({rfqs:[hardware]}));await s.api.refresh();assert.match(s.table(),/RFQ-HARDWARE/);assert.equal(s.nodes.get('.market-console-status').hidden,true);s.api.destroy();
});

test('missing backend or incomplete snapshots never imply new submissions or a successful sync',async()=>{
  const s=setup({error:'Backend not configured.',status:503});await s.load();assert.match(s.table(),/Submission data unavailable/);assert.match(s.nodes.get('.market-console-sync').textContent,/No successful server sync/);
  s.setNext({rfqs:[rental]});await s.api.refresh();assert.match(s.nodes.get('.market-console-status').textContent,/incomplete snapshot/);assert.doesNotMatch(s.table(),/RFQ-RENTAL/);s.api.destroy();
});

test('concurrent refresh calls coalesce and teardown aborts requests and clears refresh hooks',async()=>{
  const s=setup();let resolveRequest,signal;
  s.setNext((url,options)=>{signal=options.signal;return new Promise(resolve=>{resolveRequest=resolve;});});s.api.render();s.api.mount();
  const one=s.api.refresh(),two=s.api.refresh();assert.equal(one,two);assert.equal(s.requests.length,1);assert.equal(s.nodes.get('[data-market-action="refresh"]').disabled,true);
  s.api.destroy();assert.equal(signal.aborted,true);assert.equal(s.timers.size,0);assert.equal(s.window.listeners.get('focus').size,0);assert.equal(s.document.listeners.get('visibilitychange').size,0);
  resolveRequest({ok:true,status:200,json:async()=>snapshot({rfqs:[rental]})});await one;assert.doesNotMatch(s.table(),/RFQ-RENTAL/);
});

test('automatic refresh runs every thirty seconds only while visible, and resumes on focus',async()=>{
  const s=setup();await s.load();assert.equal([...s.timers.values()][0].ms,30000);
  s.document.hidden=true;for(const timer of s.timers.values())timer.fn();assert.equal(s.requests.length,1);
  s.document.hidden=false;s.window.emit('focus');await s.api.refresh();assert.equal(s.requests.length,2);
  for(const timer of s.timers.values())timer.fn();await s.api.refresh();assert.equal(s.requests.length,3);s.api.destroy();
});

test('RFQ review shows complete details and submits the required current revision',async()=>{
  const record={...rental,status:'Reviewing',reviewStatus:'Reviewing',reviewRevision:3,reviewSubmittedAt:'2026-10-18T02:30:00Z'};
  const s=setup(snapshot({rfqs:[record]}));await s.load();await s.click('details',record.id);
  const dialog=s.dialogs.at(-1);assert.match(dialog.innerHTML,/Approve RFQ/);assert.match(dialog.innerHTML,/Reject RFQ/);assert.match(dialog.innerHTML,/data-revision="3"/);assert.match(dialog.innerHTML,/separate Homepage review/);
  const error=new Element(),form=new Element();form.dataset={marketForm:'rfq',id:record.id,revision:'3'};form.formValues={reason:'Requirements verified.'};form.querySelector=()=>error;
  const button=new Element();button.value='Approved';
  s.setNext((url,options)=>({ok:true,status:200,json:async()=>options.method==='PATCH'?{...record,status:'Open',reviewStatus:'Approved'}:snapshot({rfqs:[{...record,status:'Open',reviewStatus:'Approved'}]})}));
  await dialog.emit('submit',{target:form,submitter:button});
  const sent=s.requests.find(r=>r.options.method==='PATCH');assert.equal(sent.url,'/api/admin/marketplace/rfqs/'+record.id);assert.deepEqual(JSON.parse(sent.options.body),{status:'Approved',reason:'Requirements verified.',expectedRevision:3});assert.match(s.table(),/Live RFQ/);s.api.destroy();
});

test('approved private RFQs remain explicitly private in Console',async()=>{
  const s=setup(snapshot({rfqs:[{...rental,status:'Open',reviewStatus:'Approved',visibility:'Private RFQ'}]}));await s.load();assert.match(s.table(),/Approved · Private RFQ/);assert.doesNotMatch(s.table(),/Live RFQ/);s.api.destroy();
});

test('KYB and homepage review remain separate approval gates',async()=>{
  const kyb={id:'KYB-1',company:'Company',email:'seller@example.test',country:'Singapore',registration:'REG-1',status:'Reviewing',submittedAt:'2026-10-18T02:00:00Z',evidence:'Business evidence',rights:'Supply rights'};
  const featured={id:'FEATURED-1',sourceId:'RFQ-1',model:'H200',side:'demand',current:true,status:'Pending',snapshot:{title:'H200 request',price:2,ownerEmail:'buyer@example.test',region:'Singapore',count:8,hours:72},fingerprint:'fingerprint-1'};
  const s=setup(snapshot({kyb:[kyb],featured:[featured]}));await s.load('kyb');s.click('details','KYB-1');assert.match(s.dialogs.at(-1).innerHTML,/Approve KYB & rights/);
  s.tab('featured');s.click('details','FEATURED-1');assert.match(s.dialogs.at(-1).innerHTML,/Approve for homepage/);assert.match(s.dialogs.at(-1).innerHTML,/fingerprint-1/);s.api.destroy();
});

const demoRow=row=>({...row,scope:'demo',demo:true,workspaceId:'DEMO-opaque-workspace',workspaceExpiresAt:'2026-10-18T04:00:00.000Z'});
const demoSnapshot=extra=>({scope:'demo',demo:true,rfqs:[],supplies:[],kyb:[],generatedAt:'2026-10-18T03:00:00.000Z',...extra});

test('Demo submissions use an isolated endpoint with test-only disclosure and no homepage approval',async()=>{
  const s=setup(demoSnapshot({rfqs:[demoRow(rental)]}));
  const html=s.api.render('featured',{scope:'demo'});assert.match(html,/DEMO · TEST ONLY/);assert.match(html,/Workspaces expire/);assert.doesNotMatch(html,/data-market-tab="featured"/);assert.match(html,/Demo submissions · Buyer RFQs/);
  await s.load('rfqs',{scope:'demo'});assert.equal(s.requests[0].url,'/api/admin/demo/marketplace');assert.match(s.table(),/DEMO-opaque-workspace/);assert.match(s.table(),/Expires/);
  s.tab('featured');assert.match(s.nodes.get('h1').textContent,/Buyer RFQs/);assert.doesNotMatch(s.table(),/Review candidate|Approve for homepage/);
  s.click('details',rental.id,'DEMO-opaque-workspace');assert.match(s.dialogs.at(-1).innerHTML,/Demo · test only/);assert.match(s.dialogs.at(-1).innerHTML,/Workspace expires/);s.api.destroy();
});

test('Console refuses snapshots from the other scope and never mixes demo and production records',async()=>{
  const s=setup(snapshot({rfqs:[rental]}));await s.load('rfqs',{scope:'demo'});assert.match(s.nodes.get('.market-console-status').textContent,/different workspace scope/);assert.doesNotMatch(s.table(),/RFQ-RENTAL/);
  s.setNext(demoSnapshot({rfqs:[demoRow(rental)]}));await s.api.refresh();assert.match(s.table(),/RFQ-RENTAL/);
  await s.load('rfqs');assert.equal(s.requests.at(-1).url,'/api/admin/marketplace');assert.match(s.nodes.get('.market-console-status').textContent,/incomplete snapshot|different workspace scope/);assert.doesNotMatch(s.table(),/RFQ-RENTAL/);
  s.setNext(snapshot({rfqs:[hardware]}));await s.api.refresh();assert.match(s.table(),/RFQ-HARDWARE/);assert.doesNotMatch(s.table(),/DEMO-opaque-workspace/);s.api.destroy();
});

test('Demo details select both record and workspace and expired records disappear after refresh',async()=>{
  const s=setup(demoSnapshot({rfqs:[demoRow(rental),{...demoRow(rental),workspaceId:'DEMO-other',notes:'Other workspace requirement'}]}));await s.load('rfqs',{scope:'demo'});
  s.click('details',rental.id,'DEMO-other');assert.match(s.dialogs.at(-1).innerHTML,/Other workspace requirement/);assert.doesNotMatch(s.dialogs.at(-1).innerHTML,/DEMO-opaque-workspace/);
  s.setNext(demoSnapshot());await s.api.refresh();assert.doesNotMatch(s.table(),/RFQ-RENTAL/);assert.match(s.table(),/expired workspaces are removed/);s.api.destroy();
});

test('Demo KYB approval carries exact workspace ID only to the test API',async()=>{
  const kyb=demoRow({id:'KYB-DEMO',company:'Demo company',email:'guest@demo.invalid',country:'Singapore',registration:'DEMO-REG',status:'Reviewing',evidence:'Test evidence',rights:'Test rights'});
  const s=setup(demoSnapshot({kyb:[kyb]}));await s.load('kyb',{scope:'demo'});s.click('details',kyb.id,kyb.workspaceId);const modal=s.dialogs.at(-1);
  assert.match(modal.innerHTML,/Approve Demo KYB & rights/);assert.match(modal.innerHTML,/data-workspace="DEMO-opaque-workspace"/);
  const form=new Element(),error=new Element(),button=new Element();form.dataset={marketForm:'review',id:kyb.id,workspace:kyb.workspaceId};form.formValues={reason:'Reviewed for testing only.'};form.querySelector=()=>error;button.value='Approved';
  s.setNext(async(url,options)=>({ok:true,status:200,json:async()=>options.method==='PATCH'?{kyb:{...kyb,status:'Approved'}}:demoSnapshot({kyb:[{...kyb,status:'Approved'}]})}));
  await modal.emit('submit',{target:form,submitter:button});
  const patch=s.requests.find(r=>r.options.method==='PATCH');assert.equal(patch.url,'/api/admin/demo/marketplace/kyb/KYB-DEMO');assert.deepEqual(JSON.parse(patch.options.body),{status:'Approved',reason:'Reviewed for testing only.',workspaceId:kyb.workspaceId});assert.match(s.table(),/Approved/);assert.equal(s.requests.filter(r=>r.url==='/api/admin/marketplace').length,0);s.api.destroy();
});

test('malformed server receipts remain Recorded rather than falsely acknowledged',async()=>{
  const s=setup(snapshot({rfqs:[{...rental,submission:{...received,receivedAt:'invalid'}}]}));await s.load();assert.match(s.table(),/>Recorded</);assert.match(s.table(),/Receipt not available/);assert.doesNotMatch(s.table(),/>Received</);s.api.destroy();
});

test('Console navigation exposes a dedicated Demo submissions page',()=>{
  const admin=fs.readFileSync(path.join(__dirname,'..','OpenNEXT-admin.js'),'utf8');assert.match(admin,/demoSubmissions:'Demo submissions'/);assert.match(admin,/demoSubmissions:\(\)=>window\.OpenNEXTConsoleMarketplace\.render\('rfqs',\{scope:'demo'\}\)/);
});
