'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createExternalMarketplace}=require('../OpenNEXT-external-marketplace.cjs');
const {createMarketplaceService,createMarketplaceRouter}=require('../OpenNEXT-marketplace-service.cjs');
const {listPacketDemands,PACKET_APPROVED_BATCH}=require('../OpenNEXT-packet-demand.cjs');
const epoch=Date.parse('2026-10-18T16:00:00Z');
const buyer={id:'external-test-buyer',role:'buyer',email:'buyer@example.test',name:'Buyer',onboardingCompleted:true};
const seller={id:'external-test-seller',role:'seller',email:'seller@example.test',name:'Seller',onboardingCompleted:true};
const batch=()=>({sourceId:PACKET_APPROVED_BATCH.sourceId,sourceName:PACKET_APPROVED_BATCH.sourceName,batchId:PACKET_APPROVED_BATCH.id,approvalReason:PACKET_APPROVED_BATCH.approvalReason,expectedCount:14,records:listPacketDemands()});
const input=(overrides={})=>({...listPacketDemands()[0],externalId:'new-external-record',...overrides});
const importBatch=(records,overrides={})=>({sourceId:'source-test',sourceName:'Source Test',batchId:'future-batch-001',records,...overrides});
async function fixture(t,{seed=true}={}){const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'on-external-v11-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));let clock=epoch;const external=createExternalMarketplace({dataDir,now:()=>clock,checkedBatch:seed?batch():null}),service=createMarketplaceService({dataDir,now:()=>clock,externalService:external});return {dataDir,external,service,advance:ms=>clock+=ms};}
async function approve(external,row){return external.review(row.id,{status:'Approved',expectedRevision:row.reviewRevision},'Operations tester');}
async function request(route,p,{method='GET',body={},headers={},user=seller,onTerminal=false}={}){const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,user,headers:{'content-type':'application/json',...headers}});let status,result;await route(req,{writeHead(code){status=code;},end(value){result=JSON.parse(value);}},new URL(p,'http://localhost'),{onTerminal});return {status,result};}

test('only the explicitly approved checked batch appears immediately with source audit metadata',async t=>{
  const {external}=await fixture(t),rows=await external.publicRows(),admin=await external.admin();
  assert.equal(rows.length,14);assert.equal(admin.records.length,14);
  for(const row of admin.records){assert.equal(row.reviewStatus,'Approved');assert.equal(row.reviewRevision,1);assert.equal(row.provenance.kind,'external');assert.equal(row.provenance.sourceId,'packet-ai');assert.equal(row.provenance.sourceRecordIdKind,'adapter-key');assert.equal(row.provenance.sourceUrl,'https://packet.ai/demand');assert.equal(row.provenance.batchId,PACKET_APPROVED_BATCH.id);assert.match(row.audit[0].detail,/User explicitly approved/);assert.equal(row.ownerId,undefined);assert.equal(row.ownerEmail,undefined);}
  assert.ok(rows.every(row=>row.external&&row.executable===false&&row.responseMode==='operations'&&row.provider==='Sourced requirement'));
  assert.doesNotMatch(JSON.stringify(rows),/sourceUrl|sourceName|sourceRecordId|packet\.ai|Verified buyer/);
});

test('source quantities, minimum rental terms and ambiguous source notes remain factual',async t=>{
  const {external}=await fixture(t),rows=await external.publicRows(),h200=rows.find(row=>row.title==='128 H200 nodes');
  assert.deepEqual(h200.quantity,{nodes:128,gpusPerNode:8,totalGpusMin:1024,sourceMinimum:true});
  assert.equal(h200.rentalMonths.min,12);assert.equal(h200.rentalMonths.preferred,12);assert.equal(h200.rentalMonths.max,undefined);assert.match(h200.rentalMonths.notes,/short-term/);
  for(const row of rows){assert.equal(row.start,undefined);assert.equal(row.quoteDeadline,undefined);assert.equal(row.hours,undefined);assert.equal(row.count,undefined);assert.equal(row.term,undefined);}
});

test('source identity deduplicates by source, adapter key and side without requiring buyer accounts',async t=>{
  const {external}=await fixture(t,{seed:false}),record=input();
  const a=await external.importRecords(importBatch([record])),b=await external.importRecords(importBatch([record]));assert.equal(a.results[0].id,b.results[0].id);assert.equal(b.results[0].outcome,'unchanged');
  await external.importRecords(importBatch([{...record,side:'supply'}]));await external.importRecords(importBatch([record],{sourceId:'other-source'}));
  const rows=(await external.admin()).records;assert.equal(rows.length,3);assert.equal(new Set(rows.map(row=>row.id)).size,3);assert.ok(rows.every(row=>row.reviewStatus==='Reviewing'));
});

test('future imports ignore payload approval flags and require protected operations review',async t=>{
  const {external}=await fixture(t,{seed:false});await external.importRecords({...importBatch([input({status:'Approved',reviewStatus:'Approved',executable:true})]),approvalReason:'Client attempts approval',approved:true});
  const row=(await external.admin()).records[0];assert.equal(row.status,'Reviewing');assert.equal(row.executable,false);assert.deepEqual(await external.publicRows(),[]);
  await assert.rejects(external.review(row.id,{status:'Approved',expectedRevision:0}),{status:409});
  const decision=await approve(external,row);assert.equal(decision.reviewRevision,2);assert.equal(decision.reviewedBy,'Operations tester');assert.equal((await external.publicRows()).length,1);
  await assert.rejects(external.review(row.id,{status:'Rejected',expectedRevision:1,reason:'Stale concurrent decision'}),{status:409});
});

test('changed content withdraws visibility and requires a fresh revision approval',async t=>{
  const {external}=await fixture(t,{seed:false});await external.importRecords(importBatch([input()]));let row=(await external.admin()).records[0];await approve(external,row);
  await external.importRecords(importBatch([input({targetPrice:2.2,modelBudgets:{H200:2.2}})],{batchId:'changed-002'}));row=(await external.admin()).records[0];
  assert.equal(row.reviewStatus,'Reviewing');assert.equal(row.reviewRevision,3);assert.equal(row.reviewedAt,null);assert.deepEqual(await external.publicRows(),[]);
  await approve(external,row);assert.equal((await external.publicRows())[0].price,2.2);
});

test('rejected or withdrawn records cannot be resurrected by identical imports or checked-batch restart',async t=>{
  const {external,dataDir}=await fixture(t),initial=(await external.admin()).records[0];
  await external.review(initial.id,{status:'Withdrawn',expectedRevision:initial.reviewRevision,reason:'No longer available'});
  await external.importRecords({...batch(),records:[listPacketDemands()[0]],batchId:'repeat'});
  assert.ok(!(await external.publicRows()).some(row=>row.id===initial.id));
  let restarted=createExternalMarketplace({dataDir,now:()=>epoch+1000,checkedBatch:batch()});assert.ok(!(await restarted.publicRows()).some(row=>row.id===initial.id));
  await restarted.importRecords(importBatch([input()]));const pending=(await restarted.admin()).records.find(row=>row.provenance.sourceId==='source-test');await restarted.review(pending.id,{status:'Rejected',expectedRevision:1,reason:'Insufficient source details'});await restarted.importRecords(importBatch([input()]));
  assert.equal((await restarted.admin()).records.find(row=>row.id===pending.id).status,'Rejected');
});

test('restarting never replays the checked snapshot over newer imported content or provenance',async t=>{
  const {external,dataDir}=await fixture(t);await external.publicRows();const changed={...listPacketDemands()[0],description:'Newer source requirements retained after restart.',observedAt:'2026-10-19T01:00:00Z'};
  await external.importRecords({...batch(),batchId:'newer-source-batch',records:[changed]});const before=(await external.admin()).records.find(row=>row.provenance.sourceRecordId===changed.externalId);
  const restarted=createExternalMarketplace({dataDir,now:()=>epoch+86400000,checkedBatch:batch()}),after=(await restarted.admin()).records.find(row=>row.id===before.id);
  assert.deepEqual(after,before);assert.equal(after.reviewStatus,'Reviewing');assert.equal(after.provenance.batchId,'newer-source-batch');
});

test('explicit source removal and expiration remove records from the market without deleting audit',async t=>{
  const {external,advance}=await fixture(t,{seed:false});const future=new Date(epoch+3600000).toISOString();await external.importRecords(importBatch([input({expiresAt:future})]));let row=(await external.admin()).records[0];await approve(external,row);assert.equal((await external.publicRows()).length,1);
  advance(3600001);assert.deepEqual(await external.publicRows(),[]);assert.equal((await external.admin()).records[0].status,'Expired');
  await external.importRecords(importBatch([input({externalId:'removed-record'})]));row=(await external.admin()).records.find(row=>row.externalId==='removed-record');await approve(external,row);
  await external.importRecords(importBatch([{externalId:'removed-record',side:'demand',removed:true}]));row=(await external.admin()).records.find(row=>row.externalId==='removed-record');assert.equal(row.status,'Withdrawn');assert.match(row.audit.at(-1).action,/removed/);assert.deepEqual(await external.publicRows(),[]);
});

test('worldwide, flexible, country sets, Europe and EU-only scopes filter correctly',async t=>{
  const {external}=await fixture(t);
  const h100Singapore=await external.publicRows({model:'H100',region:'Singapore'});assert.equal(h100Singapore.length,2);
  const eu=(await external.admin()).records.find(row=>row.region==='European Union');assert.ok((await external.publicRows({model:'H200',region:'Germany'})).some(row=>row.id===eu.id));assert.ok(!(await external.publicRows({model:'H200',region:'United Kingdom'})).some(row=>row.id===eu.id));
  const europe=(await external.admin()).records.find(row=>row.region==='Europe');assert.ok((await external.publicRows({model:'B200',region:'United Kingdom'})).some(row=>row.id===europe.id));
  assert.equal((await external.publicRows({model:'B300',region:'Singapore'})).length,0);assert.equal((await external.publicRows({model:'B300',region:'United States'})).length,1);
  assert.equal((await external.publicRows({model:'RTX 4090',region:'All regions'})).length,0);
});

test('country exclusions and unknown scope validation never widen a source requirement',async t=>{
  const {external}=await fixture(t,{seed:false});await external.importRecords(importBatch([input({regionScope:{type:'worldwide',excludedCountries:['US']}})]));await approve(external,(await external.admin()).records[0]);
  assert.equal((await external.publicRows({region:'US'})).length,0);assert.equal((await external.publicRows({region:'SG'})).length,1);
  await assert.rejects(external.importRecords(importBatch([input({externalId:'invalid',regionScope:{type:'countries',countries:[]}})])),{status:400});
  await assert.rejects(external.importRecords(importBatch([input({externalId:'invalid',regionScope:{type:'unknown'}})])),{status:400});
});

test('dual-model requirements project the selected GPU and its specific target price',async t=>{
  const {service,external}=await fixture(t),dual=(await external.admin()).records.find(row=>row.modelOptions.length===2);
  const b=(await service.best(seller,{model:'B200',region:'SG'})).rows.find(row=>row.id===dual.id),h=(await service.best(seller,{model:'H200',region:'SG'})).rows.find(row=>row.id===dual.id);
  assert.equal(b.model,'B200');assert.equal(b.price,3);assert.equal(h.model,'H200');assert.equal(h.price,1.7);assert.equal(b.id,h.id);assert.equal(h.bestMatch,false);
});

test('native market merges approved source RFQs but never owns them, settles them or features them',async t=>{
  const {service,dataDir}=await fixture(t),market=await service.publicMarket();assert.equal(market.rfqs.length,14);assert.deepEqual(market.featured,{rfqs:[],supplies:[]});
  for(const user of [buyer,seller]){const own=await service.mine(user);for(const field of ['rfqs','listings','responses','orders','notifications','instances'])assert.deepEqual(own[field],[]);}
  assert.deepEqual(await service.recent(90),[]);assert.deepEqual((await service.admin()).kyb,[]);
  const native=JSON.parse(await fs.readFile(path.join(dataDir,'marketplace.json'),'utf8'));assert.deepEqual(native.rfqs,[]);assert.deepEqual(native.supplies,[]);assert.deepEqual(native.orders,[]);assert.deepEqual(native.notifications,[]);
  const demo=createMarketplaceService({dataDir:path.join(dataDir,'isolated-demo'),provenanceKind:'demo'});assert.deepEqual((await demo.publicMarket()).rfqs,[]);
});

test('external supply uses the same review gate and never claims verified stock or installer success',async t=>{
  const {external,service}=await fixture(t,{seed:false});await external.importRecords(importBatch([input({side:'supply'})]));const row=(await external.admin()).records[0];await approve(external,row);
  const supply=(await service.publicMarket()).supplies[0];assert.equal(supply.provider,'Sourced offer');assert.equal(supply.executable,false);assert.equal(supply.agentStatus,undefined);assert.equal(supply.kyb,undefined);
  assert.equal((await service.best(buyer,{model:'H200',region:'Singapore'})).rows[0].id,row.id);assert.deepEqual((await service.publicMarket()).featured.supplies,[]);
  await assert.rejects(service.quoteInterest(buyer,row.id),{status:404});await assert.rejects(service.requestAgent(seller,row.id),{status:409});
});

test('native submissions carry server-owned first-party or Demo provenance and ignore spoofed external metadata',async t=>{
  const {dataDir,service}=await fixture(t,{seed:false}),rfq={kind:'gpu_rental',model:'H100',region:'Singapore',title:'Native need',project:'Training',notes:'Dedicated hardware',count:8,hours:24,term:'Spot',budget:2,start:new Date(epoch+72*3600000).toISOString(),quoteDeadline:new Date(epoch+24*3600000).toISOString(),provenance:{kind:'external',sourceId:'forged',sourceName:'Forged source'},external:true};
  const saved=await service.saveRfq(buyer,rfq);assert.equal(saved.provenance.kind,'first_party');assert.equal(saved.provenance.sourceId,'opennext');assert.equal(saved.provenance.sourceRecordId,saved.id);assert.equal(saved.external,undefined);assert.equal(saved.reviewStatus,'Reviewing');
  const demo=createMarketplaceService({dataDir:path.join(dataDir,'demo'),now:()=>epoch,provenanceKind:'demo'});assert.equal((await demo.saveRfq(buyer,rfq)).provenance.kind,'demo');
});

test('imports are bounded and validated without fetching arbitrary source URLs',async t=>{
  const {external}=await fixture(t,{seed:false});
  for(const sourceUrl of ['http://example.test/','https://user:secret@example.test/','https://127.0.0.1/','file:///secret','javascript:alert(1)'])await assert.rejects(external.importRecords(importBatch([input({sourceUrl})])),{status:400});
  await assert.rejects(external.importRecords(importBatch(Array.from({length:101},(_,i)=>input({externalId:'limit-'+i})))),{status:400});
  await assert.rejects(external.importRecords(importBatch([input(),input()])),{status:400});
  await assert.rejects(external.importRecords(importBatch([input({targetPrice:-1})])),{status:400});
  assert.deepEqual((await external.admin()).records,[]);
});

test('external import and review routes require admin origin and never work on Terminal host or native quote routes',async t=>{
  const {service,external}=await fixture(t,{seed:false});
  const route=createMarketplaceRouter(service,{auth:{authenticate:async req=>req.user,checkCsrf:()=>true},security:{authenticated:req=>req.headers.admin==='yes',sameOrigin:req=>req.headers.origin==='http://localhost',bearerAuthenticated:()=>false}}),p='/api/admin/marketplace/external/import',body=importBatch([input()]);
  assert.equal((await request(route,p,{method:'POST',body})).status,401);assert.equal((await request(route,p,{method:'POST',body,headers:{admin:'yes'}})).status,403);
  const headers={admin:'yes',origin:'http://localhost'};assert.equal((await request(route,p,{method:'POST',body,headers,onTerminal:true})).status,404);assert.equal((await request(route,p,{method:'POST',body,headers})).status,200);
  const row=(await external.admin()).records[0],review='/api/admin/marketplace/external/'+row.id;
  assert.equal((await request(route,review,{method:'PATCH',body:{status:'Approved',expectedRevision:1},headers})).status,200);
  assert.equal((await request(route,review,{method:'PATCH',body:{status:'Rejected',expectedRevision:1,reason:'Stale'},headers})).status,409);
  assert.equal((await request(route,'/api/marketplace/rfqs/'+row.id+'/quotes',{method:'POST',body:{}})).status,404);
  assert.equal((await request(route,p,{method:'POST',body:{...body,padding:'x'.repeat(262144)},headers})).status,413);
});
