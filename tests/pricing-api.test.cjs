'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createPricingRouter}=require('../OpenNEXT-pricing-api.cjs');
const TOKEN='test-only-admin-token-0123456789';
async function setup(t){
 const calls=[];
 const service={
  getPrices:f=>({records:[],filters:f}),getHistory:f=>({series:[],filters:f}),
  listProviders:()=>({providers:[{id:'aws',name:'AWS',credentialConfigured:false,supportedTerms:['On-demand'],recordCount:4,latestRun:{records:4,finishedAt:'2026-10-13T00:00:00Z'}}]}),
  listRuns:()=>({runs:[]}),getRun:()=>{const e=Error('private provider response');e.statusCode=404;throw e;},
  startRun:id=>({id:'run-1',provider:id}),testProvider:id=>({id:'test-1',provider:id}),
  updateProvider:(id,data)=>{calls.push({id,data});return {id,...data};},
  setCredential:(id,value)=>{calls.push({id,value});return {credential:value};}
 };
 const route=createPricingRouter(service,{env:{OPENNEXT_ADMIN_TOKEN:TOKEN,OPENNEXT_TRUST_PROXY:'1'},capacity:{query:filters=>({terms:['Spot','On-demand','Reserved'],points:[],filters})}});
 const server=http.createServer(async(req,res)=>{if(!await route(req,res,new URL(req.url,'http://localhost'),{onTerminal:req.headers.host==='terminal.example'})){res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(path,options={})=>new Promise((resolve,reject)=>{const req=http.request(base+path,{method:options.method||'GET',headers:options.headers||{}},res=>{let text='';res.setEncoding('utf8');res.on('data',s=>text+=s);res.on('end',()=>resolve({status:res.statusCode,text:async()=>text,json:async()=>JSON.parse(text),headers:{get:key=>{const v=res.headers[key.toLowerCase()];return Array.isArray(v)?v.join(', '):v;}}}));});req.on('error',reject);req.end(options.body);});
 return {request,calls};
}
test('public prices are read-only; histories force AWS; status retains real counts',async t=>{
 const {request}=await setup(t);
 let r=await request('/api/pricing/history?provider=vultr&gpuModel=A100&gpuCount=8&gpuMemoryGb=80');let d=await r.json();
 assert.equal(d.filters.provider,'aws');assert.equal(d.filters.gpuMemoryGb,80);assert.equal(d.filters.gpuCount,8);
 assert.equal((await request('/api/pricing/prices',{method:'POST'})).status,405);
 d=await (await request('/api/pricing/status')).json();assert.equal(d.providers[0].recordCount,4);assert.equal(d.providers[0].lastRunAt,'2026-10-13T00:00:00Z');
});
test('capacity comparison is public read-only and validates exact hardware filters',async t=>{
 const {request}=await setup(t);
 const response=await request('/api/pricing/capacity-history?gpuModel=A10G&gpuCount=1&region=us-west-2&period=1D');
 assert.equal(response.status,200);
 assert.deepEqual((await response.json()).terms,['Spot','On-demand','Reserved']);
 for(const query of ['gpuCount=-1','gpuCount=1.5','gpuMemoryGb=bad','period=invalid'])assert.equal((await request('/api/pricing/capacity-history?'+query)).status,400);
 for(const period of ['1W','1M','3M','1Y','ALL'])assert.equal((await request('/api/pricing/capacity-history?period='+period)).status,403);
 assert.equal((await request('/api/pricing/capacity-history',{method:'POST'})).status,405);
});
test('remote and forwarded requests cannot use loopback admin bypass; Terminal blocks admin',async t=>{
 const {request}=await setup(t);const url='/api/admin/pricing/providers';
 assert.equal((await request(url)).status,200);
 for(const headers of [{Host:'admin.example'},{'X-Forwarded-For':'203.0.113.1'},{'X-Forwarded-Host':'admin.example'},{Forwarded:'for=203.0.113.1'}])assert.equal((await request(url,{headers})).status,401);
 assert.equal((await request(url,{headers:{Host:'terminal.example',Authorization:'Bearer '+TOKEN}})).status,404);
 assert.equal((await request(url,{headers:{Host:'admin.example',Authorization:'Bearer wrong'}})).status,401);
 assert.equal((await request(url,{headers:{Host:'admin.example',Authorization:'Bearer '+TOKEN}})).status,200);
});
test('HTTPS admin session uses HttpOnly cookie and rejects cookie CSRF with invalid Bearer',async t=>{
 const {request,calls}=await setup(t);
 const headers={Host:'admin.example',Origin:'https://admin.example','X-Forwarded-Proto':'https','Content-Type':'application/json'};
 let r=await request('/api/admin/pricing/session',{method:'POST',headers,body:JSON.stringify({token:TOKEN})});assert.equal(r.status,200);
 const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Secure/);
 const auth={...headers,Cookie:cookie.split(';')[0]};
 r=await request('/api/admin/pricing/providers/aws',{method:'PATCH',headers:{...auth,Origin:'https://evil.example',Authorization:'Bearer wrong'},body:'{"enabled":false}'});assert.equal(r.status,403);assert.equal(calls.length,0);
 r=await request('/api/admin/pricing/providers/aws',{method:'PATCH',headers:auth,body:'{"enabled":false}'});assert.equal(r.status,200);assert.equal(calls.length,1);
 r=await request('/api/admin/pricing/session',{method:'POST',headers:{...headers,'X-Forwarded-Proto':'http'},body:JSON.stringify({token:TOKEN})});assert.equal(r.status,403);
});
test('credential input is bounded, never echoed and not accepted over remote HTTP',async t=>{
 const {request,calls}=await setup(t);const path='/api/admin/pricing/providers/lambda/credential';
 const h={Host:'admin.example',Authorization:'Bearer '+TOKEN,'Content-Type':'application/json','X-Forwarded-Proto':'https'};
 let r=await request(path,{method:'POST',headers:h,body:JSON.stringify({credential:'test-fixture-key'})});assert.equal(r.status,200);assert.doesNotMatch(await r.text(),/test-fixture-key/);assert.equal(calls.length,1);
 r=await request(path,{method:'POST',headers:{...h,'X-Forwarded-Proto':'http'},body:JSON.stringify({credential:'test-fixture-key'})});assert.equal(r.status,403);
 r=await request(path,{method:'POST',headers:h,body:JSON.stringify({credential:'x'.repeat(4097)})});assert.equal(r.status,400);
 r=await request(path,{method:'POST',headers:h,body:JSON.stringify({credential:'x'.repeat(9000)})});assert.equal(r.status,413);
 r=await request('/api/admin/pricing/runs/missing',{headers:h});assert.equal(r.status,404);assert.doesNotMatch(await r.text(),/private provider/);
});
