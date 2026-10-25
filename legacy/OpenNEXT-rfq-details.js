/* Shared, read-only request presentation for the Terminal and Operations Console. */
(function (root) {
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const present=value=>value!==null&&value!==undefined&&value!=='';
  const numeric=value=>present(value)&&Number.isFinite(Number(value));
  const defaultMoney=value=>numeric(value)?'$'+Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'Not provided';
  const defaultDate=value=>present(value)&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-GB',{timeZone:'UTC'})+' UTC':'Not provided';
  const kind=record=>({rental:'gpu_rental',hardware:'physical_gpu',model:'model_capacity'}[record.kind]||record.kind||'gpu_rental');
  function maximum(record){
    if(!numeric(record.budget))return null;
    const units=kind(record)==='model_capacity'?1:Number(record.count)*(kind(record)==='physical_gpu'?1:Number(record.hours));
    const micros=Math.round(Number(record.budget)*1e6);
    if(!Number.isSafeInteger(units)||units<1||!Number.isSafeInteger(micros)||micros<0)return null;
    const cents=(BigInt(micros)*BigInt(units)+5000n)/10000n;
    return cents<=BigInt(Number.MAX_SAFE_INTEGER)?Number(cents)/100:null;
  }
  function render(record={},options={}){
    const esc=typeof options.esc==='function'?options.esc:escape;
    const money=typeof options.money==='function'?options.money:defaultMoney;
    const date=typeof options.date==='function'?options.date:defaultDate;
    const field=(name,label,raw,full=false)=>`<div class="rfq-detail-field${full?' rfq-detail-full':''}" data-rfq-field="${name}"><dt>${esc(label)}</dt><dd>${esc(present(raw)?raw:'Not provided')}</dd></div>`;
    const isModel=kind(record)==='model_capacity',isHardware=kind(record)==='physical_gpu';
    const fields=[field('model',isHardware?'GPU model / SKU':'GPU / model',record.model),field('region','Region / data location',record.region)];
    if(isModel){
      fields.push(field('inputMillion','Input volume (million tokens)',record.inputMillion),field('outputMillion','Output volume (million tokens)',record.outputMillion),field('days','Service duration (days)',record.days),field('tps','Required TPS',record.tps));
    }else{
      if(!isHardware)fields.push(field('vcpu','vCPU',record.vcpu));
      fields.push(field('count','GPU quantity',record.count));
      if(isHardware)fields.push(field('condition','Condition',record.condition));
      else fields.push(field('memory','Memory (GB / GPU)',record.memory),field('hours','Duration (hours)',record.hours));
    }
    fields.push(field('term','Market terms',record.term),field('budget',isModel?'Maximum total budget (USD)':isHardware?'Maximum unit price (USD / GPU)':'Maximum USD / GPU-hour',numeric(record.budget)?money(record.budget):null),field('start',isHardware?'Required arrival (UTC)':'Required start (UTC)',date(record.start)),field('quoteDeadline','Quotes due (UTC)',date(record.quoteDeadline)));
    if(isHardware)fields.push(field('shippingAddress','Shipping destination / address',record.shippingAddress),field('incoterms','Incoterms / shipping responsibility',record.incoterms),field('warranty','Warranty and return requirements',record.warranty));
    else if(isModel)fields.push(field('accessPolicy','Access and data policy requirements',record.accessPolicy));
    else fields.push(field('network','Network / interconnect (Optional)',record.network),field('storage','Storage capacity / type (Optional)',record.storage),field('image','Runtime / OS / image (Optional)',record.image));
    fields.push(field('sla',isHardware?'Inspection / support requirements (optional)':'SLA / support needs (optional)',record.sla),field('deliveryMethod','Delivery / access method',record.deliveryMethod),field('urgency','Urgency',record.urgency),field('visibility','Visibility',record.visibility),field('notes',isHardware?'Hardware specifications and acceptance requirements (optional)':'Workload and acceptance requirements (optional)',record.notes,true),field('shareClosingPrice','Share the awarded price with participating suppliers after the RFQ closes.',typeof record.shareClosingPrice==='boolean'?record.shareClosingPrice?'Yes':'No':null,true));
    const offer=record.selectedOffer;
    const offerSummary=offer&&typeof offer==='object'?`<section class="rfq-detail-offer"><h3>Selected resource</h3><p>${esc([offer.model,offer.country,offer.term,numeric(offer.gpuCount)?offer.gpuCount+' GPUs':''].filter(Boolean).join(' · '))}</p><dl>${field('selectedOfferId','Resource reference',offer.id)}${field('selectedOfferHourly','Listed instance price / hour',numeric(offer.instanceHourly)?money(offer.instanceHourly):null)}${field('selectedOfferUnit','Listed USD / GPU-hour',numeric(offer.perGpuHourly)?money(offer.perGpuHourly):null)}</dl></section>`:'';
    const total=maximum(record);
    return `<section class="rfq-request-details" aria-label="Submitted ${record.requestKind==='quote_request'?'quote request':'RFQ'} details">${offerSummary}<dl class="rfq-detail-grid">${fields.join('')}</dl><div class="rfq-detail-total"><span>Maximum Quote Price:</span><strong>${esc(total===null?'Not provided':money(total))}</strong></div></section>`;
  }
  const api=Object.freeze({render,maximum});
  root.OpenNEXTRfqDetails=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
