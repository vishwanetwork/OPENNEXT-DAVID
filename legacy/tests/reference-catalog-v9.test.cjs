'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createReferenceCatalog}=require('../OpenNEXT-reference-catalog.cjs');
const {MODELS}=require('../OpenNEXT-demo-fixtures.cjs');

test('reference catalog covers every existing Demo GPU and exposes no customer or payment records',()=>{
  const data=createReferenceCatalog(Date.now());
  assert.equal(data.scope,'reference-only');assert.equal(data.executable,false);
  for(const [model] of MODELS){
    for(const field of ['supplies','rfqs','recent'])assert.ok(data[field].filter(row=>row.model===model).length>=5);
  }
  for(const row of [...data.supplies,...data.rfqs,...data.recent]){
    assert.equal(row.referenceOnly,true);assert.equal(row.executable,false);
    assert.match(row.id,/^REF-/);assert.ok(Number.isFinite(row.price));
    for(const key of ['ownerId','ownerEmail','email','registration','paymentStatus','serverRecord','agentId','settledAt'])assert.ok(!(key in row),key);
  }
  assert.equal(data.supplies[0].price,2.03); // Existing H100 fixture rate, without an embedded platform markup.
});

function exchange({demo=false,real=[],recent=[],referenceFailure=false}={}){
  const catalog=createReferenceCatalog(),calls=[];
  const window={OpenNEXTDemo:demo?{active:true}:undefined};
  const fetch=async(url,options)=>{
    calls.push({url,options});
    if(referenceFailure&&url.includes('reference-catalog'))throw Error('Offline');
    return {ok:true,json:async()=>url.includes('reference-catalog')?catalog:url.includes('/settlements')?{rows:recent}:{supplies:real,rfqs:[],featured:{supplies:[],rfqs:[]}}};
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../OpenNEXT-exchange.js'),'utf8'),{window,fetch,URLSearchParams,CustomEvent:class{} });
  const X=window.OpenNEXTExchange,S={model:'H100',region:'All regions',term:'Spot',count:8,role:'Buyer'};X.init(S);
  return {X,S,calls};
}

test('formal Terminal restores same-model references without adding them to public homepage or account records',async()=>{
  const f=exchange();await f.X.refresh(f.S);
  assert.equal(f.X.listPublic('rental','supply').length,0);
  assert.equal(f.S.orders.length,0);assert.equal(f.S.instances.length,0);
  for(const side of ['supply','demand'])assert.ok(f.X.matches(f.S,side).length>=5);
  assert.ok(f.X.best(f.S).length>=5);assert.ok(f.X.recent(f.S).length>=5);
  assert.ok(f.X.best({...f.S,role:'Seller'}).every(r=>r.side==='demand'));
  assert.equal(f.X.matches({...f.S,model:'Unknown GPU'},'supply').length,0);
  assert.ok(f.X.matches({...f.S,region:'Singapore'},'supply').every(r=>r.region==='Singapore'));
  const row=f.X.matches(f.S,'supply')[0];assert.equal(f.X.get(row.id).id,row.id);
  assert.ok(f.calls.every(call=>call.options.method==='GET'));
});

test('real matching inventory takes precedence and Demo never loads formal reference fallback',async()=>{
  const row={id:'SUP-REAL',kind:'rental',side:'supply',model:'H100',region:'Singapore',term:'Spot',count:8,price:2.9};
  const f=exchange({real:[row]});await f.X.refresh(f.S);assert.deepEqual(Array.from(f.X.matches(f.S,'supply'),r=>r.id),['SUP-REAL']);
  const d=exchange({demo:true});await d.X.refresh(d.S);
  assert.equal(d.X.matches(d.S,'supply').length,0);assert.ok(!d.calls.some(c=>c.url.includes('reference-catalog')));
});

test('reference-feed failure does not discard genuine marketplace rows',async()=>{
  const row={id:'SUP-REAL',kind:'rental',side:'supply',model:'H100',region:'Singapore',term:'Spot',count:8,price:2.9};
  const f=exchange({real:[row],referenceFailure:true});await f.X.refresh(f.S);
  assert.equal(f.X.matches(f.S,'supply')[0].id,row.id);assert.equal(f.X.status().error,'');
});

test('recent fallback applies the requested date window before preferring real settlement records',async()=>{
  const row={id:'SETTLED-OLDER',model:'H100',region:'Singapore',settledAt:new Date(Date.now()-10*86400000).toISOString()};
  const f=exchange({recent:[row]});await f.X.refresh(f.S);
  assert.ok(f.X.recent(f.S,3).every(r=>r.referenceOnly&&r.timeBasis==='illustrative'));
  assert.deepEqual(Array.from(f.X.recent(f.S,30),r=>r.id),['SETTLED-OLDER']);
});

test('reference activity contains no fabricated moving settlement dates and survives a long-running server',()=>{
  const data=createReferenceCatalog(Date.now()-30*86400000);
  assert.ok(data.recent.length>0);
  assert.ok(data.recent.every(r=>r.timeBasis==='illustrative'&&!r.activityAt&&!r.settledAt));
});
