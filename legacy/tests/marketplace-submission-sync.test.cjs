'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createMarketplaceService} = require('../OpenNEXT-marketplace-service.cjs');

const epoch = Date.parse('2026-10-18T12:00:00Z');
const buyer = {id:'sync-buyer',email:'buyer@example.test',name:'Verified Buyer',role:'buyer',onboardingCompleted:true};
const seller = {id:'sync-seller',email:'seller@example.test',name:'Verified Seller',role:'seller',onboardingCompleted:true};
const rfq = {kind:'gpu_rental',model:'H200',region:'Singapore',title:'H200 training requirement',project:'Training rollout',count:8,hours:24,term:'On-demand',budget:3,start:'2026-10-20T12:00:00Z',quoteDeadline:'2026-10-19T12:00:00Z',notes:'Dedicated hardware with root access.',visibility:'Private RFQ',clientSubmissionId:'rfq-request-0001'};
const supply = {kind:'gpu_rental',model:'H200',region:'Singapore',title:'H200 dedicated capacity',count:8,hours:24,term:'On-demand',netPrice:2.5,serviceStart:'2026-10-19T00:00:00Z',serviceEnd:'2026-10-25T00:00:00Z',notes:'Exclusive bare-metal capacity.',sshHost:'gpu.example.test',sshUser:'deploy',sshPort:22,clientSubmissionId:'supply-request-0001'};
async function fixture(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(),'on-submission-sync-'));
  t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  let clock = epoch;
  return {dataDir,service:createMarketplaceService({dataDir,now:()=>clock}),setNow:value=>clock=value};
}
async function approve(service,user=seller) {
  const review=await service.submitKyb(user,{company:'Capacity Example Ltd',registration:'EXAMPLE-001',country:'Singapore',eligibility:true,rightsConfirmed:true,evidence:'Verified registry evidence',rights:'Owned hardware with supply rights'});
  await service.decideKyb(review.id,{status:'Approved'});
}
function assertReceipt(record) {
  assert.match(record.submission.receiptId,/^RCPT-[A-F0-9]{16}$/);
  assert.equal(record.submission.source,'terminal');
  assert.equal(record.submission.status,'Received');
  assert.equal(record.submission.revision,1);
  assert.equal(record.submission.receivedAt,new Date(epoch).toISOString());
}

test('private RFQ is durably visible to Console with a server-owned receipt',async t=>{
  const {service,dataDir}=await fixture(t);
  const row=await service.saveRfq(buyer,{...rfq,ownerName:'Forged name',ownerEmail:'forged@example.test',submission:{receiptId:'forged',status:'Approved',revision:999}});
  assertReceipt(row);
  assert.equal(row.ownerName,buyer.name);
  assert.equal(row.ownerEmail,buyer.email);
  assert.equal(row.status,'Reviewing');
  assert.deepEqual((await service.publicMarket()).rfqs,[]);
  const restarted=createMarketplaceService({dataDir,now:()=>epoch});
  const consoleData=await restarted.admin();
  assert.equal(consoleData.rfqs.length,1);
  assert.equal(consoleData.rfqs[0].id,row.id);
  assert.deepEqual(consoleData.rfqs[0].submission,row.submission);
  assert.equal(consoleData.generatedAt,new Date(epoch).toISOString());
  assert.equal((await restarted.mine(buyer)).rfqs[0].submission.receiptId,row.submission.receiptId);
});

test('Supply reaches Console before agent installation without becoming public',async t=>{
  const {service,dataDir}=await fixture(t);
  await approve(service);
  const row=await service.createSupply(seller,{...supply,status:'Published',agentStatus:'Succeeded',submission:{receiptId:'forged'}});
  assertReceipt(row);
  assert.equal(row.ownerName,seller.name);
  assert.equal(row.status,'Awaiting agent');
  assert.equal(row.agentStatus,'Pending');
  assert.equal(row.buyerPrice,2.5);
  const restarted=createMarketplaceService({dataDir,now:()=>epoch});
  const consoleRow=(await restarted.admin()).supplies[0];
  assert.equal(consoleRow.id,row.id);
  assert.equal(consoleRow.sshConfigured,true);
  assert.equal(consoleRow.sshHost,undefined);
  assert.equal(consoleRow.sshUser,undefined);
  assert.deepEqual(consoleRow.submission,row.submission);
  assert.deepEqual((await restarted.publicMarket()).supplies,[]);
  await restarted.requestAgent(seller,row.id);
  assert.equal((await restarted.admin()).supplies[0].submission.revision,1);
});

test('RFQ edits update one Console row and advance its stable receipt revision',async t=>{
  const {service,setNow}=await fixture(t);
  const original=await service.saveRfq(buyer,rfq);
  setNow(epoch+10000);
  const edited=await service.saveRfq(buyer,{...rfq,budget:3.5,notes:'Updated storage requirement.',submission:{revision:2000}},original.id);
  assert.equal(edited.id,original.id);
  assert.equal(edited.submission.receiptId,original.submission.receiptId);
  assert.equal(edited.submission.receivedAt,original.submission.receivedAt);
  assert.equal(edited.submission.updatedAt,new Date(epoch+10000).toISOString());
  assert.equal(edited.submission.revision,2);
  const rows=(await service.admin()).rfqs;
  assert.equal(rows.length,1);
  assert.equal(rows[0].budget,3.5);
  assert.equal(rows[0].notes,'Updated storage requirement.');
  const retriedCreate=await service.saveRfq(buyer,rfq);
  assert.equal(retriedCreate.id,original.id);
  assert.equal(retriedCreate.submission.revision,2);
  assert.equal(retriedCreate.budget,3.5);
});

test('parallel identical RFQ retries create one record and one receipt',async t=>{
  const {service,dataDir}=await fixture(t);
  const rows=await Promise.all(Array.from({length:12},()=>service.saveRfq(buyer,{...rfq})));
  assert.equal(new Set(rows.map(row=>row.id)).size,1);
  assert.equal(new Set(rows.map(row=>row.submission.receiptId)).size,1);
  assert.equal((await service.admin()).rfqs.length,1);
  const stored=JSON.parse(await fs.readFile(path.join(dataDir,'marketplace.json'),'utf8'));
  assert.equal(stored.submissionRequests.length,1);
  assert.equal(stored.submissionRequests[0].requestId,rfq.clientSubmissionId);
  assert.match(stored.submissionRequests[0].hash,/^[a-f0-9]{64}$/);
});

test('parallel Supply retries remain one pending Console submission',async t=>{
  const {service}=await fixture(t);
  await approve(service);
  const rows=await Promise.all(Array.from({length:8},()=>service.createSupply(seller,{...supply})));
  assert.equal(new Set(rows.map(row=>row.id)).size,1);
  assert.equal((await service.admin()).supplies.length,1);
  assert.deepEqual((await service.publicMarket()).supplies,[]);
});

test('a reused submission ID rejects changed details rather than silently losing edits',async t=>{
  const {service}=await fixture(t);
  await service.saveRfq(buyer,rfq);
  await assert.rejects(service.saveRfq(buyer,{...rfq,budget:4}),{status:409});
  await approve(service);
  await service.createSupply(seller,supply);
  await assert.rejects(service.createSupply(seller,{...supply,sshHost:'other.example.test'}),{status:409});
  const admin=await service.admin();
  assert.equal(admin.rfqs.length,1);
  assert.equal(admin.supplies.length,1);
});

test('retry lookup precedes expired date validation and survives service restart',async t=>{
  const {service,dataDir}=await fixture(t);
  const requirement=await service.saveRfq(buyer,rfq);
  await approve(service);
  const capacity=await service.createSupply(seller,supply);
  const restarted=createMarketplaceService({dataDir,now:()=>epoch+30*86400000});
  assert.equal((await restarted.saveRfq(buyer,rfq)).id,requirement.id);
  assert.equal((await restarted.createSupply(seller,supply)).id,capacity.id);
  assert.equal((await restarted.admin()).rfqs.length,1);
  assert.equal((await restarted.admin()).supplies.length,1);
});

test('idempotency is scoped to the verified owner and cannot bypass authorization',async t=>{
  const {service}=await fixture(t);
  const first=await service.saveRfq(buyer,rfq);
  const other={...buyer,id:'another-buyer',email:'another@example.test'};
  const second=await service.saveRfq(other,rfq);
  assert.notEqual(first.id,second.id);
  await assert.rejects(service.saveRfq({...buyer,onboardingCompleted:false},rfq),{status:403});
  await assert.rejects(service.saveRfq({...buyer,role:'seller'},rfq),{status:403});
  await assert.rejects(service.saveRfq(other,rfq,first.id),{status:404});
  await assert.rejects(service.createSupply(seller,supply),{status:409});
  assert.equal((await service.mine(other)).rfqs.length,1);
  assert.equal((await service.mine(other)).rfqs[0].id,second.id);
});

test('failed validation does not reserve a submission ID or emit a receipt',async t=>{
  const {service,dataDir}=await fixture(t);
  await assert.rejects(service.saveRfq(buyer,{...rfq,region:'Anywhere'}),{status:400});
  assert.equal((await service.admin()).rfqs.length,0);
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir,'marketplace.json'),'utf8')).submissionRequests.length,0);
  const corrected=await service.saveRfq(buyer,rfq);
  assertReceipt(corrected);
  for(const clientSubmissionId of ['', 'bad key!', 'x'.repeat(129)])await assert.rejects(service.saveRfq(buyer,{...rfq,clientSubmissionId}),{status:400});
  assert.equal((await service.admin()).rfqs.length,1);
});

test('internal idempotency metadata and account identity are absent from public market feeds',async t=>{
  const {service}=await fixture(t);
  const row=await service.saveRfq(buyer,{...rfq,visibility:'Public requirements'});
  const market=await service.publicMarket();
  const serialized=JSON.stringify(market);
  for(const privateValue of [rfq.clientSubmissionId,row.submission.receiptId,buyer.email,buyer.name])assert.ok(!serialized.includes(privateValue));
  for(const value of [row,await service.mine(buyer),await service.admin()]){
    assert.equal(value.submissionRequests,undefined);
    assert.ok(!JSON.stringify(value).includes(rfq.clientSubmissionId));
  }
});

test('request property ordering and forged server-only fields do not alter retry identity',async t=>{
  const {service}=await fixture(t);
  const row=await service.saveRfq(buyer,rfq);
  const reordered=Object.fromEntries(Object.entries(rfq).reverse());
  const retry=await service.saveRfq(buyer,{...reordered,ownerId:'forged',submission:{receiptId:'forged'},serverRecord:false});
  assert.equal(retry.id,row.id);
  assert.equal(retry.ownerId,buyer.id);
  assert.deepEqual(retry.submission,row.submission);
});

test('existing version-2 storage migrates without changing previous records',async t=>{
  const {service,dataDir}=await fixture(t);
  const row=await service.saveRfq(buyer,rfq);
  const file=path.join(dataDir,'marketplace.json');
  const stored=JSON.parse(await fs.readFile(file,'utf8'));
  delete stored.submissionRequests;
  delete stored.rfqs[0].submission;
  await fs.writeFile(file,JSON.stringify(stored));
  const restarted=createMarketplaceService({dataDir,now:()=>epoch});
  assert.equal((await restarted.admin()).rfqs[0].id,row.id);
  const edited=await restarted.saveRfq(buyer,{...rfq,budget:3.25},row.id);
  assertReceipt(edited);
  assert.equal((await restarted.admin()).rfqs.length,1);
});
