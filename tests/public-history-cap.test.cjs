'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPricingRouter}=require('../OpenNEXT-pricing-api.cjs');
const {createSpotHistoryStore}=require('../OpenNEXT-spot-history.cjs');
const paths=['regional-history','capacity-history','imported-history','history','ticker'];
function fixture(){
 const snapshot={schemaVersion:1,asOf:'2026-10-18',regions:[{code:'us-east-1',name:'US East'}],series:[{id:'h100',provider:'aws',region:'us-east-1',zone:'us-east-1a',instanceType:'p5.48xlarge',gpuModel:'H100',gpuCount:8,gpuMemoryGb:80,term:'Spot',points:Array.from({length:8},(_,i)=>({date:'2026-10-'+String(11+i),value:2,high:3,low:1}))}]};
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
test('every public history surface defaults to 3D and accepts normalized 1D or 3D only',async()=>{
 const {request,calls}=fixture();
 for(const path of paths){
  assert.equal((await request(path)).status,200,path);
  assert.equal(calls.at(-1).filters.period,'3D',path);
  for(const period of ['1D','3D','%203d%20']){
   assert.equal((await request(path,'?period='+period)).status,200,path);
   assert.equal(calls.at(-1).filters.period,period==='1D'?'1D':'3D',path);
  }
 }
});
test('long public history is rejected before any source is read, including alternate routes and ticker',async()=>{
 const {request,calls}=fixture();
 for(const path of paths)for(const period of ['1W','1M','3M','6M','1Y','ALL']){
  const response=await request(path,'?period='+period);
  assert.equal(response.status,403,path+' '+period);
  assert.equal(response.body.code,'HISTORY_ACCESS_REQUIRED');
  assert.match(response.body.error,/Contact Sales/);
 }
 assert.equal(calls.length,0);
});
test('malformed and duplicate period filters cannot bypass the public cap',async()=>{
 const {request,calls}=fixture();
 for(const path of paths){
  for(const query of ['?period=invalid','?period=3D&period=1M','?period=1M&period=3D','?period='+ 'x'.repeat(500)])assert.equal((await request(path,query)).status,400,path+query);
  assert.equal((await request(path,'?period=1M','POST')).status,405,path);
 }
 assert.equal(calls.length,0);
});
test('uploaded, regional and ticker responses contain only inclusive 3-day points while catalog contains no prices',async()=>{
 const {request}=fixture();
 for(const path of ['imported-history','regional-history','ticker']){
  const response=await request(path),rows=response.body.series||response.body.records;
  assert.equal(rows.length,1);
  assert.equal(rows[0].points.length,4);
  assert.deepEqual(rows[0].points.map(p=>p.date),['2026-10-15','2026-10-16','2026-10-17','2026-10-18']);
 }
 const catalog=(await request('history-catalog')).body;
 assert.ok(catalog.regions.length);assert.equal(catalog.series,undefined);
 assert.equal(JSON.stringify(catalog).includes('"points"'),false);
});
