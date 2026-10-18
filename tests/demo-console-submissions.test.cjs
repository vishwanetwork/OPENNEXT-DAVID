'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createDemoService}=require('../OpenNEXT-demo-service.cjs');
const {createDemoData}=require('../OpenNEXT-demo-fixtures.cjs');
const TOKEN='demo-console-test-admin-token-1234567890';
const ADMIN='/api/admin/demo/marketplace';

async function setup(t,{enabled=true,sessionTtlMs=7200000}={}){
  const modulePath=require.resolve('../OpenNEXT-preview-server.cjs');
  const hosts={SITE_HOST:'site.test',TERMINAL_HOST:'terminal.test',ADMIN_HOST:'admin.test'};
  const saved=Object.fromEntries(Object.keys(hosts).map(key=>[key,process.env[key]]));
  let createAppServer;
  try{Object.assign(process.env,hosts);delete require.cache[modulePath];({createAppServer}=require(modulePath));}
  finally{for(const key of Object.keys(hosts))saved[key]===undefined?delete process.env[key]:process.env[key]=saved[key];delete require.cache[modulePath];}
  let clock=Date.now();
  const service=createDemoService({enabled,secureCookies:false,now:()=>clock,sessionTtlMs});
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'opennext-demo-console-test-'));
  const server=createAppServer({dataDir,demoService:service,env:{OPENNEXT_DEMO_ENABLED:enabled?'1':'0',OPENNEXT_ADMIN_TOKEN:TOKEN,OPENNEXT_TRUST_PROXY:'1'},secureCookies:false});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await service.close();assert.equal(path.dirname(path.resolve(dataDir)),path.resolve(os.tmpdir()));await fs.rm(dataDir,{recursive:true,force:true});});
  function request(route,{host='terminal.test',method='GET',body,headers={}}={}){
    return new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port:server.address().port,path:route,method,headers:{Host:host,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{
        let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,data:text?JSON.parse(text):null}));
      });
      req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
    });
  }
  const admin=(route=ADMIN,options={})=>request(route,{host:'admin.test',...options,headers:{Authorization:'Bearer '+TOKEN,...options.headers}});
  async function start(role='buyer'){
    const response=await request('/api/demo/start',{method:'POST',body:{role},headers:{Origin:'http://terminal.test'}});
    assert.equal(response.status,200,response.text);
    return {cookie:response.headers['set-cookie'][0].split(';')[0],csrf:response.data.user.csrfToken,user:response.data.user};
  }
  function guest(guestSession,route,options={}){
    return request('/api/demo'+route,{...options,headers:{Cookie:guestSession.cookie,'X-CSRF-Token':guestSession.csrf,Origin:'http://terminal.test',...options.headers}});
  }
  const at=hours=>new Date(clock+hours*3600000).toISOString();
  const rfq=(title='Guest workload')=>({kind:'gpu_rental',model:'H100',region:'Singapore',term:'Spot',count:8,hours:48,title,project:'Console workflow',notes:'Customer-submitted testing requirement.',budget:3,start:at(72),quoteDeadline:at(24),visibility:'Public requirements'});
  const kyb=(company='Testing supplier')=>({company,registration:'TEST-123',country:'Singapore',rights:'Authorized test capacity rights.',evidence:'Testing business evidence.',eligibility:true,rightsConfirmed:true});
  const supply=()=>({kind:'gpu_rental',model:'H100',region:'Singapore',term:'On-demand',count:8,hours:48,title:'Testing capacity',notes:'Guest submitted supply.',netPrice:2.5,serviceStart:at(24),serviceEnd:at(96),sshHost:'private-gpu.example.test',sshUser:'private-operator',sshPort:2202});
  return {server,service,request,admin,start,guest,rfq,kyb,supply,advance:ms=>{clock+=ms;}};
}

test('Demo Console is admin-only, host-restricted, and excludes all seeded fixture rows',async t=>{
  const f=await setup(t),session=await f.start();
  assert.equal((await f.guest(session,'/marketplace/public')).data.rfqs.length,117);
  const result=await f.admin();
  assert.equal(result.status,200,result.text);
  assert.equal(result.data.demo,true);assert.equal(result.data.scope,'demo');
  for(const key of ['rfqs','supplies','kyb'])assert.deepEqual(result.data[key],[]);
  assert.match(result.headers['cache-control'],/no-store/);
  assert.equal((await f.request(ADMIN,{host:'admin.test'})).status,401);
  assert.equal((await f.request(ADMIN,{host:'admin.test',headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf}})).status,401);
  for(const host of ['site.test','terminal.test','unknown.test'])assert.equal((await f.request(ADMIN,{host,headers:{Authorization:'Bearer '+TOKEN}})).status,404);
  assert.equal((await f.guest(session,'/admin/demo/marketplace')).status,403);
  assert.equal((await f.guest(session,'/marketplace/console')).status,404);
});

test('Console aggregates only submitted guest RFQs with opaque stable workspace IDs and no production records',async t=>{
  const f=await setup(t),first=await f.start(),second=await f.start();
  const firstCreated=await f.guest(first,'/marketplace/rfqs',{method:'POST',body:f.rfq('First guest requirement')});
  const secondCreated=await f.guest(second,'/marketplace/rfqs',{method:'POST',body:f.rfq('Second guest requirement')});
  assert.equal(firstCreated.status,201,firstCreated.text);assert.equal(secondCreated.status,201,secondCreated.text);
  const production=await f.server.marketplace.saveRfq({id:'production-buyer',email:'buyer@example.test',name:'Production Buyer',role:'buyer',onboardingCompleted:true},f.rfq('Production-only requirement'));
  const snapshot=(await f.admin()).data;
  assert.equal(snapshot.rfqs.length,2);assert.equal(snapshot.supplies.length,0);assert.equal(snapshot.kyb.length,0);
  const firstRow=snapshot.rfqs.find(row=>row.id===firstCreated.data.rfq.id),secondRow=snapshot.rfqs.find(row=>row.id===secondCreated.data.rfq.id);
  assert.match(firstRow.workspaceId,/^DEMO-[a-f0-9-]{36}$/);assert.notEqual(firstRow.workspaceId,secondRow.workspaceId);
  assert.equal(firstRow.demo,true);assert.equal(firstRow.scope,'demo');
  assert.ok(Date.parse(firstRow.workspaceExpiresAt)>Date.now());
  assert.equal(firstRow.submission.receiptId,firstCreated.data.rfq.submission.receiptId);
  assert.equal(firstRow.submission.status,'Received');
  assert.equal(snapshot.rfqs.some(row=>row.id===production.id),false);
  const next=(await f.admin()).data;
  assert.equal(next.rfqs.find(row=>row.id===firstRow.id).workspaceId,firstRow.workspaceId);
  const serialized=JSON.stringify(next);
  for(const secret of [first.cookie.split('=')[1],first.csrf,second.cookie.split('=')[1],second.csrf])assert.equal(serialized.includes(secret),false);
  assert.doesNotMatch(serialized,/csrfToken|opennext_demo_session|directory|sessionKey/);
  assert.equal((await f.server.marketplace.admin()).rfqs.length,1);
  assert.equal((await f.server.marketplace.admin()).rfqs[0].id,production.id);
});

test('Demo KYB approval targets its exact workspace and permits supply submission without publishing or installing',async t=>{
  const f=await setup(t),seller=await f.start('seller'),other=await f.start('seller');
  const submitted=await f.guest(seller,'/marketplace/kyb',{method:'POST',body:f.kyb()});
  const otherSubmitted=await f.guest(other,'/marketplace/kyb',{method:'POST',body:f.kyb('Other supplier')});
  assert.equal(submitted.status,201,submitted.text);assert.equal(otherSubmitted.status,201,otherSubmitted.text);
  const snapshot=(await f.admin()).data;
  const row=snapshot.kyb.find(item=>item.id===submitted.data.review.id),otherRow=snapshot.kyb.find(item=>item.id===otherSubmitted.data.review.id);
  const endpoint=ADMIN+'/kyb/'+row.id;
  const fixtureKyb=createDemoData(Date.now()).kyb[0];
  assert.equal((await f.admin(ADMIN+'/kyb/'+fixtureKyb.id,{method:'PATCH',body:{workspaceId:row.workspaceId,status:'Rejected',reason:'Must not mutate fixture records.'}})).status,404);
  assert.equal((await f.admin(endpoint,{method:'PATCH',body:{workspaceId:otherRow.workspaceId,status:'Approved'}})).status,404);
  assert.equal((await f.admin(endpoint,{method:'PATCH',body:{workspaceId:row.workspaceId,status:'Published'}})).status,400);
  const approval=await f.admin(endpoint,{method:'PATCH',body:{workspaceId:row.workspaceId,status:'Approved',reason:'Checked in the isolated test workspace.'}});
  assert.equal(approval.status,200,approval.text);assert.equal(approval.data.status,'Approved');assert.equal(approval.data.scope,'demo');
  assert.equal((await f.guest(seller,'/marketplace/me')).data.review.status,'Approved');
  assert.equal((await f.guest(other,'/marketplace/me')).data.review.status,'Reviewing');
  const supply=await f.guest(seller,'/marketplace/supplies',{method:'POST',body:f.supply()});
  assert.equal(supply.status,201,supply.text);assert.equal(supply.data.supply.status,'Awaiting agent');
  const captured=(await f.admin()).data.supplies;
  assert.equal(captured.length,1);assert.equal(captured[0].id,supply.data.supply.id);assert.equal(captured[0].workspaceId,row.workspaceId);
  assert.equal(captured[0].sshConfigured,true);assert.equal(captured[0].agentStatus,'Pending');
  assert.equal(captured[0].submission.status,'Received');
  assert.doesNotMatch(JSON.stringify(captured),/sshHost|sshUser|sshPort|private-gpu\.example\.test|private-operator/);
  assert.equal((await f.guest(seller,'/marketplace/supplies/'+supply.data.supply.id+'/agent',{method:'POST',body:{}})).status,403);
  assert.equal((await f.admin(ADMIN+'/supplies/'+supply.data.supply.id+'/agent',{method:'PATCH',body:{workspaceId:row.workspaceId,status:'Succeeded'}})).status,404);
  const production=await f.server.marketplace.admin();
  assert.deepEqual(production.kyb,[]);assert.deepEqual(production.supplies,[]);assert.deepEqual(production.rfqs,[]);
});

test('cookie-authenticated Demo approval requires same-origin and rejection accepts the note alias',async t=>{
  const f=await setup(t),seller=await f.start('seller');
  await f.guest(seller,'/marketplace/kyb',{method:'POST',body:f.kyb()});
  const row=(await f.admin()).data.kyb[0],endpoint=ADMIN+'/kyb/'+row.id;
  const login=await f.request('/api/admin/pricing/session',{host:'admin.test',method:'POST',body:{token:TOKEN},headers:{Origin:'https://admin.test','X-Forwarded-Proto':'https'}});
  assert.equal(login.status,200,login.text);
  const cookie=login.headers['set-cookie'][0].split(';')[0];
  const decision={workspaceId:row.workspaceId,status:'Rejected',note:'Please provide the test registration evidence.'};
  assert.equal((await f.request(endpoint,{host:'admin.test',method:'PATCH',body:decision,headers:{Cookie:cookie,Origin:'https://attacker.invalid'}})).status,403);
  assert.equal((await f.request(endpoint,{host:'admin.test',method:'PATCH',body:decision,headers:{Cookie:cookie}})).status,403);
  const result=await f.request(endpoint,{host:'admin.test',method:'PATCH',body:decision,headers:{Cookie:cookie,Origin:'https://admin.test'}});
  assert.equal(result.status,200,result.text);assert.equal(result.data.status,'Rejected');assert.equal(result.data.reason,decision.note);
  assert.equal((await f.guest(seller,'/marketplace/me')).data.review.status,'Rejected');
  assert.equal((await f.admin(endpoint,{method:'PATCH',body:decision})).status,409);
});

test('expired Demo submissions disappear and cannot be approved or restored via an old workspace ID',async t=>{
  const f=await setup(t,{sessionTtlMs:1000}),seller=await f.start('seller');
  await f.guest(seller,'/marketplace/kyb',{method:'POST',body:f.kyb()});
  const row=(await f.admin()).data.kyb[0];
  assert.ok(row);
  f.advance(1001);
  const snapshot=(await f.admin()).data;
  for(const key of ['rfqs','supplies','kyb'])assert.deepEqual(snapshot[key],[]);
  assert.equal((await f.admin(ADMIN+'/kyb/'+row.id,{method:'PATCH',body:{workspaceId:row.workspaceId,status:'Approved'}})).status,404);
  assert.equal((await f.guest(seller,'/marketplace/me')).status,401);
  const fresh=await f.start('seller');
  await f.guest(fresh,'/marketplace/kyb',{method:'POST',body:f.kyb('New workspace supplier')});
  const next=(await f.admin()).data.kyb;
  assert.equal(next.length,1);assert.notEqual(next[0].workspaceId,row.workspaceId);assert.notEqual(next[0].id,row.id);
});

test('Demo logout removes the workspace from the isolated Console inbox',async t=>{
  const f=await setup(t),buyer=await f.start();
  const created=await f.guest(buyer,'/marketplace/rfqs',{method:'POST',body:f.rfq()});
  assert.equal(created.status,201);
  assert.equal((await f.admin()).data.rfqs.length,1);
  assert.equal((await f.guest(buyer,'/auth/logout',{method:'POST',body:{}})).status,200);
  assert.equal((await f.admin()).data.rfqs.length,0);
});

test('concurrent Demo KYB decisions commit only one decision in the isolated workspace',async t=>{
  const f=await setup(t),seller=await f.start('seller');
  await f.guest(seller,'/marketplace/kyb',{method:'POST',body:f.kyb()});
  const row=(await f.admin()).data.kyb[0],endpoint=ADMIN+'/kyb/'+row.id;
  const outcomes=await Promise.all([
    f.admin(endpoint,{method:'PATCH',body:{workspaceId:row.workspaceId,status:'Approved'}}),
    f.admin(endpoint,{method:'PATCH',body:{workspaceId:row.workspaceId,status:'Rejected',reason:'Second decision must not overwrite the first.'}})
  ]);
  assert.deepEqual(outcomes.map(result=>result.status).sort(),[200,409]);
  const accepted=outcomes.find(result=>result.status===200);
  assert.equal((await f.guest(seller,'/marketplace/me')).data.review.status,accepted.data.status);
  assert.deepEqual((await f.server.marketplace.admin()).kyb,[]);
});

test('a workspace expiring during Console snapshot creation is omitted and cannot be retrieved again',async t=>{
  const f=await setup(t,{sessionTtlMs:1000}),buyer=await f.start();
  await f.guest(buyer,'/marketplace/rfqs',{method:'POST',body:f.rfq()});
  const pending=f.service.consoleSnapshot();
  f.advance(1001);
  const result=await pending;
  assert.deepEqual(result.rfqs,[]);
  assert.deepEqual((await f.service.consoleSnapshot()).rfqs,[]);
  assert.equal((await f.guest(buyer,'/marketplace/me')).status,401);
});

test('disabled Demo keeps its Console endpoints unavailable without affecting production Console',async t=>{
  const f=await setup(t,{enabled:false});
  assert.equal((await f.admin()).status,404);
  assert.equal((await f.admin(ADMIN+'/kyb/KYB-ABCDEF',{method:'PATCH',body:{workspaceId:'DEMO-'+crypto.randomUUID(),status:'Approved'}})).status,404);
  assert.equal((await f.admin('/api/admin/marketplace')).status,200);
});
