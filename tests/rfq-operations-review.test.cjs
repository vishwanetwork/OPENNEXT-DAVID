'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createMarketplaceService,createMarketplaceRouter}=require('../OpenNEXT-marketplace-service.cjs');
const {createDemoData}=require('../OpenNEXT-demo-fixtures.cjs');
const now=Date.parse('2026-10-18T12:00:00Z');
const buyer={id:'review-buyer',email:'buyer@example.test',name:'Buyer',role:'buyer',onboardingCompleted:true};
const seller={id:'review-seller',email:'seller@example.test',name:'Seller',role:'seller',onboardingCompleted:true};
const input={kind:'gpu_rental',model:'H100',region:'Singapore',title:'Training run',project:'Model training',notes:'Dedicated networking and SSH.',count:8,hours:48,term:'Spot',budget:3,start:new Date(now+72*3600000).toISOString(),quoteDeadline:new Date(now+24*3600000).toISOString()};
async function setup(t){const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'opennext-rfq-review-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));let clock=now;return {dataDir,service:createMarketplaceService({dataDir,now:()=>clock}),advance:ms=>clock+=ms};}
const approve=(service,row)=>service.decideRfq(row.id,{status:'Approved',expectedRevision:row.reviewRevision},'Operations reviewer');
async function request(route,pathname,{method='PATCH',body={},headers={},onTerminal=false}={}){const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,headers:{'content-type':'application/json',...headers}});let status,result;await route(req,{writeHead(code){status=code;},end(value){result=JSON.parse(value);}},new URL(pathname,'http://localhost'),{onTerminal});return {status,result};}

test('new RFQ is immediately owned and in Console, but not public, matched, or quoteable before approval',async t=>{
  const {service}=await setup(t),row=await service.saveRfq(buyer,{...input,status:'Open',reviewStatus:'Approved',reviewRevision:99});
  assert.equal(row.status,'Reviewing');assert.equal(row.reviewStatus,'Reviewing');assert.equal(row.reviewRevision,1);
  assert.equal((await service.mine(buyer)).rfqs[0].id,row.id);assert.equal((await service.admin()).rfqs[0].id,row.id);
  assert.deepEqual((await service.publicMarket()).rfqs,[]);assert.deepEqual((await service.best(seller,{model:'H100'})).rows,[]);
  const kyb=await service.submitKyb(seller,{company:'Supplier',registration:'TEST-1',country:'Singapore',rights:'Owned capacity',evidence:'Registration',eligibility:true,rightsConfirmed:true});await service.decideKyb(kyb.id,{status:'Approved'});
  await assert.rejects(service.submitQuote(seller,row.id,{}),{status:404});
});
test('approval makes public RFQ live, not featured, and notifies its buyer',async t=>{
  const {service}=await setup(t),row=await service.saveRfq(buyer,input),approved=await approve(service,row);
  assert.equal(approved.status,'Open');assert.equal(approved.reviewStatus,'Approved');assert.equal(approved.reviewedBy,'Operations reviewer');
  const market=await service.publicMarket();assert.equal(market.rfqs[0].id,row.id);assert.deepEqual(market.featured.rfqs,[]);
  assert.equal((await service.best(seller,{model:'H100'})).rows[0].id,row.id);
  const notices=(await service.mine(buyer)).notifications;assert.equal(notices[0].rfqId,row.id);assert.match(notices[0].message,/Live RFQ/);
});
test('rejection requires reason, remains private, notifies buyer, and can be resubmitted',async t=>{
  const {service}=await setup(t),row=await service.saveRfq(buyer,input);
  await assert.rejects(service.decideRfq(row.id,{status:'Rejected',expectedRevision:1}),{status:400});
  const rejected=await service.decideRfq(row.id,{status:'Rejected',expectedRevision:1,reason:'Clarify the delivery deadline.'});
  assert.equal(rejected.status,'Rejected');assert.equal(rejected.reviewReason,'Clarify the delivery deadline.');
  assert.deepEqual((await service.publicMarket()).rfqs,[]);assert.match((await service.mine(buyer)).notifications[0].message,/Clarify/);
  const edited=await service.saveRfq(buyer,{...input,notes:'Confirmed delivery window.'},row.id);assert.equal(edited.status,'Reviewing');assert.equal(edited.reviewRevision,2);assert.equal(edited.reviewedAt,null);
});
test('edits withdraw live RFQs and stale or missing review revisions cannot approve changed details',async t=>{
  const {service}=await setup(t),row=await service.saveRfq(buyer,input);await approve(service,row);
  const edited=await service.saveRfq(buyer,{...input,budget:4},row.id);assert.equal(edited.reviewRevision,2);assert.deepEqual((await service.publicMarket()).rfqs,[]);
  for(const expectedRevision of [undefined,null,'2',1])await assert.rejects(service.decideRfq(row.id,{status:'Approved',expectedRevision}),{status:409});
  await approve(service,edited);await assert.rejects(approve(service,edited),{status:409});
});
test('private RFQ also requires approval and never enters public matches or homepage',async t=>{
  const {service}=await setup(t),row=await service.saveRfq(buyer,{...input,visibility:'Private RFQ'});assert.equal(row.status,'Reviewing');await approve(service,row);
  assert.deepEqual((await service.publicMarket()).rfqs,[]);assert.deepEqual((await service.best(seller,{model:'H100'})).rows,[]);assert.deepEqual((await service.admin()).featured,[]);
});
test('expired RFQ cannot be approved, and legacy unreviewed records migrate to Reviewing',async t=>{
  const {service,advance,dataDir}=await setup(t),row=await service.saveRfq(buyer,input);advance(25*3600000);await assert.rejects(approve(service,row),{status:409});
  const db=createDemoData(now);db.rfqs[0].reviewStatus=undefined;db.rfqs[0].status='Open';db.rfqs[0].ownerId=buyer.id;await fs.writeFile(path.join(dataDir,'marketplace.json'),JSON.stringify(db));
  const restarted=createMarketplaceService({dataDir,now:()=>now}),own=(await restarted.mine(buyer)).rfqs[0];assert.equal(own.status,'Reviewing');assert.equal(own.reviewStatus,'Reviewing');assert.ok(!(await restarted.publicMarket()).rfqs.some(r=>r.id===own.id));
});
test('RFQ review API requires administrator authentication, origin, correct method, and admin host scope',async t=>{
  const {service}=await setup(t),row=await service.saveRfq(buyer,input),route=createMarketplaceRouter(service,{security:{authenticated:req=>req.headers.admin==='yes',sameOrigin:req=>req.headers.origin==='http://localhost',bearerAuthenticated:()=>false}}),url='/api/admin/marketplace/rfqs/'+row.id,body={status:'Approved',expectedRevision:1};
  assert.equal((await request(route,url,{body})).status,401);
  assert.equal((await request(route,url,{body,headers:{admin:'yes'}})).status,403);
  assert.equal((await request(route,url,{body,headers:{admin:'yes',origin:'http://localhost'},onTerminal:true})).status,404);
  assert.equal((await request(route,url,{method:'POST',body,headers:{admin:'yes',origin:'http://localhost'}})).status,404);
  assert.equal((await request(route,url,{body,headers:{admin:'yes',origin:'http://localhost'}})).status,200);
});
