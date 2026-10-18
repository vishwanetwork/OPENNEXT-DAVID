'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const ADMIN_TOKEN = 'http-sync-fixture-administrator-token-0123456789';
const hosts = {SITE_HOST:'site.example',TERMINAL_HOST:'terminal.example',ADMIN_HOST:'admin.example'};
const future = days => new Date(Date.now()+days*86400000).toISOString();

async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(),'on-terminal-console-http-'));
  const modulePath = require.resolve('../OpenNEXT-preview-server.cjs');
  const previous = Object.fromEntries(Object.keys(hosts).map(key=>[key,process.env[key]]));
  let createAppServer;
  try {
    Object.assign(process.env,hosts);
    delete require.cache[modulePath];
    ({createAppServer}=require(modulePath));
  } finally {
    for(const key of Object.keys(hosts))previous[key]===undefined?delete process.env[key]:process.env[key]=previous[key];
    delete require.cache[modulePath];
  }
  const server=createAppServer({
    dataDir,secureCookies:false,publicOrigin:'http://terminal.example',
    env:{OPENNEXT_ADMIN_TOKEN:ADMIN_TOKEN,OPENNEXT_TRUST_PROXY:'0',OPENNEXT_DEMO_ENABLED:'1'},
    pricingService:{close:async()=>{},listProviders:async()=>[]},
    capacityService:{close:async()=>{}},contactService:{list:async()=>[]},
    // This identity adapter exists only inside the isolated HTTP test server.
    authAdapter:{
      emailEnabled:true,
      requestEmailCode:async({email})=>({challengeId:'fixture-'+email}),
      verifyEmailCode:async({email,code})=>code==='123456'?{subject:'http-fixture-'+email,email,emailVerified:true,name:email.startsWith('seller')?'Verified Seller':'Verified Buyer'}:null
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    await server.auth.close();
    await fs.rm(dataDir,{recursive:true,force:true});
  });
  function client(host='terminal.example',defaultHeaders={}) {
    const cookies=new Map();
    const request=(route,{input,method=input===undefined?'GET':'POST',headers={}}={})=>new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method,headers:{Host:host,Origin:'http://'+host,Cookie:[...cookies].map(([key,value])=>key+'='+value).join('; '),...(input===undefined?{}:{'Content-Type':'application/json'}),...defaultHeaders,...headers}},res=>{
        for(const cookie of res.headers['set-cookie']||[]){const pair=cookie.split(';')[0],index=pair.indexOf('=');cookies.set(pair.slice(0,index),pair.slice(index+1));}
        let raw='';res.setEncoding('utf8');res.on('data',chunk=>raw+=chunk);res.on('end',()=>{
          let body;try{body=JSON.parse(raw);}catch{body=raw;}
          resolve({status:res.statusCode,body,raw,headers:res.headers});
        });
      });
      req.on('error',reject);req.end(input===undefined?undefined:JSON.stringify(input));
    });
    return {request};
  }
  async function login(email,role) {
    const session=client();
    const start=await session.request('/api/auth/email/request',{input:{email}});
    assert.equal(start.status,200);
    const verified=await session.request('/api/auth/email/verify',{input:{challengeId:start.body.challengeId,code:'123456'}});
    assert.equal(verified.status,200);
    const csrf={'X-CSRF-Token':verified.body.user.csrfToken};
    const onboard=await session.request('/api/auth/onboarding',{input:{role},headers:csrf});
    assert.equal(onboard.status,200);
    return {...session,csrf,user:onboard.body.user};
  }
  return {client,login,admin:client('admin.example',{Authorization:'Bearer '+ADMIN_TOKEN})};
}

function requirement(){return {kind:'gpu_rental',model:'H200',region:'Singapore',title:'Private H200 training requirement',project:'Production training rollout',count:8,hours:24,term:'On-demand',budget:3.5,start:future(3),quoteDeadline:future(2),notes:'Dedicated bare-metal resources with NVSwitch.',visibility:'Private RFQ',clientSubmissionId:'http-rfq-request-0001'};}
function capacity(){return {kind:'gpu_rental',model:'H200',region:'Singapore',title:'H200 verified capacity handoff',count:8,hours:24,term:'On-demand',netPrice:2.5,serviceStart:future(1),serviceEnd:future(5),notes:'Dedicated hardware pending the real installer.',sshHost:'capacity.example.test',sshUser:'deploy',sshPort:22,clientSubmissionId:'http-supply-request-0001'};}

test('verified Terminal RFQ reaches Console over HTTP with one durable server receipt',async t=>{
  const api=await fixture(t),buyer=await api.login('buyer@example.test','buyer'),input=requirement();
  const submitted=await buyer.request('/api/marketplace/rfqs',{input:{...input,ownerEmail:'forged@example.test',submission:{status:'Approved',receiptId:'forged'}},headers:buyer.csrf});
  assert.equal(submitted.status,201);
  const record=submitted.body.rfq;
  assert.match(record.id,/^RFQ-[A-F0-9]+$/);
  assert.match(record.submission.receiptId,/^RCPT-[A-F0-9]+$/);
  assert.equal(record.submission.status,'Received');
  assert.equal(record.ownerEmail,'buyer@example.test');
  const consoleData=await api.admin.request('/api/admin/marketplace');
  assert.equal(consoleData.status,200);
  assert.equal(consoleData.body.rfqs.length,1);
  assert.equal(consoleData.body.rfqs[0].id,record.id);
  assert.deepEqual(consoleData.body.rfqs[0].submission,record.submission);
  assert.ok(Number.isFinite(Date.parse(consoleData.body.generatedAt)));
  const mine=await buyer.request('/api/marketplace/me');
  assert.equal(mine.body.rfqs[0].id,record.id);
  const retry=await buyer.request('/api/marketplace/rfqs',{input,headers:buyer.csrf});
  assert.equal(retry.status,201);
  assert.equal(retry.body.rfq.id,record.id);
  const edited=await buyer.request('/api/marketplace/rfqs/'+record.id,{method:'PATCH',input:{...input,budget:4},headers:buyer.csrf});
  assert.equal(edited.status,200);
  assert.equal(edited.body.rfq.submission.receiptId,record.submission.receiptId);
  assert.equal(edited.body.rfq.submission.revision,2);
  const updated=await api.admin.request('/api/admin/marketplace');
  assert.equal(updated.body.rfqs.length,1);
  assert.equal(updated.body.rfqs[0].budget,4);
  assert.equal(updated.body.rfqs[0].submission.revision,2);
  const publicFeed=await api.client('site.example').request('/api/marketplace/public');
  assert.equal(publicFeed.status,200);
  assert.deepEqual(publicFeed.body.rfqs,[]);
  assert.ok(!publicFeed.raw.includes(record.submission.receiptId));
});

test('HTTP Supply is received in Console after KYB approval and before the installer is connected',async t=>{
  const api=await fixture(t),seller=await api.login('seller@example.test','seller'),input=capacity();
  const before=await seller.request('/api/marketplace/supplies',{input,headers:seller.csrf});
  assert.equal(before.status,409);
  const kyb=await seller.request('/api/marketplace/kyb',{input:{company:'HTTP Capacity Ltd',registration:'HTTP-001',country:'Singapore',rights:'Verified owned hardware with capacity rights.',evidence:'Business registration evidence for test.',eligibility:true,rightsConfirmed:true},headers:seller.csrf});
  assert.equal(kyb.status,201);
  const reviewed=await api.admin.request('/api/admin/marketplace/kyb/'+kyb.body.review.id,{method:'PATCH',input:{status:'Approved'}});
  assert.equal(reviewed.status,200);
  const responses=await Promise.all(Array.from({length:4},()=>seller.request('/api/marketplace/supplies',{input,headers:seller.csrf})));
  assert.ok(responses.every(response=>response.status===201));
  assert.equal(new Set(responses.map(response=>response.body.supply.id)).size,1);
  const record=responses[0].body.supply;
  assert.equal(record.status,'Awaiting agent');
  assert.equal(record.agentStatus,'Pending');
  assert.equal(record.submission.status,'Received');
  const consoleData=await api.admin.request('/api/admin/marketplace');
  assert.equal(consoleData.body.supplies.length,1);
  const consoleRow=consoleData.body.supplies[0];
  assert.equal(consoleRow.id,record.id);
  assert.deepEqual(consoleRow.submission,record.submission);
  assert.equal(consoleRow.buyerPrice,2.625);
  assert.equal(consoleRow.sshConfigured,true);
  assert.equal(consoleRow.sshHost,undefined);
  const install=await seller.request('/api/marketplace/supplies/'+record.id+'/agent',{input:{},headers:seller.csrf});
  assert.equal(install.status,200);
  assert.equal(install.body.configured,false);
  assert.equal(install.body.status,'Pending');
  const publicFeed=await api.client('site.example').request('/api/marketplace/public');
  assert.deepEqual(publicFeed.body.supplies,[]);
  const unchanged=await api.admin.request('/api/admin/marketplace');
  assert.equal(unchanged.body.supplies[0].submission.receiptId,record.submission.receiptId);
  assert.equal(unchanged.body.supplies[0].agentStatus,'Pending');
});

test('HTTP Console submission data stays isolated from public, Terminal and unverified sessions',async t=>{
  const api=await fixture(t),publicClient=api.client('site.example'),terminal=api.client();
  assert.equal((await terminal.request('/api/marketplace/rfqs',{input:requirement()})).status,401);
  assert.equal((await api.client('admin.example').request('/api/admin/marketplace')).status,401);
  assert.equal((await publicClient.request('/api/admin/marketplace',{headers:{Authorization:'Bearer '+ADMIN_TOKEN}})).status,404);
  assert.equal((await terminal.request('/api/admin/marketplace',{headers:{Authorization:'Bearer '+ADMIN_TOKEN}})).status,404);
  const buyer=await api.login('buyer@example.test','buyer'),input=requirement();
  assert.equal((await buyer.request('/api/marketplace/rfqs',{input})).status,403);
  assert.equal((await buyer.request('/api/marketplace/rfqs',{input,headers:{...buyer.csrf,Origin:'https://other.example'}})).status,403);
  assert.equal((await buyer.request('/api/marketplace/rfqs',{input,headers:buyer.csrf})).status,201);
  const conflict=await buyer.request('/api/marketplace/rfqs',{input:{...input,budget:99},headers:buyer.csrf});
  assert.equal(conflict.status,409);
  const consoleData=await api.admin.request('/api/admin/marketplace');
  assert.equal(consoleData.body.rfqs.length,1);
  assert.equal(consoleData.body.rfqs[0].budget,input.budget);
  assert.equal(consoleData.body.submissionRequests,undefined);
  for(const host of ['site.example','terminal.example','admin.example']){
    assert.equal((await api.client(host).request('/.opennext-data/marketplace.json')).status,404);
  }
});
