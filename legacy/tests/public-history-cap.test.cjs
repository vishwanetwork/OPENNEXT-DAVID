'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPricingRouter}=require('../OpenNEXT-pricing-api.cjs');
const {createSpotHistoryStore}=require('../OpenNEXT-spot-history.cjs');
const paths=['regional-history','capacity-history','imported-history','history','ticker'];
function fixture({points=Array.from({length:8},(_,i)=>({date:'2026-10-'+String(11+i),value:2,high:3,low:1}))}={}){
 const snapshot={schemaVersion:1,asOf:'2026-10-18',regions:[{code:'us-east-1',name:'US East'}],series:[{id:'h100',provider:'aws',region:'us-east-1',zone:'us-east-1a',instanceType:'p5.48xlarge',gpuModel:'H100',gpuCount:8,gpuMemoryGb:80,term:'Spot',points}]};
 const store=createSpotHistoryStore({readFile:async()=>JSON.stringify(snapshot)}),calls=[];
 const importedHistory=Object.fromEntries(['query','catalog','ticker'].map(method=>[method,async filters=>{calls.push({method,filters});return store[method](filters);} ]));
 const route=createPricingRouter({getHistory:filters=>{calls.push({method:'history',filters});return {series:[],filters};}},{env:{},importedHistory,capacity:{query:filters=>{calls.push({method:'capacity',filters});return {points:[],filters};},queryRegional:filters=>{calls.push({method:'regional',filters});return {series:[],filters};}}});
 const request=async(path,query='',method='GET')=>{
  let status,body;const res={writeHead:code=>{status=code;},end:value=>{body=JSON.parse(value);}};
  await route({method,headers:{host:'public.example'}},res,new URL('https://public.example/api/pricing/'+path+query));
  return {status,body};
 };
 return {request,calls};
}
test('public history defaults to 3D except the seven-calendar-day ticker, with normalized periods through 3M',async()=>{
 const {request,calls}=fixture();
 for(const path of paths){
  assert.equal((await request(path)).status,200,path);
  assert.equal(calls.at(-1).filters.period,path==='ticker'?'1W':'3D',path);
  for(const period of ['1D','3D','1W','1M','3M','%203m%20']){
   assert.equal((await request(path,'?period='+period)).status,200,path);
   assert.equal(calls.at(-1).filters.period,decodeURIComponent(period).trim().toUpperCase(),path);
  }
 }
});
test('long public history is rejected before any source is read, including alternate routes and ticker',async()=>{
 const {request,calls}=fixture();
 for(const path of paths)for(const period of ['6M','1Y','ALL','%20all%20']){
  const response=await request(path,'?period='+period);
  assert.equal(response.status,403,path+' '+period);
  assert.equal(response.body.code,'HISTORY_ACCESS_REQUIRED');
  assert.match(response.body.error,/Contact Sales/);
  assert.match(response.body.error,/3 months/);
 }
 assert.equal(calls.length,0);
});
test('the free 3M window includes the exact 90-day boundary without returning older or future data',async()=>{
 const end=Date.parse('2026-10-18T00:00:00Z'),date=days=>new Date(end-days*86400000).toISOString().slice(0,10);
 const points=[91,90,89,31,30,3,0,-1].map(days=>({date:date(days),value:2,high:3,low:1}));
 const {request}=fixture({points});
 for(const path of ['imported-history','regional-history','ticker']){
  const response=await request(path,'?period=3M'),rows=response.body.series||response.body.records;
  assert.equal(response.status,200);assert.equal(rows.length,1);
  assert.deepEqual(rows[0].points.map(point=>point.date),[90,89,31,30,3,0].map(date),path);
  assert.equal(response.body.meta.window.from,date(90));assert.equal(response.body.meta.window.to,date(0));
 }
});
test('a short uploaded snapshot stays short when 3M is requested and does not synthesize absent dates',async()=>{
 const {request}=fixture();
 for(const path of ['imported-history','regional-history','ticker']){
  const response=await request(path,'?period=3M'),rows=response.body.series||response.body.records;
  assert.equal(rows[0].points.length,8,path);assert.equal(rows[0].points[0].date,'2026-10-11');
 }
});
test('malformed and duplicate period filters cannot bypass the public cap',async()=>{
 const {request,calls}=fixture();
 for(const path of paths){
  for(const query of ['?period=invalid','?period=3D&period=1M','?period=1M&period=3D','?period='+ 'x'.repeat(500)])assert.equal((await request(path,query)).status,400,path+query);
  assert.equal((await request(path,'?period=1M','POST')).status,405,path);
 }
 assert.equal(calls.length,0);
});
test('uploaded and regional histories retain 3D while the homepage ticker defaults to seven calendar dates',async()=>{
 const {request}=fixture();
 for(const path of ['imported-history','regional-history','ticker']){
  const response=await request(path),rows=response.body.series||response.body.records;
  assert.equal(rows.length,1);
  assert.equal(rows[0].points.length,path==='ticker'?7:4);
  assert.deepEqual(rows[0].points.map(p=>p.date),path==='ticker'?['2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18']:['2026-10-15','2026-10-16','2026-10-17','2026-10-18']);
 }
 const catalog=(await request('history-catalog')).body;
 assert.ok(catalog.regions.length);assert.equal(catalog.series,undefined);
 assert.equal(JSON.stringify(catalog).includes('"points"'),false);
});
