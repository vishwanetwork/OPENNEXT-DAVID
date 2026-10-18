'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {transactionAmounts,FEE_POLICY_VERSION,FEE_LABEL}=require('../OpenNEXT-transaction-fees.cjs');
const {createMarketplaceService}=require('../OpenNEXT-marketplace-service.cjs');
const {createDemoData}=require('../OpenNEXT-demo-fixtures.cjs');

const epoch=Date.parse('2026-10-18T12:00:00Z');
const buyer={id:'fee-buyer',email:'buyer@example.test',name:'Buyer',role:'buyer',onboardingCompleted:true};
const seller={id:'fee-seller',email:'seller@example.test',name:'Seller',role:'seller',onboardingCompleted:true};
const supply={kind:'gpu_rental',model:'H100',region:'Singapore',title:'H100 allocation',count:8,hours:120,term:'Spot',netPrice:2,serviceStart:'2026-10-19T00:00:00Z',serviceEnd:'2026-10-25T00:00:00Z',notes:'Dedicated capacity.',sshHost:'gpu.example.test',sshUser:'deploy'};
const rfq={kind:'gpu_rental',model:'H100',region:'Singapore',title:'Training capacity',project:'Training rollout',count:8,hours:24,term:'Spot',budget:2.5,start:'2026-10-20T12:00:00Z',quoteDeadline:'2026-10-19T12:00:00Z',notes:'Dedicated capacity.',visibility:'Public requirements'};
const forgedFees={subtotal:1,buyerFee:0,sellerFee:0,buyerTotal:1,sellerNet:999999,total:1,feePercent:0,feePolicyVersion:'client-free',feeLabel:'No fees',buyerPrice:.01};
async function fixture(t){const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'on-fees-v10-'));t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));return {dataDir,service:createMarketplaceService({dataDir,now:()=>epoch})};}
async function approve(service){const review=await service.submitKyb(seller,{company:'Capacity Test Ltd',registration:'FEE-001',country:'Singapore',eligibility:true,rightsConfirmed:true,evidence:'Business registry verification',rights:'Owned hardware rights'});await service.decideKyb(review.id,{status:'Approved'});}
async function publish(service,input=supply){const row=await service.createSupply(seller,input);await service.agentResult(row.id,{status:'Succeeded',agentId:'verified-fee-agent',verifiedAt:new Date(epoch).toISOString()});return row;}
async function requirement(service,input=rfq){const row=await service.saveRfq(buyer,input);await service.decideRfq(row.id,{status:'Approved',expectedRevision:row.reviewRevision});return row;}
const amounts=row=>Object.fromEntries(['subtotal','buyerFee','sellerFee','buyerTotal','sellerNet','total'].map(key=>[key,row[key]]));

test('both 5% fees independently use the base subtotal, not a fee-inclusive price',()=>{
  const row=transactionAmounts({kind:'physical_gpu',rate:100,count:1});
  assert.deepEqual(amounts(row),{subtotal:100,buyerFee:5,sellerFee:5,buyerTotal:105,sellerNet:95,total:105});
  assert.equal(row.feePercent,5);assert.equal(row.feePolicyVersion,FEE_POLICY_VERSION);assert.equal(row.feeLabel,'OpenNEXT Fee 5%');
});

test('subtotal and each independent fee are rounded to USD cents, including half-cent boundaries',()=>{
  assert.deepEqual(amounts(transactionAmounts({kind:'hardware',rate:.10,count:1})),{subtotal:.1,buyerFee:.01,sellerFee:.01,buyerTotal:.11,sellerNet:.09,total:.11});
  assert.deepEqual(amounts(transactionAmounts({kind:'hardware',rate:1.005,count:1})),{subtotal:1.01,buyerFee:.05,sellerFee:.05,buyerTotal:1.06,sellerNet:.96,total:1.06});
  assert.equal(transactionAmounts({kind:'rental',rate:.000001,count:100,hours:100}).subtotal,.01);
  assert.equal(transactionAmounts({kind:'hardware',rate:1.234567,count:7}).subtotal,8.64);
});

test('rental, physical GPU and total model-capacity quotes use their own quantity semantics',()=>{
  assert.equal(transactionAmounts({kind:'rental',rate:2,count:8,hours:24}).subtotal,384);
  assert.equal(transactionAmounts({kind:'hardware',rate:2000,count:8,hours:24}).subtotal,16000);
  assert.equal(transactionAmounts({kind:'model',rate:123.45,count:0,hours:0}).subtotal,123.45);
});

test('invalid or unsafe currency values fail closed and top-ups are not capacity transactions',()=>{
  for(const input of [{rate:NaN},{rate:Infinity},{rate:-1},{rate:2,count:.5,hours:2},{rate:2,count:1,hours:1.5},{rate:2,count:0},{rate:1e9,count:65536,hours:26280},{kind:'topup',rate:100}]){
    assert.throws(()=>transactionAmounts(input),{status:400});
  }
});

for(const kind of ['gpu_rental','physical_gpu','model_capacity'])test(kind+' quote and accepted order expose server-owned explicit fee amounts',async t=>{
  const {service}=await fixture(t);await approve(service);
  const model=kind==='model_capacity'?'Model API bundle':'H100';
  const listing=await publish(service,{...supply,...forgedFees,kind,model,netPrice:2});
  assert.equal(listing.buyerPrice,2);assert.equal(listing.markupPercent,0);assert.equal(listing.feePercent,5);
  const demand=await requirement(service,{...rfq,kind,model,days:2,inputMillion:1,outputMillion:1});
  const quote=await service.submitQuote(seller,demand.id,{...forgedFees,supplyId:listing.id,rate:2,delivery:30,notes:'Verified quote.',validUntil:'2026-10-19T00:00:00Z'});
  const expected=transactionAmounts({kind,rate:2,count:demand.count,hours:demand.hours});
  assert.deepEqual(amounts(quote),amounts(expected));assert.equal(quote.unitPrice,2);assert.equal(quote.buyerPrice,2);assert.equal(quote.feeLabel,FEE_LABEL);
  const publicRow=(await service.publicMarket()).supplies[0];assert.equal(publicRow.price,2);assert.equal(publicRow.priceBasis,'base_rate');
  const mineQuote=(await service.mine(buyer)).rfqs[0].quotes[0];assert.equal(mineQuote.price,2);assert.equal(mineQuote.netPrice,undefined);
  const {order}=await service.decideQuote(buyer,demand.id,quote.id,'accept');
  assert.deepEqual(amounts(order),amounts(expected));assert.equal(order.unitPrice,2);assert.equal(order.feePolicyVersion,FEE_POLICY_VERSION);
  assert.equal(order.status,'Awaiting payment');assert.equal(order.paymentStatus,'Unpaid');
  assert.deepEqual(amounts((await service.mine(seller)).orders[0]),amounts(expected));
  assert.deepEqual(amounts((await service.mine(buyer)).orders[0]),amounts(expected));
});

test('micro-price quotes cannot create zero-cent orders',async t=>{
  const {service}=await fixture(t);await approve(service);const listing=await publish(service),demand=await requirement(service);
  await assert.rejects(service.submitQuote(seller,demand.id,{supplyId:listing.id,rate:.000001,notes:'Too small.',validUntil:'2026-10-19T00:00:00Z'}),{status:400});
  assert.deepEqual((await service.mine(buyer)).orders,[]);
});

test('legacy open listings migrate but pending quotes require a re-quote and all accepted agreements remain unchanged',async t=>{
  const {dataDir}=await fixture(t),file=path.join(dataDir,'marketplace.json');
  const oldSupply={...supply,id:'SUP-OPEN',ownerId:seller.id,ownerEmail:seller.email,agentStatus:'Succeeded',status:'Published',buyerPrice:2.1,markupPercent:5,createdAt:new Date(epoch).toISOString()};
  const oldRfq={...rfq,id:'RFQ-OPEN',ownerId:buyer.id,status:'Quoted',reviewStatus:'Approved',reviewRevision:2};
  const pendingQuote={id:'QUOTE-OPEN',rfqId:oldRfq.id,ownerId:seller.id,supplyId:oldSupply.id,status:'Pending',netPrice:2,buyerPrice:2.1,total:403.2,validUntil:'2026-10-19T00:00:00Z'};
  const acceptedQuote={...pendingQuote,id:'QUOTE-ACCEPTED',rfqId:'RFQ-ACCEPTED',status:'Accepted'};
  const historicOrders=['Unpaid','Paid'].map((paymentStatus,index)=>({id:'ORDER-OLD-'+index,quoteId:acceptedQuote.id,buyerId:buyer.id,sellerId:seller.id,unitPrice:2.1,total:403.2,sellerNet:384,paymentStatus,status:index?'Completed':'Awaiting payment',settledAt:index?new Date(epoch-3600000).toISOString():undefined}));
  const db={version:2,rfqs:[oldRfq],supplies:[oldSupply],kyb:[{ownerId:seller.id,status:'Approved',company:'Verified Test Ltd'}],interests:[],instances:[],quotes:[pendingQuote,acceptedQuote],orders:historicOrders,notifications:[],audit:[],homepageReviews:[],submissionRequests:[]};
  const historicSnapshot=JSON.parse(JSON.stringify(historicOrders)),quoteSnapshot=JSON.parse(JSON.stringify(acceptedQuote));
  await fs.writeFile(file,JSON.stringify(db));
  const service=createMarketplaceService({dataDir,now:()=>epoch});
  const admin=await service.admin();assert.equal(admin.supplies[0].buyerPrice,2);assert.equal(admin.supplies[0].markupPercent,0);
  const buyerState=await service.mine(buyer),stale=buyerState.rfqs[0].quotes[0];
  assert.equal(stale.status,'Needs refresh');assert.equal(stale.total,403.2);assert.match(stale.refreshReason,/separate 5% fee/);
  assert.equal(buyerState.rfqs[0].reviewStatus,'Approved');assert.equal(buyerState.rfqs[0].reviewRevision,2);
  await assert.rejects(service.decideQuote(buyer,oldRfq.id,pendingQuote.id,'accept'),{status:409});
  let saved=JSON.parse(await fs.readFile(file,'utf8'));assert.deepEqual(saved.orders,historicSnapshot);assert.deepEqual(saved.quotes.find(row=>row.id===acceptedQuote.id),quoteSnapshot);
  assert.equal(saved.notifications.length,2);assert.equal(new Set(saved.notifications.map(row=>row.ownerId)).size,2);
  const restarted=createMarketplaceService({dataDir,now:()=>epoch});await restarted.admin();
  saved=JSON.parse(await fs.readFile(file,'utf8'));assert.equal(saved.notifications.length,2,'migration does not notify again after restart');
  const refreshed=await restarted.submitQuote(seller,oldRfq.id,{supplyId:oldSupply.id,rate:2,notes:'Requoted with explicit fees.',validUntil:'2026-10-19T00:00:00Z'});
  assert.equal(refreshed.feePolicyVersion,FEE_POLICY_VERSION);assert.equal(refreshed.sellerNet,364.8);
  saved=JSON.parse(await fs.readFile(file,'utf8'));assert.deepEqual(saved.orders,historicSnapshot);assert.deepEqual(saved.quotes.find(row=>row.id===acceptedQuote.id),quoteSnapshot);
});

test('fresh demo records show base prices and fee settlement fields only for fixture counterparties',()=>{
  const data=createDemoData(epoch);assert.equal(data.orders.length,78);
  for(const supply of data.supplies){assert.equal(supply.buyerPrice,supply.netPrice);assert.equal(supply.markupPercent,0);assert.equal(supply.feePolicyVersion,FEE_POLICY_VERSION);}
  for(const order of data.orders){
    assert.deepEqual(amounts(order),amounts(transactionAmounts({kind:order.kind,rate:order.unitPrice,count:order.count,hours:order.hours})));
    assert.match(order.buyerId,/^fixture-/);assert.match(order.sellerId,/^fixture-/);
    assert.equal(order.paymentStatus,'Paid');assert.equal(order.feeLabel,FEE_LABEL);
  }
  assert.equal(data.ledger,undefined,'fixture amounts do not create duplicate fee ledger entries');
});

test('verified resale publishes the seller base rate without an embedded fee',async t=>{
  const {dataDir}=await fixture(t),data={version:2,rfqs:[],supplies:[],kyb:[],interests:[],quotes:[],orders:[],notifications:[],audit:[],instances:[{id:'INSTANCE-1',ownerId:buyer.id,sellerId:seller.id,model:'H100',region:'Singapore',term:'On-demand',count:8,paymentStatus:'Paid',status:'Running',resaleAllowed:true,serviceEnd:'2026-10-22T00:00:00Z',telemetry:{utilizationPercent:50,idleGpuCount:4,observedAt:new Date(epoch).toISOString()}}]};
  await fs.writeFile(path.join(dataDir,'marketplace.json'),JSON.stringify(data));
  const service=createMarketplaceService({dataDir,now:()=>epoch}),row=await service.resell(buyer,'INSTANCE-1',{...forgedFees,count:2,hours:12,rate:2.123456});
  assert.equal(row.netPrice,2.123456);assert.equal(row.buyerPrice,row.netPrice);assert.equal(row.markupPercent,0);assert.equal(row.feePercent,5);
  assert.equal((await service.publicMarket()).supplies[0].price,2.123456);
});
