'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createMarketplaceService,createMarketplaceRouter}=require('../OpenNEXT-marketplace-service.cjs');
const epoch=Date.parse('2026-10-18T12:00:00.000Z');
const buyer={id:'buyer-1',email:'buyer@example.test',name:'Buyer',role:'buyer',onboardingCompleted:true};
const seller={id:'seller-1',email:'seller@example.test',name:'Seller',role:'seller',onboardingCompleted:true};
const supplierReview={company:'Verified Capacity Ltd',registration:'TEST-0001',country:'United States',eligibility:true,rightsConfirmed:true,evidence:'Business registry reference',rights:'Owned capacity with resale authorization'};
const rfq={kind:'gpu_rental',model:'H100',region:'United States',title:'Training capacity',project:'Training launch',count:8,hours:24,term:'Spot',budget:2.5,start:'2026-10-20T12:00:00Z',quoteDeadline:'2026-10-19T12:00:00Z',notes:'Dedicated GPUs with secure SSH access.',visibility:'Public requirements',shareClosingPrice:true};
const supply={kind:'gpu_rental',model:'H100',region:'United States',title:'H100 allocation',count:8,hours:120,term:'Spot',netPrice:2,serviceStart:'2026-10-19T00:00:00Z',serviceEnd:'2026-10-25T00:00:00Z',notes:'Dedicated hardware allocation.',sshHost:'gpu.example.test',sshUser:'deploy',sshPort:22};
async function fixture(t){const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'on-market-v2-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));let now=epoch;return {dataDir,service:createMarketplaceService({dataDir,now:()=>now}),setNow:value=>now=value};}
async function approve(service,user=seller){const review=await service.submitKyb(user,supplierReview);return service.decideKyb(review.id,{status:'Approved',reason:'Business registration and rights verified.'});}
async function publish(service,user=seller,input=supply){await approve(service,user);const row=await service.createSupply(user,input);await service.agentResult(row.id,{status:'Succeeded',agentId:'installed-agent',verifiedAt:new Date(epoch).toISOString()});return row;}
async function request(route,{pathname='/api/marketplace/me',method='GET',user=buyer,body={},headers={},onTerminal=false}={}){const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,user,headers:{host:'localhost','content-type':'application/json',...headers},socket:{remoteAddress:'127.0.0.1'}});let status,result;const res={writeHead(code){status=code;},end(value){result=JSON.parse(value);}};const handled=await route(req,res,new URL(pathname,'http://localhost'),{onTerminal});return {handled,status,result};}
function router(service){return createMarketplaceRouter(service,{auth:{authenticate:async req=>req.user,checkCsrf:req=>req.headers['x-csrf-token']==='valid'},security:{authenticated:req=>req.headers.authorization==='Bearer admin',sameOrigin:req=>req.headers.origin==='http://localhost',bearerAuthenticated:req=>req.headers.authorization==='Bearer admin'},env:{OPENNEXT_AGENT_CALLBACK_TOKEN:'x'.repeat(40)}});}

test('live marketplace has no example records or fabricated matches',async t=>{const {service}=await fixture(t);assert.deepEqual((await service.publicMarket()).supplies,[]);assert.deepEqual((await service.publicMarket()).rfqs,[]);const result=await service.best(buyer);assert.equal(result.rows.length,0);assert.equal(result.requiresSubmission,true);assert.equal(result.reason,'No matches.');assert.match(result.submissionPrompt,/Submit an RFQ/);assert.deepEqual(await service.instances(buyer),[]);assert.deepEqual(await service.recent(),[]);});
test('KYB is durable, operator-approved and not self-approved',async t=>{const {service,dataDir}=await fixture(t);await assert.rejects(service.createSupply(seller,supply),{status:409});const review=await service.submitKyb(seller,{...supplierReview,status:'Approved'});assert.equal(review.status,'Reviewing');assert.equal((await service.mine(seller)).review.status,'Reviewing');await assert.rejects(service.createSupply(seller,supply),{status:409});const recreated=createMarketplaceService({dataDir,now:()=>epoch});assert.equal((await recreated.mine(seller)).review.status,'Reviewing');await recreated.decideKyb(review.id,{status:'Approved'});assert.equal((await recreated.mine(seller)).review.status,'Approved');await assert.rejects(recreated.decideKyb(review.id,{status:'Approved'}),{status:409});});
test('agent integration is a real publication gate, markup is applied once and secrets stay private',async t=>{const {service}=await fixture(t);await approve(service);const record=await service.createSupply(seller,{...supply,buyerPrice:1,status:'Published',agentStatus:'Succeeded'});assert.equal(record.status,'Awaiting agent');assert.equal(record.buyerPrice,2.1);assert.equal((await service.publicMarket()).supplies.length,0);const pending=await service.requestAgent(seller,record.id);assert.equal(pending.configured,false);assert.equal(pending.status,'Pending');await service.agentResult(record.id,{status:'Succeeded',agentId:'agent-real',verifiedAt:new Date(epoch).toISOString()});const row=(await service.publicMarket()).supplies[0];assert.equal(row.price,2.1);assert.equal(row.sshHost,undefined);assert.equal(row.ownerEmail,undefined);assert.equal(row.netPrice,undefined);assert.equal((await service.mine(seller)).listings[0].netPrice,2);await assert.rejects(service.requestAgent({...seller,id:'other'},record.id),{status:409});});
test('public homepage selects highest RFQ and lowest marked-up supply only after operations review',async t=>{const {service}=await fixture(t);await publish(service);await service.saveRfq(buyer,rfq);await service.saveRfq(buyer,{...rfq,budget:3.2,title:'Urgent run'});await service.saveRfq(buyer,{...rfq,budget:4,visibility:'Private RFQ'});const before=await service.publicMarket();assert.deepEqual(before.featured,{rfqs:[],supplies:[]});const candidates=(await service.admin()).featured.filter(row=>row.current);assert.equal(candidates.length,2);for(const row of candidates)await service.decideFeatured(row.id,{status:'Approved',fingerprint:row.fingerprint},'Operations');const result=await service.publicMarket();assert.equal(result.featured.rfqs.length,1);assert.equal(result.featured.rfqs[0].price,3.2);assert.equal(result.featured.supplies[0].price,2.1);assert.equal(result.featured.supplies[0].netPrice,undefined);assert.equal(result.rfqs.length,2);});
test('same-model recommendations appear before submission and only true fits receive best-match labels',async t=>{const {service}=await fixture(t);await publish(service);const suggested=await service.best(buyer,{model:'H100'});assert.equal(suggested.requiresSubmission,true);assert.equal(suggested.rows.length,1);assert.equal(suggested.rows[0].bestMatch,false);assert.match(suggested.submissionPrompt,/Submit an RFQ/);await service.saveRfq(buyer,{...rfq,budget:2});const belowBudget=await service.best(buyer,{model:'H100'});assert.equal(belowBudget.rows.length,1);assert.equal(belowBudget.rows[0].bestMatch,false);await service.saveRfq(buyer,rfq);assert.equal((await service.best(buyer,{model:'H100'})).rows[0].bestMatch,true);assert.equal((await service.best(buyer,{model:'H100',region:'US East'})).rows.length,1);const none=await service.best(buyer,{model:'H200'});assert.equal(none.rows.length,0);assert.equal(none.reason,'No matches.');assert.equal((await service.best(seller,{model:'H100'})).rows.filter(r=>r.bestMatch).length,1);});
test('bidding parties count unique verified buyers and cannot be set by request payload',async t=>{const {service}=await fixture(t),row=await publish(service);assert.equal((await service.quoteInterest(buyer,row.id)).biddingParties,1);assert.equal((await service.quoteInterest(buyer,row.id)).biddingParties,1);assert.equal((await service.quoteInterest({...buyer,id:'buyer-2'},row.id)).biddingParties,2);await assert.rejects(service.quoteInterest(seller,row.id),{status:403});assert.equal((await service.publicMarket()).supplies[0].biddingParties,2);});
test('quotes are server-owned, correctly priced and accept creates an unpaid order',async t=>{const {service}=await fixture(t),row=await publish(service),requirement=await service.saveRfq(buyer,rfq);const quote=await service.submitQuote(seller,requirement.id,{supplyId:row.id,rate:2,delivery:30,notes:'Verified capacity.',validUntil:'2026-10-19T00:00:00Z'});assert.equal(quote.buyerPrice,2.1);assert.equal(quote.total,403.2);await assert.rejects(service.decideQuote({...buyer,id:'other'},requirement.id,quote.id,'accept'),{status:404});const result=await service.decideQuote(buyer,requirement.id,quote.id,'accept');assert.equal(result.order.paymentStatus,'Unpaid');assert.equal(result.order.total,403.2);await assert.rejects(service.decideQuote(buyer,requirement.id,quote.id,'accept'),{status:409});});
test('router requires auth, CSRF, admin scope and trusted agent callbacks',async t=>{const {service}=await fixture(t),route=router(service);assert.equal((await request(route,{user:null})).status,401);assert.equal((await request(route,{pathname:'/api/marketplace/rfqs',method:'POST',body:rfq})).status,403);assert.equal((await request(route,{pathname:'/api/marketplace/rfqs',method:'POST',body:rfq,headers:{'x-csrf-token':'valid'}})).status,201);assert.equal((await request(route,{pathname:'/api/admin/marketplace'})).status,401);assert.equal((await request(route,{pathname:'/api/admin/marketplace',headers:{authorization:'Bearer admin'},onTerminal:true})).status,404);assert.equal((await request(route,{pathname:'/api/admin/marketplace',headers:{authorization:'Bearer admin'}})).status,200);assert.equal((await request(route,{pathname:'/api/internal/marketplace/telemetry',method:'POST'})).status,401);assert.equal((await request(route,{pathname:'/api/marketplace/settlements?days=7',user:null})).status,402);});
test('RFQ countries and supplier ownership cannot be spoofed',async t=>{const {service}=await fixture(t);await assert.rejects(service.saveRfq(seller,rfq),{status:403});await assert.rejects(service.saveRfq(buyer,{...rfq,region:'All regions'}),{status:400});const row=await service.saveRfq(buyer,{...rfq,ownerId:'attacker',status:'Completed'});assert.equal(row.ownerId,buyer.id);assert.equal(row.status,'Open');await assert.rejects(service.saveRfq({...buyer,id:'another'},rfq,row.id),{status:404});});
test('resale requires trusted telemetry and reserves whole idle GPUs without over-allocation',async t=>{const {dataDir,setNow}=await fixture(t);const db={version:2,rfqs:[],supplies:[],kyb:[],interests:[],instances:[{id:'INSTANCE-1',ownerId:buyer.id,sellerId:seller.id,model:'H100',count:8,region:'United States',term:'Spot',paymentStatus:'Paid',status:'Running',resaleAllowed:true,serviceEnd:'2026-10-22T00:00:00Z',telemetry:{utilizationPercent:50,idleGpuCount:4,observedAt:new Date(epoch).toISOString()}}],quotes:[],orders:[],notifications:[],audit:[]};await fs.writeFile(path.join(dataDir,'marketplace.json'),JSON.stringify(db));let clock=epoch;const service=createMarketplaceService({dataDir,now:()=>clock});await service.resell(buyer,'INSTANCE-1',{count:3,hours:12,rate:2});await assert.rejects(service.resell(buyer,'INSTANCE-1',{count:2,hours:12,rate:2}),{status:400});assert.equal((await service.mine(buyer)).instances[0].availableResellCount,1);assert.equal((await service.instances(buyer))[0].availableResellCount,1);await service.telemetry({instanceId:'INSTANCE-1',observedAt:new Date(epoch).toISOString(),utilizationPercent:95,idleGpuCount:0});assert.equal((await service.publicMarket()).supplies.length,0);await assert.rejects(service.resell(buyer,'INSTANCE-1',{count:1,hours:12,rate:2}),{status:409});clock=epoch+300000;await assert.rejects(service.resell(buyer,'INSTANCE-1',{count:1,hours:12,rate:2}),{status:409});});
test('homepage material edits invalidate approval, including edits reverted before a public read',async t=>{
  const {service}=await fixture(t),record=await service.saveRfq(buyer,rfq);
  const original=(await service.admin()).featured.find(row=>row.current);
  await service.decideFeatured(original.id,{status:'Approved',fingerprint:original.fingerprint});
  await service.saveRfq(buyer,{...rfq,budget:4},record.id);
  await service.saveRfq(buyer,rfq,record.id);
  assert.deepEqual((await service.publicMarket()).featured.rfqs,[]);
  const current=(await service.admin()).featured.find(row=>row.current);
  assert.notEqual(current.id,original.id);assert.equal(current.fingerprint,original.fingerprint);assert.equal(current.status,'Pending');
  await assert.rejects(service.decideFeatured(original.id,{status:'Approved',fingerprint:original.fingerprint}),{status:409});
  await assert.rejects(service.decideFeatured(current.id,{status:'Approved',fingerprint:'stale'}),{status:409});
  await service.decideFeatured(current.id,{status:'Approved',fingerprint:current.fingerprint});
  await service.saveRfq(buyer,{...rfq,notes:'Changed networking and delivery terms.'},record.id);
  assert.deepEqual((await service.publicMarket()).featured.rfqs,[]);
});
test('a better priced candidate replaces the approved winner without inheriting approval',async t=>{
  const {service}=await fixture(t);await publish(service);const first=(await service.admin()).featured.find(row=>row.current);
  await service.decideFeatured(first.id,{status:'Approved',fingerprint:first.fingerprint});
  const cheaper=await service.createSupply(seller,{...supply,netPrice:1.5});
  await service.agentResult(cheaper.id,{status:'Succeeded',agentId:'second-agent',verifiedAt:new Date(epoch).toISOString()});
  assert.deepEqual((await service.publicMarket()).featured.supplies,[]);
  const pending=(await service.admin()).featured.find(row=>row.current);
  assert.equal(pending.sourceId,cheaper.id);assert.equal(pending.status,'Pending');assert.equal(pending.snapshot.netPrice,1.5);
  await service.decideFeatured(pending.id,{status:'Approved',fingerprint:pending.fingerprint});
  assert.equal((await service.publicMarket()).featured.supplies[0].price,1.575);
});
test('homepage decisions persist, allow withdrawal, and do not affect normal market visibility',async t=>{
  const {service,dataDir}=await fixture(t);await publish(service);const candidate=(await service.admin()).featured.find(row=>row.current);
  await assert.rejects(service.decideFeatured(candidate.id,{status:'Rejected',fingerprint:candidate.fingerprint}),{status:400});
  await service.decideFeatured(candidate.id,{status:'Approved',fingerprint:candidate.fingerprint},'Operations reviewer');
  const recreated=createMarketplaceService({dataDir,now:()=>epoch});assert.equal((await recreated.publicMarket()).featured.supplies.length,1);
  await recreated.decideFeatured(candidate.id,{status:'Rejected',fingerprint:candidate.fingerprint,reason:'Terms need further verification.'},'Operations reviewer');
  const market=await recreated.publicMarket();assert.equal(market.featured.supplies.length,0);assert.equal(market.supplies.length,1);
  const record=(await recreated.admin()).featured.find(row=>row.current);assert.equal(record.status,'Rejected');assert.equal(record.reviewedBy,'Operations reviewer');
});
test('homepage candidates omit non-rental and expired records and follow mainstream model ordering',async t=>{
  const {service,setNow}=await fixture(t);
  for(const model of ['L40S','H100','B200','H200'])await service.saveRfq(buyer,{...rfq,model});
  const privateRow=await service.saveRfq(buyer,{...rfq,model:'A100',visibility:'Private RFQ'});
  let queue=(await service.admin()).featured.filter(row=>row.current);
  assert.deepEqual(queue.map(row=>row.model),['B200','H200','H100','L40S']);
  assert.ok(!queue.some(row=>row.sourceId===privateRow.id));
  for(const row of queue)await service.decideFeatured(row.id,{status:'Approved',fingerprint:row.fingerprint});
  assert.deepEqual((await service.publicMarket()).featured.rfqs.map(row=>row.model),['B200','H200','H100','L40S']);
  setNow(epoch+2*86400000);assert.equal((await service.publicMarket()).featured.rfqs.length,0);
  queue=(await service.admin()).featured;assert.ok(queue.every(row=>!row.current));
});
test('homepage approval API enforces admin authentication, origin, terminal isolation and review fingerprint',async t=>{
  const {service}=await fixture(t);await service.saveRfq(buyer,rfq);const row=(await service.admin()).featured.find(row=>row.current);
  const pathname='/api/admin/marketplace/featured/'+row.id,body={status:'Approved',fingerprint:row.fingerprint},route=router(service);
  assert.equal((await request(route,{pathname,method:'PATCH',body})).status,401);
  assert.equal((await request(route,{pathname,method:'PATCH',body,headers:{authorization:'Bearer admin'},onTerminal:true})).status,404);
  const cookieRoute=createMarketplaceRouter(service,{security:{authenticated:()=>true,sameOrigin:()=>false,bearerAuthenticated:()=>false}});
  assert.equal((await request(cookieRoute,{pathname,method:'PATCH',body})).status,403);
  assert.equal((await request(route,{pathname,method:'PATCH',body:{status:'Approved'},headers:{authorization:'Bearer admin'}})).status,409);
  assert.equal((await request(route,{pathname,method:'PATCH',body,headers:{authorization:'Bearer admin'}})).status,200);
  assert.equal((await service.publicMarket()).featured.rfqs.length,1);
});
