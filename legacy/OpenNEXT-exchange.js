/* Verified marketplace records. Browser state never authorizes transactions or supply publication. */
(function (scope) {
  'use strict';
  const KEY = 'opennext-terminal-v3';
  let state = null;
  let market = {rfqs:[],supplies:[],featured:{rfqs:[],supplies:[]}}, bestRows=[], recentRows=[], matchReason='', matchPrompt='', loaded=false, error='';
  let refreshJob=null,refreshIdentity=null,cacheIdentity='';
  let referenceCatalog = {supplies:[],rfqs:[],recent:[]}, referenceLoaded = false;
  const billingStates=new WeakMap();
  const billingIdentity=S=>{const user=scope.OpenNEXTAuth?.getUser?.();return user?.id&&user.onboardingCompleted&&S?.user?.id===user.id?JSON.stringify([user.id,String(user.role||'').toLowerCase(),!!user.demo||!!scope.OpenNEXTDemo?.active]):'';};
  const creditAmount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&Number.isSafeInteger(Math.round(value*100));
  function mergeNotifications(S,marketplaceRows){
    const owner=scope.OpenNEXTAuth?.getUser?.()?.id;
    if(!S)return [];
    if(marketplaceRows!==undefined)S.marketplaceNotifications=Array.isArray(marketplaceRows)?marketplaceRows:[];
    else if(!Array.isArray(S.marketplaceNotifications))S.marketplaceNotifications=(Array.isArray(S.notifications)?S.notifications:[]).filter(row=>!row.topupId);
    const rows=new Map();
    for(const row of [...S.marketplaceNotifications,...(S.billingNotifications||[])])if(owner&&S.user?.id===owner&&row?.ownerId===owner&&typeof row.id==='string')rows.set(row.id,row);
    S.notifications=[...rows.values()].sort((a,b)=>(Date.parse(b.created||b.createdAt)||0)-(Date.parse(a.created||a.createdAt)||0));
    return S.notifications;
  }
  function billingState(S){
    if(!S)return null;
    const identity=billingIdentity(S);let current=billingStates.get(S);
    if(!current||current.identity!==identity){
      const user=identity?scope.OpenNEXTAuth.getUser():null;
      current={identity,pending:null,confirmed:false};billingStates.set(S,current);
      S.billingAccountId=null;S.billingAccountConfirmed=false;S.topupRequests=[];S.billingNotifications=[];
      S.paidCredit=creditAmount(user?.fundedCredit)?user.fundedCredit:0;S.promotionalCredit=creditAmount(user?.promotionalCredit)?user.promotionalCredit:0;S.balance=S.paidCredit+S.promotionalCredit;
      mergeNotifications(S);
    }
    return current;
  }
  function applyBillingAccount(S,result){
    const current=billingState(S),user=scope.OpenNEXTAuth?.getUser?.();
    if(!current?.identity)return null;
    if(result?.confirmed!==true||result.accountId!==user.id||result.currency!=='USD'||!['availableCredit','paidCredit','promotionalCredit'].every(key=>creditAmount(result[key]))||!Array.isArray(result.requests)||!Array.isArray(result.notifications))throw Error('The verified credit account response is incomplete.');
    S.balance=result.availableCredit;S.paidCredit=result.paidCredit;S.promotionalCredit=result.promotionalCredit;S.billingAccountId=result.accountId;S.billingAccountConfirmed=true;current.confirmed=true;
    S.topupRequests=result.requests.filter(row=>row&&typeof row.id==='string'&&row.accountId===user.id&&(!row.ownerId||row.ownerId===user.id));
    S.billingNotifications=result.notifications.filter(row=>row&&typeof row.id==='string'&&row.ownerId===user.id);
    mergeNotifications(S);
    scope.dispatchEvent?.(new CustomEvent('opennext:billing',{detail:{accountId:user.id}}));
    return result;
  }
  async function refreshBillingAccount(S=state){
    const current=billingState(S);if(!current?.identity)return null;
    if(current.pending)return current.pending;
    const identity=current.identity;
    const job=(async()=>{try{const result=await api('/api/billing/account');if(billingStates.get(S)!==current||billingIdentity(S)!==identity)return null;return applyBillingAccount(S,result);}finally{if(billingStates.get(S)===current)current.pending=null;}})();
    current.pending=job;return job;
  }
  function hasVerifiedBillingAccount(S){return !!S&&billingStates.get(S)?.confirmed===true&&billingStates.get(S)?.identity===billingIdentity(S);}
  function invalidateBillingAccount(S){if(S)billingStates.delete(S);}
  const refreshKey=S=>JSON.stringify([scope.OpenNEXTAuth?.getUser?.()?.id||null,scope.OpenNEXTAuth?.getUser?.()?.role||null,S?.model||'',S?.region||'']);
  async function api(path, method='GET', body) {
    const user=scope.OpenNEXTAuth?.getUser?.();
    const response=await fetch(path,{method,credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'&&user?.csrfToken?{'X-CSRF-Token':user.csrfToken}:{})},body:body?JSON.stringify(body):undefined});
    const result=await response.json().catch(()=>({error:'The marketplace response is unavailable.'}));
    if(!response.ok){const e=Error(result.error||'The marketplace request failed.');e.status=response.status;throw e;}return result;
  }
  async function refresh(S=state) {
    const userSnapshot=scope.OpenNEXTAuth?.getUser?.(),modelSnapshot=S?.model||'',regionSnapshot=S?.region||'';
    const identity=refreshKey(S),accountKey=JSON.stringify([userSnapshot?.id||null,userSnapshot?.role||null]);
    if(cacheIdentity!==accountKey){bestRows=[];matchReason='No matches.';matchPrompt='';cacheIdentity=accountKey;}
    if(refreshJob){if(refreshIdentity===identity)return refreshJob;await refreshJob.catch(()=>{});return refresh(S);}
    refreshIdentity=identity;
    refreshJob=(async()=>{try{
      market=await api('/api/marketplace/public');generated.clear();error='';loaded=true;
      if (!scope.OpenNEXTDemo?.active && !referenceLoaded) {
        try {const result=await api('/api/marketplace/reference-catalog');referenceCatalog={supplies:result.supplies||[],rfqs:result.rfqs||[],recent:result.recent||[]};referenceLoaded=true;} catch { /* Real marketplace data remains available if reference data is offline. */ }
      }
      const user=userSnapshot;
      if(user?.onboardingCompleted&&S){const own=await api('/api/marketplace/me');if(refreshKey(S)!==identity)return null;const result=await api('/api/marketplace/matches?'+new URLSearchParams({model:modelSnapshot,region:regionSnapshot}));if(refreshKey(S)!==identity)return null;for(const field of ['rfqs','listings','review','responses','orders','instances'])S[field]=own[field];mergeNotifications(S,own.notifications);try{await refreshBillingAccount(S);}catch{/* Retain the last verified credit account while billing is unavailable. */}if(refreshKey(S)!==identity)return null;S.marketplaceAuthoritative=true;bestRows=result.rows;matchReason=result.reason;matchPrompt=result.submissionPrompt||'';}
      else {bestRows=[];matchReason='No matches.';matchPrompt='Sign in to receive same-model recommendations.';}
      recentRows=(await api('/api/marketplace/settlements?days=90')).rows;
      return market;
    }catch(e){error=e.message;throw e;}finally{refreshJob=null;scope.dispatchEvent?.(new CustomEvent('opennext:marketplace',{detail:{error}}));}})();return refreshJob;
  }
  const publicKind=value=>({gpu_rental:'rental',model_capacity:'model',physical_gpu:'hardware'}[value]||value);
  const status=()=>({loaded,error,matchReason,matchPrompt});
  const round = n => Math.round(Number(n) * 100) / 100;
  const uid = prefix => prefix + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const now = () => new Date().toISOString();
  const kindOf = r => ({model:'model_capacity',hardware:'physical_gpu',rental:'gpu_rental'}[r?.kind] || r?.kind || 'gpu_rental');
  const unitLabel = r => kindOf(r)==='model_capacity'?'total':kindOf(r)==='physical_gpu'?'GPU':'GPU-hour';
  const deliveryMethod = r => kindOf(r)==='model_capacity'?'Authorized API access':kindOf(r)==='physical_gpu'?'Insured shipment with serial-number manifest':'SSH / dedicated instance';
  function totalFor(r, price) { return round(kindOf(r)==='model_capacity'?Number(price):Number(price)*Number(r.count)*(kindOf(r)==='physical_gpu'?1:Number(r.hours))); }
  function tokenTotal(r, input, output) { return round(Number(r.inputMillion||0)*Number(input)+Number(r.outputMillion||0)*Number(output)); }
  const models = [['H100', 2.35], ['H100 SXM', 2.35], ['H100 PCIe', 2.12], ['H200', 3.18], ['B200', 3.7], ['B300', 4.8], ['A100 80GB', 1.5], ['L40S', .9], ['RTX PRO 6000 Blackwell', 1.2], ['RTX 5090', .7], ['RTX 4090', .45], ['AMD MI300X', 1.8], ['GB200 NVL72', 5.2]];
  const regions = [['US East', 'us-east-1'], ['Singapore', 'ap-southeast-1'], ['Frankfurt', 'eu-central-1'], ['Tokyo', 'ap-northeast-1'], ['US West', 'us-west-2']];
  const suppliers = ['Northstar Compute', 'Atlas Grid', 'Arbor Cloud', 'Frontier Grid', 'Helix Infrastructure'];
  function getState() { if (state) return state; try { return JSON.parse(scope.localStorage?.getItem(KEY) || '{}'); } catch { return {}; } }
  function init(S) {
    state = S;
    for (const field of ['orders', 'notifications', 'responses', 'ledger', 'instances']) if (!Array.isArray(S[field])) S[field] = [];
    for (const r of S.rfqs || []) {
      r.kind ||= 'gpu_rental'; r.project ||= r.title; r.notes ||= 'Confirm the exact GPU, network, storage and delivery window before award.';
      r.urgency ||= 'Standard'; r.quoteDeadline ||= new Date(Date.now() + 12 * 3600000).toISOString();
      r.start ||= new Date(Date.now() + 24 * 3600000).toISOString(); r.deliveryMethod ||= deliveryMethod(r);
      if(kindOf(r)==='physical_gpu'){r.hours=0;r.term='Physical GPU';if(r.deliveryMethod==='SSH / dedicated instance')r.deliveryMethod=deliveryMethod(r);}
      r.visibility ||= 'Public requirements'; r.shareClosingPrice ??= true; r.created ||= now(); r.audit ||= [];
      r.quotes ||= []; r.quotes.forEach(q => { q.status ||= 'Pending'; });
      if (['RFQ-08421', 'RFQ-08418'].includes(r.id)) r.sample = true;
      // Supplier quotations arrive only through the authenticated marketplace service.
    }
    return S;
  }
function regionCountry(value){
  const countries=scope.OpenNEXTCountries||{list:[]};
  const label=String(value||'').trim(),known=(countries.list||[]).find(c=>c.name===label||c.code===label);if(known)return known.name;
  const regions={'eu-west-1':'Ireland','eu-west-2':'United Kingdom','eu-west-3':'France','eu-central-1':'Germany','eu-central-2':'Switzerland','eu-north-1':'Sweden','eu-south-1':'Italy','eu-south-2':'Spain','ap-south-1':'India','ap-south-2':'India','ap-southeast-1':'Singapore','ap-southeast-2':'Australia','ap-southeast-3':'Indonesia','ap-southeast-4':'Australia','ap-southeast-5':'Malaysia','ap-southeast-6':'New Zealand','ap-southeast-7':'Thailand','ap-east-1':'Hong Kong SAR China','ap-east-2':'Taiwan','ap-northeast-1':'Japan','ap-northeast-2':'South Korea','ap-northeast-3':'Japan','af-south-1':'South Africa','me-south-1':'Bahrain','me-central-1':'United Arab Emirates','il-central-1':'Israel','mx-central-1':'Mexico','sa-east-1':'Brazil'};
  if(regions[label])return regions[label];if(/^us-|^US (East|West)/i.test(label))return 'United States';if(/^ca-/i.test(label))return 'Canada';if(/^cn-/i.test(label))return 'China';
  const cities={Frankfurt:'Germany',Tokyo:'Japan',Seoul:'South Korea',Mumbai:'India',Sydney:'Australia',London:'United Kingdom',Paris:'France',Stockholm:'Sweden',Zurich:'Switzerland',Jakarta:'Indonesia',Oregon:'United States','N. Virginia':'United States',Ohio:'United States',California:'United States'};return cities[label]||label;
}
  const regionMatches=(a,b)=>regionCountry(regionCode(a))===regionCountry(regionCode(b));
  const EUROPE=new Set('AL AD AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM TR UA VA'.split(' '));
  const EUROPEAN_UNION=new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '));
  function recordRegionMatches(row,selected){
    if(!selected||selected==='All regions')return true;
    if(!row.external)return regionMatches(row.region,selected);
    const area=row.regionScope||{},country=regionCountry(regionCode(selected)),entry=(scope.OpenNEXTCountries?.list||[]).find(item=>item.name===country||item.code===country);
    if(!entry)return selected===row.region;
    if((area.excludedCountries||[]).some(value=>regionMatches(value,entry.name)))return false;
    if(['worldwide','flexible'].includes(area.type))return true;
    if(area.type==='europe')return (area.unionOnly?EUROPEAN_UNION:EUROPE).has(entry.code);
    if(area.type==='countries')return (area.countries||[]).some(value=>regionMatches(value,entry.name));
    return regionMatches(row.region,selected);
  }
  function recordCount(row){
    if(!row.external)return Number(row.count);
    const q=row.quantity||{},perNode=Number(q.gpusPerNode);
    for(const value of [q.totalGpus,q.totalGpusMax,q.totalGpusMin])if(value!=null&&Number.isFinite(Number(value)))return Number(value);
    const nodes=q.maxNodes??q.nodes??q.minNodes;
    return nodes!=null&&perNode>0?Number(nodes)*perNode:null;
  }
  function eligible(row,filters){
    const count=recordCount(row);
    return row.model===filters.model&&recordRegionMatches(row,filters.region)&&(!filters.count||count==null||count>=Number(filters.count))&&(!filters.term||row.external&&!row.term||row.term===filters.term);
  }
  const priceSort=side=>(a,b)=>a.price==null?b.price==null?0:1:b.price==null?-1:side==='supply'?a.price-b.price:b.price-a.price;
  function projectModel(row,selected){
    if(!row.external||row.model!==selected&&!(row.modelOptions||[]).includes(selected))return row;
    return {...row,model:selected,price:row.modelBudgets?.[selected]??(row.model===selected?row.price:null),bestMatch:false};
  }
  function regionCode(region) {
    return scope.ONMarket?.regionCode(region) || regions.find(r => r.includes(region))?.[1] || region;
  }
  function listPublic(kind='rental',side='supply'){return (side==='demand'?market.rfqs:market.supplies).filter(r=>publicKind(r.kind)===publicKind(kind));}
  function get(id) { for (const kind of ['rental','model','hardware']) for(const side of ['supply','demand']) { const row=listPublic(kind,side).find(r=>r.id===id); if(row)return row; } return null; }
  function matches(filters={},side='supply') {
    return listPublic('rental',side).map(r=>projectModel(r,filters.model)).filter(r=>eligible(r,filters)).sort(priceSort(side));
  }
  const generated = new Map();
  function referenceRows(filters={},side='supply') {
    if(scope.OpenNEXTDemo?.active)return [];
    return (side==='supply'?referenceCatalog.supplies:referenceCatalog.rfqs).filter(r=>r.model===filters.model&&(!filters.region||filters.region==='All regions'||regionMatches(r.region,filters.region))&&(!filters.count||r.count>=Number(filters.count))&&(!filters.term||r.term===filters.term)).sort((a,b)=>side==='supply'?a.price-b.price:b.price-a.price);
  }
  function marketRows(filters,side) {const actual=matches(filters,side),rows=actual.length?actual:referenceRows(filters,side);rows.forEach(r=>generated.set(r.id,r));return rows;}
  function best(filters=state||{}) {
    const actual=bestRows.map(r=>projectModel(r,filters.model)).filter(r=>r.model===filters.model&&recordRegionMatches(r,filters.region)).map(r=>r.external?{...r,bestMatch:false}:r);
    const rows=actual.length?actual:referenceRows(filters,filters.role==='Seller'?'demand':'supply');rows.forEach(r=>generated.set(r.id,r));return rows;
  }
  function recent(filters, days=3) {
    if(!filters)return recentRows;
    const cutoff=Date.now()-Number(days)*86400000;
    const actual=recentRows.filter(r=>!r.external&&r.model===filters.model&&(!filters.region||filters.region==='All regions'||regionMatches(r.region,filters.region))&&Date.parse(r.settledAt)>=cutoff&&Date.parse(r.settledAt)<=Date.now());
    return actual.length||scope.OpenNEXTDemo?.active?actual:referenceCatalog.recent.filter(r=>r.model===filters.model&&(!filters.region||filters.region==='All regions'||regionMatches(r.region,filters.region)));
  }
  function find(id) {
    const current=generated.get(id)||get(id);if(current)return current;
    const S=getState();
    return [...(S.cart||[]),...(S.saved||[])].find(r=>r&&typeof r==='object'&&r.id===id&&r.side==='supply'&&['rental','model','hardware','gpu_rental','model_capacity','physical_gpu'].includes(r.kind)&&(/^(EX-|MATCH-|SUP)/.test(r.id)||r.originSupply))||null;
  }
  function sampleQuotes(r) {
    if(r.external||r.executable===false)return [];
    const model=kindOf(r)==='model_capacity',physical=kindOf(r)==='physical_gpu',chosen=r.originSupply?find(r.originSupply):null;
    const base=Number(r.budget)|| (physical?24500:model?100:models.find(m=>m[0]===r.model)?.[1]||2.35);
    return (chosen?[chosen.provider]:suppliers.slice(0,3)).map((provider,i)=>{
      const factor=chosen?1:[.92,.97,1][i];
      const hasTokenRates=model&&r.priceSnapshot?.input!=null&&r.priceSnapshot?.output!=null&&Number.isFinite(Number(r.priceSnapshot.input))&&Number.isFinite(Number(r.priceSnapshot.output));
      const input=hasTokenRates?Number((r.priceSnapshot.input*factor).toFixed(6)):null,output=hasTokenRates?Number((r.priceSnapshot.output*factor).toFixed(6)):null;
      const price=hasTokenRates?tokenTotal(r,input,output):round(base*factor);
      return {id:`QUOTE-${r.id}-${i}`,provider,supplierId:chosen?.id||'supplier-'+i,price,total:totalFor(r,price),input,output,priceBasis:hasTokenRates?'token_rates':model?'total':'unit',delivery:physical?[10080,14400,20160][i]:[30,90,60][i],sla:physical?'Warranty and acceptance per quote':['99.9%','99.95%','99.9%'][i],region:r.region,model:r.model,count:r.count,term:r.term||'Model capacity',status:'Pending',validUntil:new Date(Date.now()+[24,36,48][i]*3600000).toISOString(),submittedAt:now(),sample:true,paymentTerms:'Prepaid workspace credit',deliveryMethod:r.deliveryMethod||deliveryMethod(r),cancellation:physical?'Before shipment: supplier terms; inspection and warranty claims per contract':'Before provisioning: refundable; after delivery: supplier terms apply',notes:physical?'Exact SKU, serial numbers, warranty and shipping charges must be confirmed.':'Review access rights and the service window before accepting.'};
    });
  }
  function notify(S,role,subject,message,extra={}) {const n={id:uid('NTF'),role,subject,message,created:now(),read:false,delivery:'Workspace notification',...extra};S.notifications.unshift(n);return n;}
  function accept(S,r,q) {
    if(r.external||r.executable===false)throw Error('Sourced requirements must be coordinated through OpenNEXT operations.');
    if(!['Open','Quoted'].includes(r.status)||r.accepted)throw Error('This requirement already has a selected quote.');
    if(q.status!=='Pending')throw Error('This quote is no longer available.');
    if(S.orders.some(order=>order.quoteId===q.id))throw Error('This quote already has an order. Open the existing order.');
    if(!q.validUntil||!Number.isFinite(+new Date(q.validUntil))||new Date(q.validUntil)<=new Date())throw Error('This quote has expired. Request a refreshed quote.');
    if(!r.quotes.some(quote=>quote===q||quote.id===q.id))throw Error('This quote does not belong to the requirement.');
    if(r.originSupply&&q.supplierId!==r.originSupply&&q.provider!==r.selectedSupplier)throw Error('This private requirement is for the selected supplier only.');
    const expectedTotal=totalFor(r,q.price),checkedTotal=Number(q.total??expectedTotal);
    if(!Number.isFinite(checkedTotal)||checkedTotal<=0||!Number.isFinite(Number(q.price))||Number(q.price)<=0)throw Error('The quote has an invalid amount. Request a new quote.');
    if(!Number.isFinite(expectedTotal)||Math.abs(checkedTotal-expectedTotal)>.011)throw Error('The quote total does not match its unit price and quantity. Request a corrected quote.');
    q.status='Accepted';r.accepted={...q};r.status='Confirmed';r.awardedAt=now();
    const total=round(checkedTotal);
    const order={id:uid('ORDER'),rfqId:r.id,quoteId:q.id,title:r.title,kind:r.kind,model:r.model,sku:r.sku,count:r.count,region:r.region,term:r.term||'Model capacity',hours:r.hours,days:r.days,inputMillion:r.inputMillion,outputMillion:r.outputMillion,unitPrice:q.price,rate:q.price,subtotal:total,fees:0,tax:0,total,amount:total,currency:'USD',buyer:{name:S.identity.name,company:S.identity.company||'Workspace buyer',email:S.identity.email},seller:{name:q.provider,company:q.provider,email:q.email||'Available in supplier conversation'},provider:q.provider,role:S.role,status:'Awaiting payment',paymentStatus:'Unpaid',paymentMethod:'Workspace credit',tradeMethod:r.originSupply?'Listed offer':'RFQ award',createdAt:now(),created:now(),quoteValidUntil:q.validUntil,deliveryMinutes:q.delivery,deliveryMethod:q.deliveryMethod,serviceStart:r.start,serviceEnd:r.start&&r.hours?new Date(new Date(r.start).getTime()+r.hours*3600000).toISOString():null,notes:r.notes,sample:!!q.sample,audit:[{at:now(),event:'Quote accepted; order awaiting payment'}]};
    order.side='buy';order.priceUnit=unitLabel(r);order.originSupply=r.originSupply||null;order.inputRate=q.input;order.outputRate=q.output;order.shippingAddress=r.shippingAddress;order.condition=r.condition;order.warranty=r.warranty;order.incoterms=r.incoterms;order.sla=q.sla||r.sla;order.cancellationTerms=q.cancellationTerms||q.cancellation||'Confirm with supplier';order.client=r.client||null;
    if(S.role==='Broker'){order.broker={name:S.identity.name,company:S.identity.company,email:S.identity.email};order.buyer={name:r.client||'Represented client',company:r.client||'Represented client',email:r.clientEmail||'Through authorized broker'};}
    if(kindOf(r)==='physical_gpu'){order.hours=0;order.serviceEnd=null;order.deliveryMethod=q.deliveryMethod||deliveryMethod(r);}
    if(kindOf(r)==='model_capacity'&&r.start&&r.days)order.serviceEnd=new Date(new Date(r.start).getTime()+r.days*86400000).toISOString();
    r.orderId=order.id;S.orders.unshift(order);r.audit.push({at:now(),event:'Accepted '+q.provider+' quote',actor:S.role});
    const response=S.responses.find(res=>res.id===q.id);if(response){response.status='Accepted';response.orderId=order.id;}
    notify(S,'Seller','Quote accepted',`${r.id}: your quote was selected. Order ${order.id} is awaiting buyer payment.`,{supplier:q.provider,rfqId:r.id,orderId:order.id});
    for(const other of r.quotes.filter(x=>x.id!==q.id&&x.status==='Pending')){other.status='Not selected';const declined=S.responses.find(res=>res.id===other.id);if(declined)declined.status='Not selected';notify(S,'Seller','RFQ closed',`${r.id} has been awarded.${r.shareClosingPrice?' Closing '+(kindOf(r)==='model_capacity'?'total':'unit price')+': $'+Number(q.price).toFixed(2)+(kindOf(r)==='model_capacity'?'':' / '+unitLabel(r))+'.':''}`,{supplier:other.provider,rfqId:r.id});}
    return order;
  }
  function reject(S,r,q){if(r.accepted||!['Open','Quoted'].includes(r.status)||q.status!=='Pending')throw Error('This quote cannot be rejected.');q.status='Rejected';q.rejectedAt=now();const response=S.responses.find(res=>res.id===q.id);if(response){response.status='Rejected';response.rejectedAt=q.rejectedAt;}r.audit.push({at:now(),event:'Rejected '+q.provider+' quote',actor:S.role});notify(S,'Seller','Quote not selected',r.id+': the buyer declined your quote.',{supplier:q.provider,rfqId:r.id});}
  function pay(S,order){
    if(order.paymentStatus==='Paid')return false;
    if(order.side!=='buy'||order.status!=='Awaiting payment')throw Error('This order is not awaiting buyer payment.');
    if(!Number.isFinite(order.total)||order.total<=0||!Number.isFinite(Number(S.balance)))throw Error('Invalid payment amount or credit balance.');
    if(Number(S.balance)<order.total)throw Error('Insufficient credit. Add credit, then return to this order.');
    const paymentId=uid('PAY'),at=now();S.balance=round(S.balance-order.total);order.paymentStatus='Paid';order.status='Paid';order.paidAt=at;order.paymentId=paymentId;order.paymentReference=paymentId;
    order.audit.push({at,event:'Workspace credit payment confirmed'});
    S.ledger.unshift({id:paymentId,paymentReference:paymentId,orderId:order.id,type:'Capacity purchase',amount:-order.total,date:at,createdAt:at,role:S.role,side:'buy',status:'Completed',test:true});
    notify(S,'Seller','Payment confirmed',`${order.id} is funded. Prepare delivery.`,{supplier:order.provider,orderId:order.id});return true;
  }
  const exposed={init,getState,uid,round,listPublic,get:find,matches:marketRows,sampleQuotes,notify,accept,reject,pay,regionCode,regionCountry,kindOf,unitLabel,deliveryMethod,totalFor,tokenTotal,api,refresh,refreshBillingAccount,applyBillingAccount,mergeNotifications,hasVerifiedBillingAccount,invalidateBillingAccount,status,regionMatches,recordRegionMatches,featured:()=>market.featured,best,recent};
  scope.OpenNEXTExchange=exposed;
  if(typeof module!=='undefined')module.exports=exposed;
})(typeof window!=='undefined'?window:globalThis);
