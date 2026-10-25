'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','OpenNEXT-console-marketplace.js'),'utf8');
const snapshot=(extra={})=>({rfqs:[],supplies:[],kyb:[],featured:[],generatedAt:'2026-10-18T03:00:00.000Z',...extra});
const received={receiptId:'RCPT-123',source:'terminal',status:'Received',receivedAt:'2026-10-18T02:00:00.000Z',updatedAt:'2026-10-18T02:30:00.000Z',revision:2};
const rental={id:'RFQ-RENTAL',ownerId:'user-1',ownerEmail:'buyer@example.test',ownerName:'Buyer One',company:'Example Company',kind:'gpu_rental',model:'H200',region:'Singapore',title:'Training cluster',project:'Research',vcpu:128,memory:141,count:8,hours:72,term:'On-demand',budget:2.15,status:'Open',createdAt:'2026-10-18T02:00:00.000Z',updatedAt:'2026-10-18T02:30:00.000Z',submission:received,requestId:'REQ-client-1',notes:'Dedicated bare metal',network:'Full NVSwitch',storage:'30 TB NVMe',image:'Ubuntu',sla:'99.9%',shareClosingPrice:true,visibility:'Public requirements'};
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
  for(const selector of ['h1','.market-console-status','.market-console-sync','.market-console-results','.market-console-table','[data-market-action="refresh"]','[data-market-query]','[data-market-kind]','[data-market-status]','[data-market-source]','[data-review-filter]'])nodes.set(selector,new Element());
  const tabs=['rfqs','supplies','kyb','featured'].map(name=>{const e=new Element();e.dataset.marketTab=name;return e;}),counts=tabs.map(tab=>{const e=new Element();e.dataset.marketCount=tab.dataset.marketTab;return e;});
  root.querySelector=selector=>nodes.get(selector);root.querySelectorAll=selector=>selector==='[data-market-tab]'?tabs:selector==='[data-market-count]'?counts:[];
  const document=new Element();document.hidden=false;document.activeElement=new Element();document.querySelector=selector=>selector==='.on-marketplace-console'?root:null;document.createElement=()=>new Element();document.body={append:el=>dialogs.push(el)};
  const window=new Element();let next=initial,id=0;
  const context={window,document,AbortController,console,URL,FormData:class{constructor(form){return Object.entries(form.formValues||{});}},setInterval:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearInterval:key=>timers.delete(key),fetch:async(url,options)=>{requests.push({url,options});if(typeof next==='function')return next(url,options);if(next instanceof Error)throw next;return {ok:!next.error,status:next.status||200,json:async()=>next};}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','OpenNEXT-rfq-details.js'),'utf8'),context);
  vm.runInNewContext(source,context);
  const api=window.OpenNEXTConsoleMarketplace;
  const action=(name,id,workspace)=>({closest:selector=>selector==='[data-market-action]'?{dataset:{marketAction:name,id,workspace}}:null});
  return {api,root,nodes,counts,document,window,requests,timers,dialogs,load:async(selected='rfqs',options={})=>{api.render(selected,options);api.mount();await api.refresh();},setNext:value=>{next=value;},table:()=>nodes.get('.market-console-table').innerHTML,click:(name,id,workspace)=>root.emit('click',{target:action(name,id,workspace)}),tab:name=>root.emit('click',{target:{closest:selector=>selector==='[data-market-tab]'?{dataset:{marketTab:name}}:null}}),filter:(selector,value,event='change')=>{const el=nodes.get(selector);el.value=value;el.emit(event);},tick:async()=>{for(const timer of timers.values())timer.fn();await api.refresh();}};
}

test('Console lists RFQs by email, model and hardware with all commercial details in the modal',async()=>{
  const s=setup(snapshot({rfqs:[rental,model,hardware]}));await s.load();
  const html=s.table();
  for(const label of ['Email','Model','vCPU','Memory','Request type','Details'])assert.match(html,new RegExp('<th>'+label+'</th>'));
  assert.match(html,/buyer@example.test/);assert.match(html,/H200/);assert.match(html,/>128</);assert.match(html,/141 GB \/ GPU/);assert.match(html,/On-demand/);
  assert.doesNotMatch(html,/72 hours|\$39,500\.00|RCPT-123/);
  await s.click('details',rental.id);const detail=s.dialogs.at(-1).innerHTML;
  assert.match(detail,/RCPT-123/);assert.match(detail,/Received/);assert.match(detail,/Maximum Quote Price/);assert.match(detail,/\$1,238\.40/);
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
  for(const text of ['Account ID','user-1','Company','Example Company','Receipt revision','RCPT-123','REQ-client-1','Full NVSwitch','30 TB NVMe','Ubuntu','99.9%','Share the awarded price'])assert.ok(html.includes(text),text);
  assert.match(html,/class="rfq-request-details"/);assert.ok(html.indexOf('data-rfq-field="vcpu"')<html.indexOf('data-rfq-field="count"'));
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
  const s=setup(snapshot({rfqs:[{...rental,submission:{...received,receivedAt:'invalid'}}]}));await s.load();await s.click('details',rental.id);const html=s.dialogs.at(-1).innerHTML;assert.match(html,/Recorded; receipt unavailable/);assert.doesNotMatch(html,/>Received<\/strong>/);s.api.destroy();
});

test('Console navigation exposes a dedicated Demo submissions page',()=>{
  const admin=fs.readFileSync(path.join(__dirname,'..','OpenNEXT-admin.js'),'utf8');assert.match(admin,/demoSubmissions:'Demo submissions'/);assert.match(admin,/demoSubmissions:\(\)=>window\.OpenNEXTConsoleMarketplace\.render\('rfqs',\{scope:'demo'\}\)/);
});

const externalRfq={
  id:'EXT-packet-demand-1',external:true,executable:false,responseMode:'operations',kind:'gpu_rental',
  title:'B200 or H200 cluster',model:'B200',modelOptions:['B200','H200'],modelBudgets:{B200:3,H200:1.7},
  region:'US · UK',regionScope:{type:'countries',countries:['US','GB']},
  quantity:{minNodes:64,maxNodes:128,gpusPerNode:8,totalGpusMin:512,sourceMinimum:true},
  rentalMonths:{min:12,max:24,preferred:24,notes:'Longer term preferred'},budget:3,
  status:'Approved',reviewStatus:'Approved',reviewRevision:2,reviewedBy:'User-confirmed batch approval',
  reviewedAt:'2026-10-18T15:30:00Z',reviewReason:'Initial batch confirmed for publication.',
  provenance:{kind:'external',sourceId:'packet',sourceName:'Packet.ai',sourceUrl:'https://packet.ai/demand',sourceRecordId:'packet-b200-64-128',observedAt:'2026-10-18T15:29:31Z',importedAt:'2026-10-18T15:30:00Z',batchId:'packet-demand-approved-2026-10-18'},
  notes:'Dedicated interconnect; confirm delivery and payment terms with operations.',
  audit:[{event:'Approved',at:'2026-10-18T15:30:00Z',actor:'User-confirmed approval',reason:'Approved batch'}]
};

test('Source labels distinguish first-party and external records without fake accounts or durations',async()=>{
  const s=setup(snapshot({rfqs:[rental,externalRfq],supplies:[{...externalRfq,id:'EXT-supply-1',budget:undefined,netPrice:2.3}]}));await s.load();
  assert.match(s.table(),/<th>Email<\/th>/);assert.match(s.table(),/OpenNEXT Terminal/);assert.match(s.table(),/Packet\.ai/);
  assert.match(s.table(),/First-party submission/);assert.match(s.table(),/External · operations handled/);
  await s.click('details',externalRfq.id);const html=s.dialogs.at(-1).innerHTML;assert.match(html,/64–128 nodes · 512\+ GPUs · 8 GPUs \/ node/);assert.match(html,/12–24 months/);assert.match(html,/Imported/);
  assert.match(s.table(),/No OpenNEXT account assigned/);
  s.filter('[data-market-source]','external:packet');assert.doesNotMatch(s.table(),/RFQ-RENTAL|buyer@example\.test|Account email unavailable|hours|undefined|\[object Object\]/);
  assert.equal(s.nodes.get('.market-console-results').textContent,'1 of 2 records');
  await s.tab('supplies');assert.match(s.table(),/<th>Source<\/th>/);assert.match(s.table(),/Packet\.ai/);assert.match(s.table(),/\$2\.30/);
  s.api.destroy();
});

test('Source filter and source/batch search combine with market and status filters',async()=>{
  const other={...externalRfq,id:'EXT-other',provenance:{...externalRfq.provenance,sourceId:'other',sourceName:'Other Market',sourceRecordId:'other-123',batchId:'other-batch'}};
  const s=setup(snapshot({rfqs:[rental,externalRfq,other]}));await s.load();
  const sources=s.nodes.get('[data-market-source]').innerHTML;for(const value of ['All sources','OpenNEXT Terminal','Packet.ai','Other Market'])assert.ok(sources.includes(value),value);
  s.filter('[data-market-query]','packet-demand-approved','input');assert.match(s.table(),/EXT-packet-demand-1/);assert.doesNotMatch(s.table(),/EXT-other|RFQ-RENTAL/);
  s.filter('[data-market-query]','other market','input');assert.match(s.table(),/EXT-other/);assert.doesNotMatch(s.table(),/EXT-packet-demand-1/);
  s.filter('[data-market-source]','terminal');assert.match(s.table(),/No matching records/);
  s.filter('[data-market-query]','','input');assert.match(s.table(),/RFQ-RENTAL/);assert.doesNotMatch(s.table(),/EXT-other/);
  s.filter('[data-market-source]','external:packet');s.filter('[data-market-status]','Open');assert.match(s.table(),/No matching records/);
  s.api.destroy();
});

test('External details retain provenance, review audit, quantities, model variants and only factual dates',async()=>{
  const s=setup(snapshot({rfqs:[externalRfq]}));await s.load();await s.click('details',externalRfq.id);
  const html=s.dialogs.at(-1).innerHTML;
  for(const text of ['Original external record ID','packet-b200-64-128','Source observed','Imported','Import batch','packet-demand-approved-2026-10-18','Review revision','Reviewed by','User-confirmed batch approval','B200 / H200','B200 target price','H200 target price','$1.70','64–128 nodes','512+ GPUs','12–24 months','24 months','Longer term preferred','US, GB','Approved batch'])assert.ok(html.includes(text),text);
  assert.match(html,/href="https:\/\/packet\.ai\/demand" target="_blank" rel="noopener noreferrer"/);
  assert.match(html,/Withdraw from Terminal/);assert.doesNotMatch(html,/Reject external record|Approve for Terminal|data-market-form="rfq"|Account ID|Account name|Service start|Service end|Quote deadline|hours|Agent completion/);
  s.api.destroy();
});

test('Source links allow HTTPS without credentials and escape all other source content',async()=>{
  for(const sourceUrl of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>','http://packet.ai/demand','https://user:pass@packet.ai/demand','not a url']){
    const record={...externalRfq,provenance:{...externalRfq.provenance,sourceName:'<script>unsafe</script>',sourceUrl}};
    const s=setup(snapshot({rfqs:[record]}));await s.load();await s.click('details',record.id);const html=s.dialogs.at(-1).innerHTML;
    assert.doesNotMatch(html,/<a class="market-source-link"|<script>/);assert.match(html,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.doesNotMatch(s.table(),/<script>/);s.api.destroy();
  }
});

function externalDecision(s,decision,reason,revision='2'){
  const dialog=s.dialogs.at(-1),error=new Element(),form=new Element(),button=new Element();
  form.dataset={marketForm:'external',id:externalRfq.id,revision};form.formValues={reason};form.querySelector=()=>error;button.value=decision;
  return {error,send:()=>dialog.emit('submit',{target:form,submitter:button})};
}

test('External approval uses its protected endpoint with current revision, never native RFQ review',async()=>{
  const pending={...externalRfq,status:'Reviewing',reviewStatus:'Reviewing'};
  const s=setup(snapshot({rfqs:[pending]}));await s.load();await s.click('details',pending.id);
  assert.match(s.dialogs.at(-1).innerHTML,/Approve for Terminal/);assert.match(s.dialogs.at(-1).innerHTML,/Reject external record/);assert.match(s.dialogs.at(-1).innerHTML,/data-market-form="external"/);assert.match(s.dialogs.at(-1).innerHTML,/data-revision="2"/);assert.doesNotMatch(s.dialogs.at(-1).innerHTML,/Withdraw from Terminal|data-market-form="rfq"/);
  const decision=externalDecision(s,'Approved','Source facts reviewed.');
  s.setNext((url,options)=>({ok:true,status:200,json:async()=>options.method==='PATCH'?externalRfq:snapshot({rfqs:[externalRfq]})}));
  await decision.send();const patch=s.requests.find(r=>r.options.method==='PATCH');
  assert.equal(patch.url,'/api/admin/marketplace/external/'+externalRfq.id);assert.equal(patch.options.credentials,'same-origin');assert.deepEqual(JSON.parse(patch.options.body),{status:'Approved',reason:'Source facts reviewed.',expectedRevision:2});
  assert.equal(s.requests.filter(r=>r.url.includes('/marketplace/rfqs/')).length,0);s.api.destroy();
});

test('External withdrawal and rejection require reasons and cannot use stale review revisions',async()=>{
  for(const decision of ['Withdrawn','Rejected']){
    const record=decision==='Rejected'?{...externalRfq,status:'Reviewing',reviewStatus:'Reviewing'}:externalRfq;
    const s=setup(snapshot({rfqs:[record]}));await s.load();await s.click('details',externalRfq.id);
    const missing=externalDecision(s,decision,'');await missing.send();assert.match(missing.error.textContent,/Explain why/);assert.equal(s.requests.filter(r=>r.options.method==='PATCH').length,0);
    const stale=externalDecision(s,decision,'Source withdrawn.','1');await stale.send();assert.match(stale.error.textContent,/current revision/);assert.equal(s.requests.filter(r=>r.options.method==='PATCH').length,0);
    const valid=externalDecision(s,decision,'Source withdrawn.');await valid.send();const patch=s.requests.find(r=>r.options.method==='PATCH');assert.equal(JSON.parse(patch.options.body).status,decision);s.api.destroy();
  }
});

test('External supply uses the same source audit and separate operations review',async()=>{
  const s=setup(snapshot({supplies:[{...externalRfq,netPrice:2.8,status:'Reviewing',reviewStatus:'Reviewing'}]}));await s.load('supplies');await s.click('details',externalRfq.id);
  const html=s.dialogs.at(-1).innerHTML;assert.match(html,/Original external record ID/);assert.match(html,/data-market-form="external"/);assert.match(html,/Approve for Terminal/);assert.match(html,/\$2\.80/);assert.doesNotMatch(html,/SSH endpoint|Agent completion|data-market-form="rfq"/);s.api.destroy();
});

test('Adapter-generated source keys are not misrepresented as source-site record IDs and audit details remain visible',async()=>{
  const record={...externalRfq,provenance:{...externalRfq.provenance,sourceRecordIdKind:'adapter-key'},audit:[{at:'2026-10-18T15:30:00Z',action:'Initial batch approved',detail:'Approved by direct user confirmation.',actor:'Operations'}]};
  const s=setup(snapshot({rfqs:[record]}));await s.load();await s.click('details',record.id);const html=s.dialogs.at(-1).innerHTML;
  assert.match(html,/Source adapter key/);assert.doesNotMatch(html,/Original external record ID/);assert.match(html,/Initial batch approved/);assert.match(html,/Approved by direct user confirmation\./);assert.match(html,/Operations/);s.api.destroy();
});

test('Demo source remains isolated and cannot call external review even with forged external fields',async()=>{
  const record={...demoRow(externalRfq),status:'Reviewing',reviewStatus:'Reviewing'};
  const s=setup(demoSnapshot({rfqs:[record]}));await s.load('rfqs',{scope:'demo'});assert.match(s.table(),/Demo · test only/);assert.doesNotMatch(s.table(),/market-source external|Packet\.ai/);
  await s.click('details',record.id,record.workspaceId);assert.doesNotMatch(s.dialogs.at(-1).innerHTML,/data-market-form="external"/);
  const invalid=externalDecision(s,'Approved','Test');await invalid.send();assert.match(invalid.error.textContent,/valid external market record/);assert.equal(s.requests.filter(r=>r.options.method==='PATCH').length,0);s.api.destroy();
});

test('External quantities and month options preserve source values and do not fabricate absent capacity',async()=>{
  const s=setup(snapshot({rfqs:[{...externalRfq,quantity:{nodes:128,gpusPerNode:8,totalGpusMin:1024,sourceMinimum:true},rentalMonths:{min:6,options:[6,12]}},{...externalRfq,id:'EXT-unspecified',quantity:null,rentalMonths:null}]}));await s.load();
  await s.click('details',externalRfq.id);let html=s.dialogs.at(-1).innerHTML;
  assert.match(html,/128 nodes · 1,024\+ GPUs · 8 GPUs \/ node/);assert.match(html,/6 \/ 12 months/);
  await s.click('details','EXT-unspecified');html=s.dialogs.at(-1).innerHTML;assert.match(html,/Quantity not provided/);assert.match(html,/Rental duration not provided/);assert.doesNotMatch(html+s.table(),/undefined|NaN|0 hours|Not provided hours|\[object Object\]/);s.api.destroy();
});
