'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createMarketplaceService}=require('../OpenNEXT-marketplace-service.cjs');
const details=require('../OpenNEXT-rfq-details.js');
const now=Date.parse('2026-10-25T08:00:00Z');
const buyer={id:'details-buyer',email:'buyer@example.test',name:'Buyer',role:'buyer',onboardingCompleted:true};
const request={kind:'gpu_rental',requestKind:'rfq',model:'H200',region:'Singapore',vcpu:128,count:8,memory:141,hours:72,term:'On-demand',budget:2.15,start:'2026-11-01T08:00:00Z',quoteDeadline:'2026-10-30T08:00:00Z',network:'',storage:'',image:'',sla:'',notes:'',deliveryMethod:'Bare metal',urgency:'Standard',visibility:'Public requirements',shareClosingPrice:true};
const reference={id:'resource-123',model:'H200',country:'Singapore',term:'Reserved',gpuCount:8,vcpu:128,memory:141,perGpuHourly:2.15,instanceHourly:17.2};
async function fixture(t,options={}){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'on-request-details-'));
  t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  return {dataDir,service:createMarketplaceService({dataDir,now:()=>now,...options})};
}
test('RFQ accepts no name, project or optional text; records verified identity, hardware and computed maximum',async t=>{
  const {service,dataDir}=await fixture(t);
  const row=await service.saveRfq(buyer,{...request,ownerEmail:'forged@example.test',maximumQuotePrice:0});
  assert.equal(row.title,'H200 · On-demand RFQ');assert.equal(row.project,'');assert.equal(row.notes,'');
  assert.equal(row.ownerEmail,buyer.email);assert.equal(row.vcpu,128);assert.equal(row.memory,141);
  assert.equal(row.maximumQuotePrice,1238.4);assert.equal(row.status,'Reviewing');
  const restarted=createMarketplaceService({dataDir,now:()=>now});
  assert.deepEqual((await restarted.admin()).rfqs[0],row);
  assert.equal((await restarted.mine(buyer)).rfqs[0].maximumQuotePrice,1238.4);
  assert.deepEqual((await restarted.publicMarket()).rfqs,[]);
});
test('On-demand and Reserved quotes share RFQ storage with their request type and bounded reference',async t=>{
  const {service}=await fixture(t);
  for(const term of ['On-demand','Reserved']){
    const row=await service.saveRfq(buyer,{...request,requestKind:'quote_request',term,selectedOffer:{...reference,term,serverRecord:true,ownerEmail:'not-authoritative@example.test'}});
    assert.equal(row.requestKind,'quote_request');assert.equal(row.term,term);assert.equal(row.title,`H200 · ${term} quote request`);
    assert.deepEqual(row.selectedOffer,{...reference,term});assert.equal(row.originSupply,null);assert.equal(row.status,'Reviewing');
  }
  assert.equal((await service.admin()).rfqs.length,2);
  assert.deepEqual((await service.publicMarket()).rfqs,[]);
});
test('explicit rental requests require valid hardware and unsupported request types are rejected',async t=>{
  const {service}=await fixture(t);
  for(const values of [{vcpu:''},{memory:''},{vcpu:1.5},{memory:0},{vcpu:65537},{memory:65537},{requestKind:'order'},{requestKind:'quote_request',term:'Spot'},{selectedOffer:reference},{requestKind:'quote_request',selectedOffer:'not an object'},{requestKind:'quote_request',selectedOffer:{...reference,instanceHourly:-1}}])await assert.rejects(service.saveRfq(buyer,{...request,...values}),{status:400});
  assert.equal((await service.admin()).rfqs.length,0);
});
test('legacy requests remain readable without newly required hardware while existing hardware survives reload',async t=>{
  const {service}=await fixture(t);const {requestKind,vcpu,memory,...legacy}=request;
  const row=await service.saveRfq(buyer,{...legacy,title:'Existing request',project:'Legacy project'});
  assert.equal(row.requestKind,'rfq');assert.equal(row.title,'Existing request');assert.equal(row.vcpu,null);assert.equal(row.memory,null);
});
test('idempotency includes new request fields and stable selected-reference property order',async t=>{
  const {service}=await fixture(t);
  const input={...request,requestKind:'quote_request',term:'Reserved',selectedOffer:reference,clientSubmissionId:'quote-details-retry-001'};
  const row=await service.saveRfq(buyer,input);
  const retried=await service.saveRfq(buyer,{...input,selectedOffer:Object.fromEntries(Object.entries(reference).reverse())});
  assert.equal(retried.id,row.id);
  for(const changed of [{vcpu:64},{memory:80},{requestKind:'rfq'},{selectedOffer:{...reference,id:'resource-456'}}])await assert.rejects(service.saveRfq(buyer,{...input,...changed}),{status:409});
  assert.equal((await service.admin()).rfqs.length,1);
});
test('new schemas cannot bypass identity, demo separation or operations approval',async t=>{
  const {service}=await fixture(t,{provenanceKind:'demo'});
  await assert.rejects(service.saveRfq({...buyer,onboardingCompleted:false},request),{status:403});
  await assert.rejects(service.saveRfq({...buyer,role:'seller'},request),{status:403});
  const row=await service.saveRfq(buyer,request);assert.equal(row.provenance.kind,'demo');
  await assert.rejects(service.saveRfq({...buyer,id:'other-buyer'},request,row.id),{status:404});
  assert.equal((await service.mine({...buyer,id:'other-buyer'})).rfqs.length,0);
});
test('maximum quote amount rounds once at the subtotal with integer arithmetic',async t=>{
  const {service}=await fixture(t);
  for(const [budget,count,hours,expected]of [[1.005,1,1,1.01],[0.29,7,3,6.09],[2.15,8,72,1238.4]]){
    const row=await service.saveRfq(buyer,{...request,budget,count,hours});
    assert.equal(row.maximumQuotePrice,expected);assert.equal(details.maximum(row),expected);
  }
});
test('shared read-only details retain the form order, labels and optional empty values with no actions',()=>{
  const html=details.render(request);
  const fields=[...html.matchAll(/data-rfq-field="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(fields,['model','region','vcpu','count','memory','hours','term','budget','start','quoteDeadline','network','storage','image','sla','deliveryMethod','urgency','visibility','notes','shareClosingPrice']);
  for(const label of ['Required start (UTC)','Quotes due (UTC)','SLA / support needs (optional)','Maximum Quote Price:','$1,238.40','Not provided'])assert.ok(html.includes(label),label);
  assert.doesNotMatch(html,/<(?:a|button|form|input|textarea|select)\b|Requirement name|Project/);
});
test('quote details show the same selected resource and escape all untrusted content',()=>{
  const html=details.render({...request,requestKind:'quote_request',model:'<script>model</script>',notes:'<img onerror="alert(1)">',selectedOffer:{...reference,id:'<svg onload="alert(1)">'}});
  assert.match(html,/Selected resource/);assert.match(html,/Submitted quote request details/);assert.match(html,/&lt;script&gt;model&lt;\/script&gt;/);assert.match(html,/&lt;img onerror=/);assert.match(html,/&lt;svg onload=/);
  assert.doesNotMatch(html,/<script>|<img |<svg |<a |<button /);
});
test('shared detail assets are loaded by each Terminal and Console entry and statically served',async()=>{
  for(const file of ['index.html','OpenNEXT-preview-entry.html','OpenNEXT-terminal-preview.html','OpenNEXT-admin-console.html','admin/index.html']){
    const source=await fs.readFile(path.join(__dirname,'..',file),'utf8');
    assert.match(source,/OpenNEXT-rfq-details\.js/);assert.match(source,/OpenNEXT-rfq-details\.css/);
  }
  const server=await fs.readFile(path.join(__dirname,'..','OpenNEXT-preview-server.cjs'),'utf8');
  assert.match(server,/'OpenNEXT-rfq-details\.js', 'OpenNEXT-rfq-details\.css'/);
});
