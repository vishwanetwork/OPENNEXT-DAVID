'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const countries = require('./OpenNEXT-countries.js');
const {feePolicy, FEE_POLICY_VERSION, transactionAmounts} = require('./OpenNEXT-transaction-fees.cjs');
const fail = (status, message) => Object.assign(new Error(message), {status});
const clone = value => JSON.parse(JSON.stringify(value));
const round = value => Math.round(Number(value) * 1e6) / 1e6;
const modelOrder = ['B300', 'GB300', 'B200', 'GB200', 'H200', 'H100', 'A100', 'L40S', 'RTX PRO 6000', 'MI350', 'MI325', 'MI300', 'RTX 5090', 'RTX 4090'];
const kind = value => ({rental:'gpu_rental', model:'model_capacity', hardware:'physical_gpu'}[value] || value || 'gpu_rental');
const userRole = user => String(user?.role||'').toLowerCase();
const text = (value, length = 200, required = false) => {const result=String(value ?? '').trim();if(result.length>length || (required&&!result) || /[\u0000-\u001f\u007f]/.test(result.replace(/[\n\r\t]/g,'')))throw fail(400,'Complete the required fields within the allowed length.');return result;};
const number = (value, min, max, integer = false) => {const result=Number(value);if(!Number.isFinite(result)||result<min||result>max||(integer&&!Number.isInteger(result)))throw fail(400,'A numeric value is outside the allowed range.');return result;};
const date = (value, min=0) => {const time=Date.parse(value);if(!Number.isFinite(time)||time<min)throw fail(400,'Choose a valid future service window.');return new Date(time).toISOString();};
function regionCountry(value){
  const label=String(value||'').trim(),known=countries.list.find(c=>c.name===label||c.code===label);if(known)return known.name;
  const regions={'eu-west-1':'Ireland','eu-west-2':'United Kingdom','eu-west-3':'France','eu-central-1':'Germany','eu-central-2':'Switzerland','eu-north-1':'Sweden','eu-south-1':'Italy','eu-south-2':'Spain','ap-south-1':'India','ap-south-2':'India','ap-southeast-1':'Singapore','ap-southeast-2':'Australia','ap-southeast-3':'Indonesia','ap-southeast-4':'Australia','ap-southeast-5':'Malaysia','ap-southeast-6':'New Zealand','ap-southeast-7':'Thailand','ap-east-1':'Hong Kong SAR China','ap-east-2':'Taiwan','ap-northeast-1':'Japan','ap-northeast-2':'South Korea','ap-northeast-3':'Japan','af-south-1':'South Africa','me-south-1':'Bahrain','me-central-1':'United Arab Emirates','il-central-1':'Israel','mx-central-1':'Mexico','sa-east-1':'Brazil'};
  if(regions[label])return regions[label];if(/^us-|^US (East|West)/i.test(label))return 'United States';if(/^ca-/i.test(label))return 'Canada';if(/^cn-/i.test(label))return 'China';
  const cities={Frankfurt:'Germany',Tokyo:'Japan',Seoul:'South Korea',Mumbai:'India',Sydney:'Australia',London:'United Kingdom',Paris:'France',Stockholm:'Sweden',Zurich:'Switzerland',Jakarta:'Indonesia',Oregon:'United States','N. Virginia':'United States',Ohio:'United States',California:'United States'};return cities[label]||label;
}
function createMarketplaceService({dataDir, now=()=>Date.now(), agentAdapter=null}={}) {
  if(!dataDir)throw Error('A private marketplace data directory is required.');
  const file=path.join(dataDir,'marketplace.json');
  const fresh=()=>({version:2,rfqs:[],supplies:[],kyb:[],interests:[],instances:[],quotes:[],orders:[],notifications:[],audit:[],homepageReviews:[],submissionRequests:[]});
  let pending=Promise.resolve(), loaded;
  const timestamp=()=>new Date(now()).toISOString();
  const uid=prefix=>prefix+'-'+crypto.randomBytes(8).toString('hex').toUpperCase();
  async function read(){if(!loaded)loaded=(async()=>{try{const value=JSON.parse(await fs.readFile(file,'utf8'));if(value.version!==2)throw Error('Unsupported marketplace schema');if(value.homepageReviews===undefined)value.homepageReviews=[];if(value.submissionRequests===undefined)value.submissionRequests=[];for(const key of Object.keys(fresh()).filter(k=>k!=='version'))if(!Array.isArray(value[key]))throw Error('Invalid marketplace schema');migrateOpenPricing(value);for(const r of value.rfqs){r.reviewRevision=Number.isInteger(r.reviewRevision)&&r.reviewRevision>0?r.reviewRevision:1;if(!r.reviewStatus&&['Open','Quoted','Reviewing'].includes(r.status)){r.status='Reviewing';r.reviewStatus='Reviewing';r.reviewSubmittedAt=timestamp();r.reviewReason='Operations review is required before publication.';for(const q of value.quotes.filter(q=>q.rfqId===r.id&&q.status==='Pending'))q.status='Needs refresh';}}return value;}catch(error){if(error.code==='ENOENT')return fresh();throw error;}})();return loaded;}
  async function change(fn){const operation=pending.then(async()=>{const draft=clone(await read()),result=await fn(draft);syncFeatured(draft);await fs.mkdir(dataDir,{recursive:true});const temp=file+'.'+crypto.randomBytes(5).toString('hex')+'.tmp';try{await fs.writeFile(temp,JSON.stringify(draft),{mode:0o600,flag:'wx'});await fs.rename(temp,file);}catch(error){await fs.unlink(temp).catch(()=>{});throw error;}loaded=Promise.resolve(draft);return clone(result);});pending=operation.catch(()=>{});return operation;}
  const authorized=user=>{if(!user?.id||!user.onboardingCompleted||!['buyer','seller'].includes(userRole(user)))throw fail(403,'Complete verified account onboarding first.');};
  const role=(user,required)=>{authorized(user);if(userRole(user)!==required.toLowerCase())throw fail(403,required+' account required.');};
  const owner=(rows,id,user)=>{const row=rows.find(r=>r.id===id);if(!row||row.ownerId!==user.id)throw fail(404,'Record not found.');return row;};
  const kybFor=(db,id)=>db.kyb.find(r=>r.ownerId===id);
  const approved=(db,user)=>{if(kybFor(db,user.id)?.status!=='Approved')throw fail(409,'Supplier review must be approved before listing or responding.');};
  const log=(db,event,actor,id)=>db.audit.unshift({at:timestamp(),event,actor,id});
  const notify=(db,ownerId,subject,message,links={})=>db.notifications.unshift({id:uid('NTF'),ownerId,subject,message,created:timestamp(),read:false,...links});
  const listedRate=row=>round(Number(row.netPrice??row.rate??row.buyerPrice));
  function migrateOpenPricing(db){
    // Existing accepted orders, including unpaid agreements, and their quotes
    // are immutable financial history. Only unaccepted quotes require re-quote.
    for(const supply of db.supplies){
      if(supply.feePolicyVersion===FEE_POLICY_VERSION||['Closed','Rejected','Reserved'].includes(supply.status))continue;
      if(Number.isFinite(Number(supply.netPrice))&&Number(supply.netPrice)>0)Object.assign(supply,{buyerPrice:listedRate(supply),markupPercent:0,priceBasis:'base_rate',...feePolicy});
    }
    for(const quote of db.quotes){
      if(quote.status!=='Pending'||quote.feePolicyVersion===FEE_POLICY_VERSION||db.orders.some(order=>order.quoteId===quote.id))continue;
      quote.status='Needs refresh';quote.refreshReason='OpenNEXT now charges a separate 5% fee to each party. The supplier must submit a refreshed quote before acceptance.';quote.feePolicyChangeRequired=true;
      const rfq=db.rfqs.find(row=>row.id===quote.rfqId);
      if(quote.ownerId)notify(db,quote.ownerId,'Quote refresh required',quote.refreshReason,{rfqId:quote.rfqId,quoteId:quote.id});
      if(rfq?.ownerId)notify(db,rfq.ownerId,'Updated supplier quote required',quote.refreshReason,{rfqId:rfq.id,quoteId:quote.id});
      log(db,'Unaccepted quote requires explicit fee-policy refresh','Fee policy update',quote.id);
    }
  }
  const submissionFields={rfqs:['kind','type','model','name','region','count','hours','term','title','project','notes','budget','start','quoteDeadline','originSupply','urgency','visibility','shareClosingPrice','network','storage','image','sla','deliveryMethod','shippingAddress','condition','incoterms','warranty','sku','accessPolicy','inputMillion','outputMillion','days','tps'],supplies:['kind','type','model','name','region','count','hours','term','title','notes','netPrice','rate','serviceStart','start','serviceEnd','sshHost','sshUser','sshPort']};
  function submissionRequest(db,user,input,collection){
    if(input.clientSubmissionId==null)return null;
    const requestId=text(input.clientSubmissionId,128,true);
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(requestId))throw fail(400,'Use a valid client submission identifier between 8 and 128 characters.');
    const payload={};for(const field of submissionFields[collection])if(Object.hasOwn(input,field))payload[field]=input[field];
    const hash=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const prior=db.submissionRequests.find(r=>r.ownerId===user.id&&r.collection===collection&&r.requestId===requestId);
    if(prior){
      if(prior.hash!==hash)throw fail(409,'This submission identifier was already used with different details. Use a new identifier for a new submission.');
      const record=db[collection].find(r=>r.id===prior.recordId&&r.ownerId===user.id);
      if(!record)throw fail(409,'The original submission is no longer available. Contact operations with the submission identifier.');
      return {record};
    }
    return {ownerId:user.id,collection,requestId,hash};
  }
  function receiveSubmission(previous){const at=timestamp();return {receiptId:previous?.submission?.receiptId||uid('RCPT'),source:'terminal',status:'Received',receivedAt:previous?.submission?.receivedAt||at,updatedAt:at,revision:previous?.submission?.revision?previous.submission.revision+1:1};}
  function rememberSubmission(db,request,record){if(request&&!request.record)db.submissionRequests.push({...request,recordId:record.id,createdAt:timestamp()});}
  function standard(input){const k=kind(input.kind||input.type);if(!['gpu_rental','model_capacity','physical_gpu'].includes(k))throw fail(400,'Unsupported capacity type.');let region=text(input.region,100,true);if(!countries.valid(region))throw fail(400,'Select a country or territory from the list.');region=countries.list.find(c=>c.name===region||c.code===region).name;const model=text(input.model||input.name,100,true),count=k==='model_capacity'?0:number(input.count,1,65536,true),hours=k==='gpu_rental'?number(input.hours,1,26280,true):0,term=k==='gpu_rental'?text(input.term,40,true):k==='physical_gpu'?'Physical GPU':'Authorized API access';if(k==='gpu_rental'&&!['Spot','On-demand','Reserved'].includes(term))throw fail(400,'Choose Spot, On-demand or Reserved.');return {kind:k,model,region,count,hours,term};}
  function liveRfq(r){return r.reviewStatus==='Approved'&&['Open','Quoted'].includes(r.status)&&Date.parse(r.quoteDeadline)>now()&&Date.parse(r.start)>now();}
  function liveSupply(s){return s.status==='Published'&&Date.parse(s.serviceEnd)>now()&&s.agentStatus==='Succeeded';}
  function bids(db,model){return new Set(db.interests.filter(i=>i.model===model&&now()-Date.parse(i.createdAt)<30*86400000).map(i=>i.buyerId)).size;}
  function publicRow(db,r,side){return {id:r.id,originSupply:side==='supply'?r.id:undefined,originRfq:side==='demand'?r.id:undefined,kind:({gpu_rental:'rental',model_capacity:'model',physical_gpu:'hardware'})[r.kind],side,model:r.model,title:r.title||r.name||r.model,region:r.region,count:r.count,hours:r.hours,term:r.term,price:side==='supply'?listedRate(r):r.budget,buyerPrice:side==='supply'?listedRate(r):undefined,priceLabel:side==='supply'?'Listed price before fees':'Maximum buyer price',...(side==='supply'?{priceBasis:'base_rate',...feePolicy}:{}),description:r.notes||'',provider:side==='supply'?(kybFor(db,r.ownerId)?.company||'Verified supplier'):'Verified buyer',urgency:r.urgency||'Standard',status:r.status,created:r.createdAt,start:r.start||r.serviceStart,serviceEnd:r.serviceEnd,quoteDeadline:r.quoteDeadline,biddingParties:bids(db,r.model),serverRecord:true,sample:false};}
  function suspendUnsafeResales(db){for(const s of db.supplies.filter(s=>s.resaleOf&&s.status==='Published')){const i=db.instances.find(i=>i.id===s.resaleOf),t=i?.telemetry;if(!i||!t||now()-Date.parse(t.observedAt)>120000||Date.parse(t.observedAt)>now()+5000||Number(t.utilizationPercent)>=95||Date.parse(i.serviceEnd)<=now()){s.status='Paused';s.pauseReason='Fresh utilization below 95% and active service are required.';}}}
  const rankModel=model=>{const upper=String(model).toUpperCase(),rank=modelOrder.findIndex(name=>upper.includes(name));return rank<0?999:rank;};
  const compareModel=(a,b)=>rankModel(a.model)-rankModel(b.model)||a.model.localeCompare(b.model);
  function featuredWinners(db){
    const select=(rows,side)=>{
      const map=new Map();
      for(const row of rows.filter(row=>row.kind==='gpu_rental')){
        const price=side==='supply'?row.netPrice:row.budget,old=map.get(row.model);
        const oldPrice=old&&(side==='supply'?old.netPrice:old.budget);
        if(!old||(side==='supply'?price<oldPrice:price>oldPrice)||(price===oldPrice&&row.id.localeCompare(old.id)<0))map.set(row.model,row);
      }
      return [...map.values()].sort(compareModel).map(row=>({row,side}));
    };
    return [...select(db.rfqs.filter(row=>liveRfq(row)&&row.visibility!=='Private RFQ'),'demand'),...select(db.supplies.filter(liveSupply),'supply')];
  }
  function featuredMaterial(db,row,side){
    const fields=['id','ownerId','kind','model','title','name','region','count','hours','term','notes','budget','netPrice','buyerPrice','markupPercent','start','serviceStart','serviceEnd','quoteDeadline','urgency','visibility','network','storage','image','sla','deliveryMethod','condition','incoterms','warranty','resaleOf'];
    const material={side,provider:side==='supply'?(kybFor(db,row.ownerId)?.company||'Verified supplier'):'Verified buyer'};
    for(const field of fields)material[field]=row[field]??null;
    return material;
  }
  function syncFeatured(db){
    suspendUnsafeResales(db);
    const selected=featuredWinners(db).map(({row,side})=>{
      const material=featuredMaterial(db,row,side),fingerprint=crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex');
      return {row,side,fingerprint};
    });
    for(const review of db.homepageReviews.filter(review=>review.current)){
      if(!selected.some(item=>item.row.id===review.sourceId&&item.side===review.side&&item.fingerprint===review.fingerprint)){
        review.current=false;review.retiredAt=timestamp();
        log(db,'Homepage candidate superseded','Marketplace selection',review.id);
      }
    }
    for(const {row,side,fingerprint} of selected){
      if(db.homepageReviews.some(review=>review.current&&review.sourceId===row.id&&review.side===side&&review.fingerprint===fingerprint))continue;
      const snapshot={...publicRow(db,row,side),ownerEmail:row.ownerEmail,netPrice:side==='supply'?row.netPrice:undefined,project:row.project,network:row.network,storage:row.storage,sla:row.sla};
      const review={id:uid('HPR'),sourceId:row.id,side,model:row.model,fingerprint,snapshot,status:'Pending',current:true,submittedAt:timestamp()};
      db.homepageReviews.unshift(review);log(db,'Homepage candidate awaiting review','Marketplace selection',review.id);
    }
    return selected;
  }
  async function publicMarket(){return change(db=>{
    const winners=syncFeatured(db),rfqs=db.rfqs.filter(row=>liveRfq(row)&&row.visibility!=='Private RFQ').map(row=>publicRow(db,row,'demand')),supplies=db.supplies.filter(liveSupply).map(row=>publicRow(db,row,'supply'));
    const approvedRows=side=>winners.filter(item=>item.side===side&&db.homepageReviews.some(review=>review.current&&review.status==='Approved'&&review.sourceId===item.row.id&&review.fingerprint===item.fingerprint)).map(item=>publicRow(db,item.row,side));
    return {rfqs,supplies,featured:{rfqs:approvedRows('demand'),supplies:approvedRows('supply')},updatedAt:timestamp()};
  });}
  async function decideFeatured(id,input,operator='Administrator'){return change(db=>{
    syncFeatured(db);
    const review=db.homepageReviews.find(review=>review.id===id);
    if(!review)throw fail(404,'Homepage candidate not found.');
    if(!review.current||input.fingerprint!==review.fingerprint)throw fail(409,'This candidate has changed or is no longer the selected market price. Refresh before reviewing.');
    if(!['Approved','Rejected'].includes(input.status))throw fail(400,'Choose Approve or Reject.');
    if(review.status===input.status)throw fail(409,'This review already has that decision.');
    review.reason=text(input.reason,2000,input.status==='Rejected');review.status=input.status;review.reviewedAt=timestamp();review.reviewedBy=text(operator,160,true);
    log(db,'Homepage candidate '+review.status,review.reviewedBy,review.id);
    return review;
  });}
  function qualifies(s,r){return s.model===r.model&&s.region===r.region&&s.term===r.term&&s.count>=r.count&&s.hours>=r.hours&&listedRate(s)<=r.budget&&Date.parse(s.serviceStart)<=Date.parse(r.start)&&Date.parse(s.serviceEnd)>=Date.parse(r.start)+r.hours*3600000;}
  function instanceView(db,user){
    return db.instances.filter(i=>i.ownerId===user.id||i.sellerId===user.id).map(i=>{
      const t=i.telemetry,fresh=t&&now()-Date.parse(t.observedAt)<=120000&&Date.parse(t.observedAt)<=now()+5000&&Number(t.utilizationPercent)<95;
      const reserved=db.supplies.filter(s=>s.resaleOf===i.id&&['Published','Awaiting agent','Reserved'].includes(s.status)).reduce((n,s)=>n+Number(s.count),0);
      return {...i,availableResellCount:i.ownerId===user.id&&fresh&&i.resaleAllowed===true&&i.paymentStatus==='Paid'&&i.status==='Running'&&Date.parse(i.serviceEnd)>now()?Math.max(0,(Number(t.idleGpuCount)||0)-reserved):0};
    });
  }
  function buyerQuote(q,db){const {netPrice,rate,ownerId,...record}=q;return {...record,price:q.buyerPrice,provider:kybFor(db,ownerId)?.company||'Verified supplier'};}
  function customerOrder(o,user){const {sellerNet,...record}=o;return {...record,...(o.sellerId===user.id||o.feePolicyVersion===FEE_POLICY_VERSION?{sellerNet}:{}),side:o.sellerId===user.id?'sell':'buy'};}
  async function mine(user){authorized(user);await pending;const db=await read(),review=kybFor(db,user.id);const rfqs=db.rfqs.filter(r=>r.ownerId===user.id).map(r=>({...r,quotes:db.quotes.filter(q=>q.rfqId===r.id).map(q=>buyerQuote(q,db))}));const listings=db.supplies.filter(r=>r.ownerId===user.id).map(r=>({...r,rate:r.netPrice,name:r.model,type:r.kind==='gpu_rental'?'GPU rental':r.kind==='model_capacity'?'Model capacity':'Physical GPU',serverRecord:true}));return clone({rfqs,listings,review:review?{...review,step:review.status==='Approved'?3:review.status==='Reviewing'?1:0}:{status:'Not started',step:0},responses:db.quotes.filter(q=>q.ownerId===user.id),orders:db.orders.filter(o=>o.buyerId===user.id||o.sellerId===user.id).map(o=>customerOrder(o,user)),notifications:db.notifications.filter(n=>n.ownerId===user.id),instances:instanceView(db,user)});}
  async function best(user,filters={}){
    authorized(user);await pending;const db=await read(),isBuyer=userRole(user)==='buyer';
    const owned=isBuyer?db.rfqs.filter(r=>r.ownerId===user.id&&liveRfq(r)):db.supplies.filter(r=>r.ownerId===user.id&&liveSupply(r));
    const selectedModel=String(filters.model||owned[0]?.model||'').trim();
    const candidates=isBuyer?db.supplies.filter(liveSupply):db.rfqs.filter(r=>liveRfq(r)&&r.visibility!=='Private RFQ');
    const rows=candidates.filter(r=>r.ownerId!==user.id&&selectedModel&&r.model===selectedModel&&(!filters.region||filters.region==='All regions'||regionCountry(r.region)===regionCountry(filters.region))).map(r=>({...publicRow(db,r,isBuyer?'supply':'demand'),bestMatch:owned.some(o=>isBuyer?qualifies(r,o):qualifies(o,r))})).sort((a,b)=>Number(b.bestMatch)-Number(a.bestMatch)||(isBuyer?a.price-b.price:b.price-a.price));
    return {rows,reason:rows.length?'':'No matches.',requiresSubmission:!owned.length,submissionPrompt:owned.length?'':isBuyer?'Submit an RFQ for more precise recommendations.':'Submit supply for more precise recommendations.'};
  }
  async function submitKyb(user,input){role(user,'Seller');return change(db=>{const old=kybFor(db,user.id);if(old?.status==='Reviewing')throw fail(409,'Your supplier review is already in progress.');if(old?.status==='Approved')throw fail(409,'Your supplier review is already approved.');const company=text(input.company,160,true),registration=text(input.registration,160,true),country=text(input.country,100,true),rights=text(input.rights,3000,true),evidence=text(input.evidence,3000,true);if(!countries.valid(country))throw fail(400,'Select a valid registration country.');if(input.eligibility!==true||input.rightsConfirmed!==true)throw fail(400,'Confirm eligibility and capacity resale rights.');const record={id:old?.id||uid('KYB'),ownerId:user.id,email:user.email,name:user.name,company,registration,country,rights,evidence,status:'Reviewing',createdAt:old?.createdAt||timestamp(),submittedAt:timestamp(),updatedAt:timestamp()};if(old)Object.assign(old,record);else db.kyb.unshift(record);log(db,'Supplier review submitted',user.id,record.id);notify(db,user.id,'Supplier review submitted','Your business and capacity rights are being reviewed. We will notify you when the review is complete.');return record;});}
  async function decideKyb(id,input,operator='Administrator'){return change(db=>{const r=db.kyb.find(r=>r.id===id);if(!r)throw fail(404,'Supplier review not found.');if(r.status!=='Reviewing')throw fail(409,'This review already has a decision.');if(!['Approved','Rejected'].includes(input.status))throw fail(400,'Choose Approve or Reject.');r.reason=text(input.reason,2000,input.status==='Rejected');r.status=input.status;r.reviewedAt=timestamp();r.updatedAt=timestamp();r.reviewedBy=operator;log(db,'Supplier review '+r.status,operator,r.id);notify(db,r.ownerId,'Supplier review '+r.status.toLowerCase(),r.status==='Approved'?'Your supplier review is approved. You can submit capacity for agent installation.':r.reason);return r;});}
  async function saveRfq(user,input,id){role(user,'Buyer');return change(db=>{
    const request=id?null:submissionRequest(db,user,input,'rfqs');if(request?.record)return request.record;
    const previous=id?owner(db.rfqs,id,user):null;
    if(previous&&(previous.orderId||!['Open','Quoted','Reviewing','Rejected'].includes(previous.status)))throw fail(409,'This RFQ cannot be edited.');
    if(db.rfqs.filter(r=>r.ownerId===user.id&&['Open','Quoted','Reviewing'].includes(r.status)).length>=100&&!previous)throw fail(429,'Close an existing RFQ before creating another.');
    const spec=standard(input),start=date(input.start,now()+1000),deadline=date(input.quoteDeadline,now()+1000);
    if(Date.parse(deadline)>Date.parse(start))throw fail(400,'Quotes must be due before the service starts.');
    const originSupply=input.originSupply?db.supplies.find(s=>s.id===input.originSupply&&liveSupply(s)):null;
    if(input.originSupply&&!originSupply)throw fail(409,'The selected supply is no longer available.');
    const r={...previous,...spec,id:previous?.id||uid('RFQ'),ownerId:user.id,ownerEmail:user.email,ownerName:user.name||'',title:text(input.title,140,true),project:text(input.project,120,true),notes:text(input.notes,4000,true),budget:number(input.budget,0.000001,1e9),start,quoteDeadline:deadline,urgency:input.urgency==='High urgency'?'High urgency':'Standard',visibility:originSupply?'Private RFQ':input.visibility==='Private RFQ'?'Private RFQ':'Public requirements',originSupply:originSupply?.id||null,shareClosingPrice:input.shareClosingPrice===true,status:'Reviewing',reviewStatus:'Reviewing',reviewRevision:(previous?.reviewRevision||0)+1,reviewSubmittedAt:timestamp(),reviewedAt:null,reviewedBy:null,reviewReason:'',createdAt:previous?.createdAt||timestamp(),updatedAt:timestamp(),submission:receiveSubmission(previous),serverRecord:true,audit:[...(previous?.audit||[]),{at:timestamp(),event:previous?'Requirement updated; operations review required':'Requirement submitted for operations review'}]};
    for(const name of ['network','storage','image','sla','deliveryMethod','shippingAddress','condition','incoterms','warranty','sku','accessPolicy'])r[name]=text(input[name],600);
    if(spec.kind==='model_capacity'){r.inputMillion=number(input.inputMillion||0,0,1e9);r.outputMillion=number(input.outputMillion||0,0,1e9);r.days=number(input.days,1,1095,true);r.tps=input.tps==null||input.tps===''?null:number(input.tps,1,1e9,true);if(r.inputMillion+r.outputMillion<=0)throw fail(400,'Enter a positive token volume.');}
    if(previous){Object.assign(previous,r);db.quotes.filter(q=>q.rfqId===r.id&&q.status==='Pending').forEach(q=>q.status='Needs refresh');}else db.rfqs.unshift(r);
    rememberSubmission(db,request,r);log(db,'RFQ submitted for operations review',user.id,r.id);
    notify(db,user.id,'RFQ under review',r.title+' was received. Operations will review it before suppliers can respond.',{rfqId:r.id,target:'rfq'});
    return r;
  });}
  async function decideRfq(id,input,operator='Administrator'){return change(db=>{
    const r=db.rfqs.find(row=>row.id===id);if(!r)throw fail(404,'RFQ submission not found.');
    if(!Number.isInteger(input.expectedRevision)||input.expectedRevision!==r.reviewRevision)throw fail(409,'This RFQ revision has changed. Refresh the submission before reviewing.');
    if(r.status!=='Reviewing'||r.reviewStatus!=='Reviewing'||r.orderId)throw fail(409,'This RFQ is not awaiting operations review.');
    if(!['Approved','Rejected'].includes(input.status))throw fail(400,'Choose Approve or Reject.');
    if(input.status==='Approved'&&(Date.parse(r.quoteDeadline)<=now()||Date.parse(r.start)<=now()))throw fail(409,'The RFQ service window or quote deadline has passed. Ask the buyer to update and resubmit.');
    r.reviewReason=text(input.reason,2000,input.status==='Rejected');r.reviewStatus=input.status;r.status=input.status==='Approved'?'Open':'Rejected';
    r.reviewedAt=timestamp();r.reviewedBy=text(operator,160,true);r.updatedAt=timestamp();
    r.audit||=[];r.audit.push({at:timestamp(),event:'Operations review '+input.status.toLowerCase(),revision:r.reviewRevision,reason:r.reviewReason});
    log(db,'RFQ operations review '+input.status.toLowerCase(),r.reviewedBy,r.id);
    notify(db,r.ownerId,input.status==='Approved'?'RFQ approved':'RFQ requires changes',input.status==='Approved'?r.title+(r.visibility==='Private RFQ'?' is approved as a private RFQ. Only the selected supplier may respond.':' is now a Live RFQ. Suppliers may now submit quotes.'):'Your RFQ '+r.title+' was rejected: '+r.reviewReason,{rfqId:r.id,target:'rfq'});
    return r;
  });}
  async function createSupply(user,input){role(user,'Seller');return change(db=>{approved(db,user);if(/BEGIN [A-Z ]*PRIVATE KEY/.test(JSON.stringify(input)))throw fail(400,'Never submit private SSH keys.');const request=submissionRequest(db,user,input,'supplies');if(request?.record)return request.record;if(db.supplies.filter(r=>r.ownerId===user.id&&!['Closed','Rejected'].includes(r.status)).length>=100)throw fail(429,'Too many active supply submissions.');const spec=standard(input),serviceStart=date(input.serviceStart||input.start,now()),serviceEnd=date(input.serviceEnd,Date.parse(serviceStart)+3600000),netPrice=round(number(input.netPrice??input.rate,0.000001,1e9));if(spec.kind==='gpu_rental'&&Date.parse(serviceEnd)-Date.parse(serviceStart)<spec.hours*3600000)throw fail(400,'The service window must cover the available hours.');const sshHost=text(input.sshHost,253,spec.kind==='gpu_rental'),sshUser=text(input.sshUser,100,spec.kind==='gpu_rental');if(sshHost&&!/^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(sshHost))throw fail(400,'Enter a valid SSH host without a URL or credentials.');const r={...spec,id:uid('SUP'),ownerId:user.id,ownerEmail:user.email,ownerName:user.name||'',title:text(input.title||input.name||spec.model,140,true),notes:text(input.notes,4000,true),netPrice,buyerPrice:netPrice,markupPercent:0,priceBasis:'base_rate',...feePolicy,serviceStart,serviceEnd,start:serviceStart,sshHost,sshUser,sshPort:number(input.sshPort||22,1,65535,true),agentStatus:'Pending',status:'Awaiting agent',createdAt:timestamp(),updatedAt:timestamp(),submission:receiveSubmission(),serverRecord:true};db.supplies.unshift(r);rememberSubmission(db,request,r);log(db,'Supply submitted; awaiting agent installation',user.id,r.id);return r;});}
  async function requestAgent(user,id){role(user,'Seller');const result=await change(db=>{approved(db,user);const r=owner(db.supplies,id,user);if(r.agentStatus==='Succeeded')throw fail(409,'The installation is already verified.');if(r.agentStatus==='Installing')throw fail(409,'Agent installation is already in progress.');r.agentStatus=agentAdapter?'Installing':'Pending';r.agentRequestedAt=timestamp();r.updatedAt=timestamp();log(db,'Agent installation requested',user.id,r.id);return {id:r.id,status:r.agentStatus,configured:!!agentAdapter,message:agentAdapter?'Agent installation request accepted.':'Agent installation integration is pending. Operations will connect the installer; this supply cannot be published yet.'};});if(agentAdapter){try{await agentAdapter.requestInstallation({supplyId:result.id});}catch{await agentResult(result.id,{status:'Failed',message:'The installer could not accept this request.'},'Installer adapter');return {...result,status:'Failed',message:'Installation request failed. Contact operations.'};}}return result;}
  async function agentResult(id,input,actor='Agent integration'){return change(db=>{const r=db.supplies.find(r=>r.id===id);if(!r)throw fail(404,'Supply not found.');if(!['Installing','Succeeded','Failed'].includes(input.status))throw fail(400,'Invalid installation state.');if(r.agentStatus==='Succeeded')throw fail(409,'Agent installation is already verified.');if(input.status==='Succeeded'&&(!text(input.agentId,200)||!input.verifiedAt))throw fail(400,'A verified agent identifier and timestamp are required.');if(input.verifiedAt&&Math.abs(now()-Date.parse(date(input.verifiedAt)))>300000)throw fail(400,'Agent verification timestamp is stale.');r.agentStatus=input.status;r.agentId=input.agentId?text(input.agentId,200):null;r.agentMessage=text(input.message,1000);r.updatedAt=timestamp();if(input.status==='Succeeded'){if(kybFor(db,r.ownerId)?.status!=='Approved')throw fail(409,'Supplier review is not approved.');r.status='Published';r.verifiedAt=input.verifiedAt;}else r.status=input.status==='Failed'?'Agent installation failed':'Awaiting agent';log(db,'Agent installation '+input.status,actor,r.id);notify(db,r.ownerId,'Capacity verification update',r.model+': '+r.status+'.');return {id:r.id,status:r.status,agentStatus:r.agentStatus};});}
  async function quoteInterest(user,id){role(user,'Buyer');return change(db=>{const s=db.supplies.find(s=>s.id===id&&liveSupply(s));if(!s)throw fail(404,'Supply not found.');if(s.ownerId===user.id)throw fail(403,'You cannot bid on your own supply.');const existing=db.interests.find(i=>i.buyerId===user.id&&i.supplyId===id);if(existing)existing.createdAt=timestamp();else db.interests.push({buyerId:user.id,supplyId:id,model:s.model,createdAt:timestamp()});return {biddingParties:bids(db,s.model)};});}
  async function submitQuote(user,rfqId,input){role(user,'Seller');return change(db=>{
    approved(db,user);const r=db.rfqs.find(r=>r.id===rfqId&&liveRfq(r));if(!r)throw fail(404,'Open RFQ not found.');
    if(r.visibility==='Private RFQ'&&!db.supplies.some(s=>s.id===r.originSupply&&s.ownerId===user.id))throw fail(403,'This RFQ is for another supplier.');
    const supply=db.supplies.find(s=>s.id===input.supplyId&&s.ownerId===user.id&&liveSupply(s));
    if(!supply||supply.kind!==r.kind||supply.model!==r.model||supply.region!==r.region||supply.count<r.count||supply.hours<r.hours)throw fail(409,'Select a published, verified supply matching this requirement.');
    if(db.quotes.some(q=>q.rfqId===r.id&&q.ownerId===user.id&&q.status==='Pending'))throw fail(409,'You already have a pending quote on this RFQ.');
    const netPrice=round(number(input.rate,0.000001,1e9)),validUntil=date(input.validUntil,now()+1000),amounts=transactionAmounts({kind:r.kind,rate:netPrice,count:r.count,hours:r.hours});
    if(amounts.subtotal<=0)throw fail(400,'The quoted transaction subtotal must be at least USD 0.01.');
    const q={id:uid('QUOTE'),rfqId:r.id,ownerId:user.id,supplyId:supply.id,kind:r.kind,model:r.model,region:r.region,count:r.count,hours:r.hours,term:r.term,netPrice,rate:netPrice,unitPrice:netPrice,buyerPrice:netPrice,price:netPrice,priceBasis:'base_rate',...amounts,validUntil,delivery:number(input.delivery||30,1,525600,true),notes:text(input.notes,4000,true),status:'Pending',createdAt:timestamp(),serverRecord:true};
    db.quotes.push(q);r.status='Quoted';notify(db,r.ownerId,'New supplier quote',r.id+' received a verified supplier quote. The buyer and seller each pay a separate OpenNEXT Fee 5% on the base transaction amount.');log(db,'Quote submitted',user.id,q.id);return q;
  });}
  async function decideQuote(user,rfqId,quoteId,action){role(user,'Buyer');return change(db=>{
    const r=owner(db.rfqs,rfqId,user),q=db.quotes.find(q=>q.id===quoteId&&q.rfqId===r.id);
    if(!q||q.status!=='Pending'||!liveRfq(r)||r.orderId)throw fail(409,'This quotation is no longer actionable.');
    if(action==='reject'){q.status='Rejected';notify(db,q.ownerId,'Quote not selected',r.id+': your quote was declined.');return {rfq:r,quote:buyerQuote(q,db)};}
    if(action!=='accept')throw fail(400,'Invalid quotation decision.');
    if(q.feePolicyVersion!==FEE_POLICY_VERSION)throw fail(409,'Ask the supplier for an updated quote with the current fee breakdown.');
    if(Date.parse(q.validUntil)<=now())throw fail(409,'This quote has expired.');
    const s=db.supplies.find(s=>s.id===q.supplyId&&liveSupply(s));if(!s)throw fail(409,'Supplier capacity is no longer available.');
    const amounts=transactionAmounts({kind:r.kind,rate:q.netPrice,count:r.count,hours:r.hours});
    // Acceptance always uses the authoritative saved base quote and requirement,
    // never totals, fee percentages or settlement amounts supplied by a client.
    q.status='Accepted';r.status='Confirmed';s.status='Reserved';
    const order={id:uid('ORDER'),rfqId:r.id,quoteId:q.id,buyerId:user.id,sellerId:q.ownerId,supplyId:s.id,kind:r.kind,model:r.model,count:r.count,hours:r.hours,days:r.days,inputMillion:r.inputMillion,outputMillion:r.outputMillion,region:r.region,term:r.term,unitPrice:q.netPrice,priceBasis:'base_rate',...amounts,currency:'USD',status:'Awaiting payment',paymentStatus:'Unpaid',serviceStart:r.start,serviceEnd:r.kind==='physical_gpu'?null:new Date(Date.parse(r.start)+(r.kind==='model_capacity'?r.days*86400000:r.hours*3600000)).toISOString(),buyer:{name:user.name,email:user.email},seller:{company:kybFor(db,q.ownerId)?.company||'Verified supplier'},provider:kybFor(db,q.ownerId)?.company||'Verified supplier',quoteValidUntil:q.validUntil,deliveryMinutes:q.delivery,createdAt:timestamp(),serverRecord:true};
    db.orders.unshift(order);r.orderId=order.id;notify(db,q.ownerId,'Quote accepted',r.id+' was awarded. Payment confirmation is pending. Seller proceeds are the base subtotal less OpenNEXT Fee 5%.');
    const rateUnit=r.kind==='gpu_rental'?' / GPU-hour':r.kind==='physical_gpu'?' / GPU':' total';
    for(const other of db.quotes.filter(x=>x.rfqId===r.id&&x.id!==q.id&&x.status==='Pending')){other.status='Not selected';notify(db,other.ownerId,'RFQ closed',r.id+' was awarded.'+(r.shareClosingPrice?' Closing base price: $'+q.netPrice.toFixed(2)+rateUnit+' before fees.':''));}
    log(db,'Quote accepted; awaiting payment',user.id,order.id);return {order:customerOrder(order,user)};
  });}
  async function instances(user){authorized(user);await pending;return clone(instanceView(await read(),user));}
  async function resell(user,id,input){role(user,'Buyer');return change(db=>{suspendUnsafeResales(db);const i=owner(db.instances,id,user),t=i.telemetry;if(i.resaleAllowed!==true)throw fail(409,'Your purchase does not grant resale rights.');if(i.paymentStatus!=='Paid'||i.status!=='Running')throw fail(409,'Only purchased, active capacity can be resold.');if(!t||now()-Date.parse(t.observedAt)>120000||Date.parse(t.observedAt)>now()+5000)throw fail(409,'Fresh verified telemetry is required before resale.');if(number(t.utilizationPercent,0,100)>=95)throw fail(409,'Resale is unavailable at or above 95% GPU utilization.');const existing=db.supplies.filter(s=>s.resaleOf===i.id&&['Published','Awaiting agent','Reserved'].includes(s.status)).reduce((n,s)=>n+s.count,0),count=number(input.count,1,Math.max(0,Number(t.idleGpuCount)-existing),true),hours=number(input.hours,1,26280,true);if(now()+hours*3600000>Date.parse(i.serviceEnd))throw fail(409,'Resale cannot exceed the purchased service window.');const netPrice=round(number(input.rate,0.000001,1e9)),r={id:uid('SUP'),ownerId:user.id,ownerEmail:user.email,kind:'gpu_rental',model:i.model,region:i.region,term:i.term||'On-demand',title:i.model+' unused capacity',count,hours,netPrice,buyerPrice:netPrice,markupPercent:0,priceBasis:'base_rate',...feePolicy,resaleOf:i.id,serviceStart:timestamp(),serviceEnd:new Date(now()+hours*3600000).toISOString(),agentStatus:'Succeeded',status:'Published',createdAt:timestamp(),serverRecord:true};db.supplies.push(r);log(db,'Verified idle capacity listed for resale',user.id,r.id);return r;});}
  async function telemetry(input){return change(db=>{const i=db.instances.find(i=>i.id===input.instanceId);if(!i)throw fail(404,'Instance not found.');const observedAt=date(input.observedAt);if(Math.abs(now()-Date.parse(observedAt))>120000)throw fail(400,'Telemetry is stale.');if(i.telemetry&&Date.parse(i.telemetry.observedAt)>Date.parse(observedAt))throw fail(409,'Telemetry must move forward in time.');i.telemetry={utilizationPercent:number(input.utilizationPercent,0,100),idleGpuCount:number(input.idleGpuCount,0,i.count,true),observedAt};suspendUnsafeResales(db);return {ok:true};});}
  async function recent(days=3){
    if(days!=='ALL')days=number(days,1,365,true);
    if(days==='ALL'||days>90)throw Object.assign(fail(403,'Free historical data includes up to 3 months. Contact Sales for access to more history.'),{code:'HISTORY_ACCESS_REQUIRED'});
    await pending;const db=await read(),end=now(),start=end-days*86400000;
    return clone(db.orders.filter(o=>{const settled=Date.parse(o.settledAt);return o.status==='Completed'&&Number.isFinite(settled)&&settled>=start&&settled<=end;}).map(o=>({id:o.id,model:o.model,region:o.region,term:o.term,count:o.count,hours:o.hours,price:o.unitPrice,provider:'Settled transaction',settledAt:o.settledAt,serverRecord:true})));
  }
  async function admin(){return change(db=>{syncFeatured(db);return {rfqs:db.rfqs,supplies:db.supplies.map(({sshHost,sshUser,...s})=>({...s,sshConfigured:!!sshHost})),kyb:db.kyb,featured:db.homepageReviews.slice().sort((a,b)=>Number(b.current)-Number(a.current)||compareModel(a,b)||b.submittedAt.localeCompare(a.submittedAt)),audit:db.audit.slice(0,200),generatedAt:timestamp()};});}
  return {publicMarket,mine,best,submitKyb,decideKyb,saveRfq,decideRfq,createSupply,requestAgent,agentResult,quoteInterest,submitQuote,decideQuote,instances,resell,telemetry,recent,admin,decideFeatured};
}
function createMarketplaceRouter(service,{auth,security,env=process.env}={}) {
  const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  async function body(req){if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail(415,'Use a JSON request.');let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>32768)throw fail(413,'The request is too large.');chunks.push(chunk);}let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail(400,'Invalid JSON request.');}if(!value||typeof value!=='object'||Array.isArray(value))throw fail(400,'Invalid request object.');return value;}
  function internal(req){const token=String(env.OPENNEXT_AGENT_CALLBACK_TOKEN||'');const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');return token.length>=32&&supplied.length===token.length&&crypto.timingSafeEqual(Buffer.from(token),Buffer.from(supplied));}
  return async(req,res,url,{onTerminal=false}={})=>{
    const p=url.pathname;if(!p.startsWith('/api/marketplace/')&&!p.startsWith('/api/admin/marketplace')&&!p.startsWith('/api/internal/marketplace/'))return false;
    try {
      if(p==='/api/marketplace/public'&&req.method==='GET'){send(res,200,await service.publicMarket());return true;}
      if(p==='/api/marketplace/settlements'&&req.method==='GET'){
        const periods=url.searchParams.getAll('period'),days=url.searchParams.getAll('days');
        if(periods.length>1||days.length>1||(periods.length&&days.length))throw fail(400,'Choose one history period.');
        let window=3;
        if(periods.length){
          const period=String(periods[0]).trim().toUpperCase(),windows={'1D':1,'3D':3,'1W':7,'1M':30,'3M':90,'6M':180,'1Y':365,ALL:'ALL'};
          if(!Object.hasOwn(windows,period))throw fail(400,'Invalid history period.');
          window=windows[period];
        }else if(days.length){
          window=String(days[0]).trim().toUpperCase()==='ALL'?'ALL':number(days[0],1,365,true);
        }
        send(res,200,{rows:await service.recent(window)});return true;
      }
      if(p.startsWith('/api/internal/marketplace/')){if(!internal(req))throw fail(401,'Integration authorization required.');if(req.method!=='POST')throw fail(405,'Method not allowed.');const input=await body(req);const match=p.match(/^\/api\/internal\/marketplace\/supplies\/(SUP-[A-F0-9]+)\/agent$/);if(match)send(res,200,await service.agentResult(match[1],input));else if(p==='/api/internal/marketplace/telemetry')send(res,200,await service.telemetry(input));else throw fail(404,'Not found.');return true;}
      if(p.startsWith('/api/admin/marketplace')){if(onTerminal)throw fail(404,'Not found.');if(!security?.authenticated(req))throw fail(401,'Administrator sign-in is required.');if(req.method!=='GET'&&!security.sameOrigin(req)&&!security.bearerAuthenticated(req))throw fail(403,'Origin not allowed.');if(p==='/api/admin/marketplace'&&req.method==='GET'){send(res,200,await service.admin());return true;}const m=p.match(/^\/api\/admin\/marketplace\/kyb\/(KYB-[A-F0-9]+)$/);if(m&&req.method==='PATCH'){send(res,200,await service.decideKyb(m[1],await body(req)));return true;}const rfq=p.match(/^\/api\/admin\/marketplace\/rfqs\/(RFQ-[A-F0-9]+)$/);if(rfq&&req.method==='PATCH'){send(res,200,await service.decideRfq(rfq[1],await body(req)));return true;}const featured=p.match(/^\/api\/admin\/marketplace\/featured\/(HPR-[A-F0-9]+)$/);if(featured&&req.method==='PATCH'){send(res,200,await service.decideFeatured(featured[1],await body(req)));return true;}throw fail(404,'Not found.');}
      const user=await auth?.authenticate(req);if(!user)throw fail(401,'Sign in with a verified account.');if(req.method!=='GET'&&!auth.checkCsrf(req,user))throw fail(403,'The session or request origin is invalid. Refresh and try again.');
      if(p==='/api/marketplace/me'&&req.method==='GET')send(res,200,await service.mine(user));
      else if(p==='/api/marketplace/matches'&&req.method==='GET')send(res,200,await service.best(user,Object.fromEntries(url.searchParams)));
      else if(p==='/api/marketplace/instances'&&req.method==='GET')send(res,200,{instances:await service.instances(user)});
      else if(p==='/api/marketplace/kyb'&&req.method==='POST')send(res,201,{review:await service.submitKyb(user,await body(req))});
      else if(p==='/api/marketplace/rfqs'&&req.method==='POST')send(res,201,{rfq:await service.saveRfq(user,await body(req))});
      else if(p==='/api/marketplace/supplies'&&req.method==='POST')send(res,201,{supply:await service.createSupply(user,await body(req))});
      else if(p==='/api/marketplace/quote-interest'&&req.method==='POST')send(res,200,await service.quoteInterest(user,(await body(req)).supplyId));
      else {let m;if((m=p.match(/^\/api\/marketplace\/rfqs\/(RFQ-[A-F0-9]+)$/))&&req.method==='PATCH')send(res,200,{rfq:await service.saveRfq(user,await body(req),m[1])});else if((m=p.match(/^\/api\/marketplace\/rfqs\/(RFQ-[A-F0-9]+)\/quotes$/))&&req.method==='POST')send(res,201,{quote:await service.submitQuote(user,m[1],await body(req))});else if((m=p.match(/^\/api\/marketplace\/rfqs\/(RFQ-[A-F0-9]+)\/quotes\/(QUOTE-[A-F0-9]+)\/(accept|reject)$/))&&req.method==='POST')send(res,200,await service.decideQuote(user,m[1],m[2],m[3]));else if((m=p.match(/^\/api\/marketplace\/supplies\/(SUP-[A-F0-9]+)\/agent$/))&&req.method==='POST')send(res,200,await service.requestAgent(user,m[1]));else if((m=p.match(/^\/api\/marketplace\/instances\/([A-Za-z0-9_-]+)\/resell$/))&&req.method==='POST')send(res,201,{supply:await service.resell(user,m[1],await body(req))});else throw fail(404,'Marketplace route not found.');}
    }catch(error){const known=[400,401,402,403,404,405,409,413,415,429,503].includes(error.status);send(res,known?error.status:503,{error:known?error.message:'The marketplace service is unavailable. Please try again.',...(error.code==='HISTORY_ACCESS_REQUIRED'?{code:error.code}:{})});}return true;
  };
}
module.exports={createMarketplaceService,createMarketplaceRouter};
