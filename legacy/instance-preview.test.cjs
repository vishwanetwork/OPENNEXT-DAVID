'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'OpenNEXT-instances.js'),'utf8');
function fixture({role='Buyer',id='account-a',demo=false,rows=[],storage=new Map(),adapter}={}){
  const events=[],sandbox={Intl,Date,Map,Set,console,OpenNEXTDemo:{active:demo},OpenNEXTAuth:{getUser:()=>({id}),request:async()=>({instances:rows})},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}};
  if(adapter)sandbox.OpenNEXTInstanceLifecycle=adapter;
  vm.runInNewContext(source,sandbox);
  const c={S:{role,identity:{email:id+'@example.invalid'},instances:rows,orders:[],route:'instances'},open:(...args)=>events.push(['open',...args]),toast:m=>events.push(['toast',m]),render:()=>events.push(['render']),persist:()=>events.push(['persist'])};
  return {api:sandbox.OpenNEXTInstances,c,events,sandbox,storage};
}
const active=()=>({id:'INS-1',name:'Training resource',region:'Singapore',provider:'Private provider',model:'H100 SXM',term:'Spot',status:'Running',count:8,rate:2.3,paymentStatus:'Paid',resaleAllowed:true,availableResellCount:2,sshHost:'ssh.example.invalid',serviceEnd:new Date(Date.now()+86400000).toISOString(),telemetry:{utilizationPercent:50,observedAt:new Date().toISOString()}});
function form(id='INSTANCE-EXAMPLE',example=true){const note={textContent:''},button={disabled:false,isConnected:true};return {dataset:{form:'instance-end',id,example:String(example)},isConnected:true,querySelector:q=>q.includes('error')?note:button,note,button};}

test('cards contain only region metadata and no supplier identity',()=>{
  const f=fixture();const page=f.api.page(f.c);
  assert.match(page,/<h1>Instances<\/h1>/);assert.match(page,/instance-example-meta">US East<\/p>/);
  assert.doesNotMatch(page,/ins-1024|Northstar|Provider|PROVIDER/);assert.equal(f.c.S.instances.length,0);
  const seller=fixture({role:'Seller'});assert.doesNotMatch(seller.api.page(seller.c),/List supply|new-supply/);
  const real=fixture({rows:[active()]});assert.match(real.api.page(real.c),/instance-example-meta">Singapore<\/p>/);assert.doesNotMatch(real.api.page(real.c),/Private provider/);
});

test('known lifecycle labels normalize without inventing non-Spot reconnection',()=>{
  const {api}=fixture();const i=active();
  assert.equal(api.lifecycle(i).label,'Running');
  for(const status of ['Ended','Released','Expired','Completed'])assert.equal(api.lifecycle({...i,status}).label,'End');
  assert.equal(api.lifecycle({...i,serviceEnd:new Date(Date.now()-1).toISOString()}).label,'End');
  for(const status of ['Interrupted','Reconnecting','Connecting','Disconnected','Offline'])assert.equal(api.lifecycle({...i,status}).label,'Connecting');
  assert.equal(api.lifecycle({...i,connectionStatus:'Interrupted'}).label,'Connecting');
  assert.equal(api.lifecycle({...i,term:'On-demand',connectionStatus:'Interrupted'}).label,'Running');
  assert.notEqual(api.lifecycle({...i,term:'Reserved',status:'Connecting'}).label,'Connecting');
  assert.equal(api.lifecycle({...i,serviceEnd:undefined,end:Date.now()-1}).label,'End');
  assert.equal(api.lifecycle({...i,serviceEnd:undefined,end:Date.now()+60000}).label,'Running');
  assert.equal(api.lifecycle({...i,connectionStatus:'Disconnected'}).label,'Connecting');
  assert.equal(api.lifecycle({...i,term:'On-demand',connectionStatus:'Offline'}).label,'Running');
});

test('resale keeps telemetry, payment, whole GPU, threshold and Spot interruption guards',()=>{
  const {api}=fixture(),i=active();assert.equal(api.eligibility(i,{role:'Buyer'}).allowed,true);
  for(const change of [{paymentStatus:'Unpaid'},{resaleAllowed:false},{availableResellCount:.5},{availableResellCount:0},{status:'Ended'},{status:'Interrupted'},{telemetry:{utilizationPercent:95,observedAt:new Date().toISOString()}},{telemetry:{utilizationPercent:50,observedAt:new Date(Date.now()-121000).toISOString()}}])assert.equal(api.eligibility({...i,...change},{role:'Buyer'}).allowed,false);
  assert.equal(api.eligibility(i,{role:'Seller'}).allowed,false);
  assert.equal(api.eligibility({...i,serviceEnd:undefined,end:Date.now()+86400000},{role:'Buyer'}).allowed,true);
  assert.equal(api.eligibility({...i,serviceEnd:undefined,end:Date.now()-1},{role:'Buyer'}).allowed,false);
});

test('example END requires confirmation, persists by identity and resets without creating an order',async()=>{
  const f=fixture(),before=JSON.stringify(f.c.S),node=form();
  await f.api.finishEnd(f.c,node,{});assert.equal(f.api.example(f.c).status,'Running');assert.match(node.note.textContent,/Confirm/);
  await f.api.finishEnd(f.c,node,{confirmEnd:'yes'});assert.equal(f.api.lifecycle(f.api.example(f.c)).label,'End');
  assert.equal(f.c.S.instances.length,0);assert.equal(f.c.S.orders.length,0);
  const again=fixture({storage:f.storage});assert.equal(again.api.lifecycle(again.api.example(again.c)).label,'End');
  const another=fixture({id:'account-b',storage:f.storage});assert.equal(another.api.lifecycle(another.api.example(another.c)).label,'Running');
  const manage=f.api.modal(f.c,'instance-example-manage').body;assert.match(manage,/instance-example-connect"[^>]*disabled/);assert.match(manage,/Reset example/);assert.match(manage,/instance-example-order/);
  f.api.setExampleScenario(f.c,'reset');assert.equal(f.api.example(f.c).status,'Running');
  f.api.setExampleScenario(f.c,'interrupted');assert.equal(f.api.lifecycle(f.api.example(f.c)).label,'Connecting');
  f.api.setExampleScenario(f.c,'running');assert.equal(f.api.example(f.c).status,'Running');
  assert.ok(before.includes('"instances":[]'));
});

test('demo termination survives workspace refresh without rewriting server resources',async()=>{
  const row={...active(),sample:true};const f=fixture({demo:true,rows:[row]});await f.api.finishEnd(f.c,form(row.id,false),{confirmEnd:'yes'});
  assert.equal(row.status,'Running');assert.equal(f.api.lifecycle(f.api.instanceView(row,f.c)).label,'End');
  f.c.S.instances=[{...row}];assert.match(f.api.page(f.c),/data-instance-life="End"/);
  const production=fixture({demo:false,rows:[row],storage:f.storage});assert.equal(production.api.lifecycle(production.api.instanceView(row,production.c)).label,'Running');
});

test('real END fails closed without a configured adapter or authoritative confirmation',async()=>{
  const row=active(),f=fixture({rows:[row]});const modal=f.api.modal(f.c,'instance-end-confirm',{id:row.id});assert.match(modal.body,/termination is not connected/i);assert.match(modal.body,/type="submit"[^>]*disabled/);
  await f.api.finishEnd(f.c,form(row.id,false),{confirmEnd:'yes'});assert.equal(row.status,'Running');
  for(const result of [{confirmed:false,instance:{id:row.id,status:'Ended'}},{confirmed:true,instance:{id:'WRONG',status:'Ended'}},{confirmed:true,instance:{id:row.id,status:'Running',serviceEnd:'2020-01-01'}}]){
    f.sandbox.OpenNEXTInstanceLifecycle={end:async()=>result};await f.api.finishEnd(f.c,form(row.id,false),{confirmEnd:'yes'});assert.equal(row.status,'Running');
  }
  let called;f.sandbox.OpenNEXTInstanceLifecycle={end:async input=>{called=input;return {confirmed:true,instance:{id:row.id,status:'Released',releasedAt:new Date().toISOString()}};}};
  await f.api.finishEnd(f.c,form(row.id,false),{confirmEnd:'yes'});assert.equal(called.instanceId,row.id);assert.equal(called.confirmation,'END');assert.equal(row.status,'Released');
});

test('legacy release and modal are intercepted; Order opens existing Billing purchase details',()=>{
  const row=active(),f=fixture({rows:[row]});f.c.S.orders=[{id:'ORDER-77',instanceId:row.id}];
  assert.equal(f.api.action(f.c,'end-instance',{dataset:{id:row.id}}),true);assert.equal(row.status,'Running');assert.equal(f.events.at(-1)[1],'instance-end-confirm');
  const view=f.api.modal(f.c,'instance',{id:row.id});assert.match(view.body,/ORDER-77/);assert.doesNotMatch(view.body,/Private provider|PROVIDER/);
  f.api.action(f.c,'instance-order',{dataset:{id:row.id}});assert.equal(f.events.at(-1)[1],'bill-order');assert.equal(f.events.at(-1)[2].id,'ORDER-77');
  const example=f.api.modal(f.c,'instance-example-order');assert.match(example.body,/Example only · no purchase/);assert.doesNotMatch(example.body,/PROVIDER|Northstar/);
});
