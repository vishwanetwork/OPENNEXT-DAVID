'use strict';
// Test fixtures used only by the isolated public demo service. Never seed production stores.
const crypto = require('node:crypto');
const {feePolicy, transactionAmounts} = require('./OpenNEXT-transaction-fees.cjs');

const MODELS = [
  ['H100', 2.18], ['H100 SXM', 2.30], ['H100 PCIe', 1.98], ['H200', 2.86],
  ['B200', 3.32], ['B300', 4.20], ['GB200 NVL72', 4.65], ['A100 80GB', 1.25],
  ['L40S', 0.72], ['RTX PRO 6000 Blackwell', 1.11], ['RTX 4090', 0.39],
  ['AMD MI300X', 1.62], ['RTX 5090', 0.64],
];
const LOCATIONS = [
  ['United States', 'Northstar Compute'], ['Singapore', 'Atlas Grid'],
  ['Germany', 'Arbor Cloud'], ['Japan', 'Frontier Grid'],
  ['Canada', 'Helix Infrastructure'], ['United Kingdom', 'Cloud Harbor'],
  ['United States', 'Aster Capacity'], ['Singapore', 'Stratus AI'],
  ['Germany', 'Meridian Compute'],
];
const DISPLAY_REGIONS = [...new Set(LOCATIONS.map(([region]) => region))];
// Rotate demo data-center regions by model, independently of counterparty registration.
// B300 remains pending homepage review; the other 12 models evenly cover six regions.
const SHOWCASE_MODELS = MODELS.map(([model]) => model).filter(model => model !== 'B300');
const price = value => Math.round(value * 100) / 100;
const id = (prefix, name) => prefix + '-' + crypto.createHash('sha256').update(name).digest('hex').slice(0,16).toUpperCase();

function createDemoData(now = Date.now()) {
  const at = hours => new Date(now + hours * 3600000).toISOString();
  const data = {version:2,rfqs:[],supplies:[],kyb:[],interests:[],instances:[],quotes:[],orders:[],notifications:[],audit:[]};
  LOCATIONS.forEach(([country, company], index) => data.kyb.push({
    id:id('KYB',company),ownerId:'fixture-supplier-'+index,email:'operations'+index+'@capacity.invalid',
    name:company+' Operations',company,country,registration:'LOCAL-'+String(index+1).padStart(4,'0'),
    rights:'Demo ownership evidence.',evidence:'Demo operations record.',
    status:'Approved',createdAt:at(-72),submittedAt:at(-72),reviewedAt:at(-48),reviewedBy:'Preview operations',
  }));
  MODELS.forEach(([model, base], modelIndex) => {
    const regionOffset = Math.max(0, SHOWCASE_MODELS.indexOf(model));
    LOCATIONS.forEach(([, company], index) => {
      const region = DISPLAY_REGIONS[(index + regionOffset) % DISPLAY_REGIONS.length];
      const key=model+'-'+index,term=index<6?'Spot':index<8?'On-demand':'Reserved';
      const count=[64,32,128,16,48,24,64,32,128][index],hours=[168,336,720,72,168,336,720,168,2160][index];
      const netPrice=price(base*([0.93,1.02,0.98,1.08,1.04,1.01,1.24,1.20,0.91][index]));
      const supplyId=id('SUP',key);
      data.supplies.push({
        id:supplyId,ownerId:'fixture-supplier-'+index,ownerEmail:'operations'+index+'@capacity.invalid',
        kind:'gpu_rental',model,region,term,count,hours,netPrice,buyerPrice:netPrice,
        markupPercent:0,priceBasis:'base_rate',...feePolicy,title:model+' dedicated capacity',
        notes:`${count} GPUs with dedicated networking. ${term==='Spot'?'Interruptible capacity; checkpointing recommended.':'Reserved access window and service terms confirmed in the quote.'} SSH access, storage and network topology confirmed before delivery.`,
        serviceStart:at(-24),serviceEnd:at(24*180),start:at(-24),agentStatus:'Succeeded',
        agentId:'demo-fixture-agent-'+modelIndex+'-'+index,verifiedAt:at(-2),status:'Published',
        createdAt:at(-36-index),updatedAt:at(-1),serverRecord:true,
      });
      const requiredCount=[8,16,32,8,16,8,32,8,64][index],rfqHours=[72,168,336,48,168,72,336,168,720][index];
      data.rfqs.push({
        id:id('RFQ',key),ownerId:'fixture-buyer-'+index,ownerEmail:'procurement'+index+'@buyer.invalid',
        kind:'gpu_rental',model,region,term,count:requiredCount,hours:rfqHours,
        title:model+' '+['training capacity','inference expansion','fine-tuning cluster','evaluation workload','batch inference','research compute','enterprise deployment','production inference','reserved training'][index],
        project:['Foundation model training','Regional inference','Model fine-tuning','Benchmark evaluation','Batch processing','Research programme','Enterprise AI','Production serving','Long-run training'][index],
        notes:`${requiredCount} ${model} GPUs in ${region}. Dedicated SSH access required; confirm network bandwidth, storage and deployment readiness. ${index===0?'Urgent delivery requested.':'Quotes should include SLA and interruption terms.'}`,
        budget:price(base*([1.34,1.18,1.23,1.27,1.16,1.21,1.42,1.38,1.15][index])),
        start:at(72+index),quoteDeadline:at(48+index),urgency:index===0?'High urgency':'Standard',
        visibility:'Public requirements',originSupply:null,shareClosingPrice:true,status:'Open',reviewStatus:'Approved',reviewRevision:1,reviewSubmittedAt:at(-13-index),reviewedAt:at(-12-index),reviewedBy:'Demo operations',reviewReason:'Approved for isolated demo testing only.',
        createdAt:at(-12-index),updatedAt:at(-1),serverRecord:true,
        network:'Dedicated interconnect; topology to be confirmed',storage:'1 TB fast workspace storage per node',
        image:'Ubuntu LTS with CUDA-compatible runtime',sla:'Service-level terms to be confirmed in quotation',
        deliveryMethod:'SSH / dedicated instance',audit:[{at:at(-12-index),event:'Requirement submitted'}],
      });
      // These completed records belong to fixture counterparties, never to the preview account.
      if(index<6){
        const unitPrice=price(base*[0.98,1.01,0.96,1.06,1.03,1.00][index]);
        const orderCount=[8,16,32,8,16,8][index];
        data.orders.push({
          id:id('ORDER',key),buyerId:'fixture-buyer-'+index,sellerId:'fixture-supplier-'+index,
          supplyId,kind:'gpu_rental',model,region,term:'Spot',count:orderCount,hours:72,
          unitPrice,priceBasis:'base_rate',...transactionAmounts({kind:'gpu_rental',rate:unitPrice,count:orderCount,hours:72}),currency:'USD',status:'Completed',paymentStatus:'Paid',
          provider:company,settledAt:at(-[0.3,2,8,20,38,60][index]),createdAt:at(-24*6),
          serviceStart:at(-24*5),serviceEnd:at(-24*2),serverRecord:true,
        });
      }
    });
  });
  return data;
}

module.exports = {MODELS, createDemoData};

