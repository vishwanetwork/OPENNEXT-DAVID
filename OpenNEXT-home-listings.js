/* Homepage market cards. Prices are dated observations, not firm OpenNEXT stock.
 * Source metadata is intentionally retained for maintenance, not rendered in UI.
 * Model: official references or exact-SKU supplier quotes, labelled separately.
 * Rental: buyer targets, not seller asks.
 * Hardware: whole-card or whole-server prices; never divide servers into GPUs.
 */
(() => {
  'use strict';
  const observedAt = '2026-10-13';
  const officialModels = [
    {id:'model-gpt-sol',name:'GPT-6.1 Sol',brand:'OpenAI',input:2,output:10,context:'272K price tier',note:'Standard tier · input up to 272K tokens.',sourceUrl:'https://developers.openai.com/api/docs/models/gpt-6.1-sol'},
    {id:'model-claude-sonnet',name:'Claude Sonnet 5.5',brand:'Anthropic',input:2,output:10,context:'1M context',note:'Standard global routing · tools billed separately.',sourceUrl:'https://platform.claude.com/docs/en/about-claude/pricing'},
    {id:'model-gemini-flash',name:'Gemini 3.8 Flash',brand:'Google',input:.75,output:3.75,context:'Paid standard',note:'Current rate through 31 Dec 2026 · thinking included.',sourceUrl:'https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash'},
    {id:'model-deepseek-flash',name:'DeepSeek V4.1 Flash',brand:'DeepSeek',input:.30,output:1.20,context:'1M context',note:'Peak-hour, non-cached rate · off-peak pricing varies.',sourceUrl:'https://api-docs.deepseek.com/quick_start/pricing/'},
    {id:'model-kimi',name:'Kimi K2.6',brand:'Kimi',input:.95,output:4,context:'256K context',note:'Non-cached input · taxes excluded.',sourceUrl:'https://platform.kimi.ai/docs/pricing/chat'},
    {id:'model-glm',name:'GLM-5.3',brand:'GLM',input:1.40,output:4.40,context:'1M context',note:'Standard USD API rate · reasoning enabled.',sourceUrl:'https://docs.z.ai/guides/overview/pricing'},
    {id:'model-gpt-luna',name:'GPT-6 Luna',brand:'OpenAI',input:.10,output:.50,context:'272K price tier',note:'Standard tier · input up to 272K tokens.',sourceUrl:'https://developers.openai.com/api/docs/models/gpt-6-luna'},
    {id:'model-claude-opus',name:'Claude Opus 5.5',brand:'Anthropic',input:4,output:20,context:'1M context',note:'Standard global routing · Fast mode not included.',sourceUrl:'https://platform.claude.com/docs/en/about-claude/pricing'},
    {id:'model-gemini-lite',sku:'gemini-3.5-flash-lite',name:'Gemini 3.5 Flash-Lite',brand:'Google',input:.30,output:2.50,context:'Text API',note:'Paid standard text · thinking included.',sourceUrl:'https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite'},
    {id:'model-deepseek-pro',name:'DeepSeek V4 Pro',brand:'DeepSeek',input:1.32,output:3.96,context:'1M context',note:'V4-Pro-0813 · peak-hour, non-cached rate.',sourceUrl:'https://api-docs.deepseek.com/quick_start/pricing/'},
    {id:'model-gpt-astra',name:'GPT-6 Astra',brand:'OpenAI',input:10,output:50,context:'272K price tier',note:'Standard tier · input up to 272K tokens.',sourceUrl:'https://developers.openai.com/api/docs/models/gpt-6-astra'},
    {id:'model-claude-haiku',name:'Claude Haiku 5.5',brand:'Anthropic',input:.10,output:.50,context:'100K price tier',note:'Input up to 100K · longer requests use a higher tier.',sourceUrl:'https://platform.claude.com/docs/en/about-claude/pricing'},
  ].map(item => ({...item,kind:'model',priceKind:'public_api_reference',sourceLabel:'Official reference',unit:'USD / 1M tokens',observedAt}));
  const supplierModels = (window.OpenNEXTModelQuotes?.list() || []).map(quote => {
    const reference = officialModels.find(item => item.sku === quote.sku);
    return {...quote,id:reference?.id || 'model-quote-'+quote.sku,kind:'model',sourceUrl:null,observedAt:quote.recordedAt};
  });
  const supplierSkus = new Set(supplierModels.map(item => item.sku));
  const models = [...supplierModels,...officialModels.filter(item => !supplierSkus.has(item.sku))];

  const rentals = [
    ['rental-h200-128','H200','128','1,024+','Worldwide',12,1.80,'Flexible specification · large-cluster requirement.'],
    ['rental-b200-128','B200','128','1,024+','Europe',12,2.30,'Frankfurt, Amsterdam or Paris · annual commitment.'],
    ['rental-h100-128','H100','128','1,024+','Worldwide',12,1.60,'HGX cluster · standard network and storage.'],
    ['rental-b200-100','B200','100','800+','Worldwide',12,3.00,'B200 / H200 alternatives · dedicated InfiniBand.'],
    ['rental-b200-64','B200','64','512+','California',12,2.80,'High-speed interconnect · dedicated bandwidth.'],
    ['rental-b200-64-128','B200','64–128','512+','US · UK',12,2.80,'400 Gb/s InfiniBand or RoCEv2 · 12–24 months.'],
    ['rental-h200-20','H200','20','160+','Flexible',12,1.40,'Annual commitment · flexible location.'],
    ['rental-b300-16','B300','16','128+','United States',12,4.40,'Texas preferred · high-bandwidth network and storage.'],
    ['rental-b200-16','B200','16','128+','United States',6,3.90,'Tier 3 data center · 6–12 month commitment.'],
    ['rental-h100-10','H100','10','80+','Flexible',12,1.25,'Annual cluster requirement · open location.'],
    ['rental-b200-4','B200','4','32+','Flexible',12,2.30,'Production inference and fine-tuning.'],
    ['rental-h200-4','H200','4','32+','European Union',6,1.85,'Six-month commitment · HGX networking.'],
    ['rental-h200-1','H200','1','8+','United States',12,2.00,'Confidential-compute requirements · dedicated IPv4.'],
    ['rental-b200-1-2','B200','1–2','8+','United States',6,3.00,'Inference workload · local NVMe and 2 TB+ RAM.'],
  ].map(([id,model,nodes,count,region,months,price,note]) => ({id,kind:'rental',model,name:`${nodes} ${model} ${nodes==='1'?'node':'nodes'}`,nodes,count,region,months,price,note,gpusPerNode:8,urgency:'Medium urgency',priceKind:'buyer_target',unit:'USD / GPU-hour',observedAt,sourceUrl:'https://packet.ai/demand'}));

  const hardware = [
    {id:'hardware-h100',name:'H100 PCIe',model:'H100',memory:'80 GB HBM3',form:'PCIe',price:39500,unit:'GPU',minimum:'1 GPU',note:'Datacenter accelerator · new card.',condition:'Brand new',sourceUrl:'https://www.serversupply.com/GPU/HBM2E/80GB/NVIDIA/900-21010-0300-030_399240.htm'},
    {id:'hardware-h200',name:'H200 NVL',model:'H200',memory:'141 GB HBM3e',form:'PCIe Gen 5',price:34500,unit:'GPU',minimum:'20 GPUs',note:'20–49 GPU price tier · condition to be confirmed.',sourceUrl:'https://gatewellusa.com/ai-compute/p/nvidia-h200-nvl'},
    {id:'hardware-a100',name:'A100 80 GB',model:'A100',memory:'80 GB ECC',form:'PCIe 4.0',price:19789,unit:'GPU',minimum:'1 GPU',note:'Datacenter accelerator · kit configuration.',sourceUrl:'https://www.newegg.com/p/N82E16814133879'},
    {id:'hardware-l40s',name:'L40S',model:'L40S',memory:'48 GB GDDR6',form:'PCIe 4.0',price:8595,unit:'GPU',minimum:'1 GPU',note:'Inference and graphics · limit 1 per customer.',sourceUrl:'https://www.newegg.com/p/N82E16888892001'},
    {id:'hardware-5090',name:'RTX 5090 TUF',model:'RTX 5090',memory:'32 GB GDDR7',form:'PCIe 5.0',price:4799.99,unit:'GPU',minimum:'1 GPU',note:'ASUS TUF Gaming · availability to be confirmed.',status:'Temporarily unavailable',sourceUrl:'https://www.bhphotovideo.com/c/product/1875530-REG/asus_tuf_rtx5090_32g_gaming_geforce_rtx_5090_tuf.html'},
    {id:'hardware-pro-maxq',name:'RTX PRO 6000 Max-Q',model:'RTX PRO 6000',memory:'96 GB GDDR7',form:'PCIe · 300 W',price:17499,unit:'GPU',minimum:'1 GPU',note:'Blackwell Max-Q · OEM configuration.',sourceUrl:'https://www.bhphotovideo.com/c/product/1895189-REG/nvidia_900_5g153_2200_000_rtx_pro_6000_blackwell.html'},
    {id:'hardware-pro-workstation',name:'RTX PRO 6000 Workstation',model:'RTX PRO 6000',memory:'96 GB GDDR7',form:'PCIe · 600 W',price:17999,unit:'GPU',minimum:'1 GPU',note:'Blackwell Workstation · OEM · limit 2 per customer.',sourceUrl:'https://www.newegg.com/p/N82E16888892012'},
    {id:'hardware-hgx-h100',name:'8× HGX H100 server',model:'H100',memory:'8 × 80 GB',form:'8U · SXM5',price:319924,unit:'server',minimum:'1 server',note:'Complete system · NVSwitch · dual EPYC.',sourceUrl:'https://configurator.exxactcorp.com/configure/TS4-193475697'},
    {id:'hardware-hgx-b200',name:'8× HGX B200 server',model:'B200',memory:'8 × 180 GB',form:'10U · SXM',price:402198.50,unit:'server',minimum:'1 server',note:'Complete system · NVSwitch · dual Xeon.',sourceUrl:'https://configurator.exxactcorp.com/configure/TS4-169219634'},
    {id:'hardware-hgx-b300',name:'8× HGX B300 server',model:'B300',memory:'8 × 288 GB',form:'8U · SXM',price:580199.40,unit:'server',minimum:'1 server',note:'Complete system · 3 TB DDR5 · NVSwitch.',sourceUrl:'https://configurator.exxactcorp.com/configure/TS4-104366747'},
  ].map(item => ({...item,kind:'hardware',priceKind:'reference_purchase',observedAt}));

  const groups = [rentals, models, hardware];
  const marketKinds = ['rental', 'model', 'hardware'];
  let selectedSide = 'supply';
  let renderedGroups = groups;
  let currentCopy = null;
  let showcase = null;
  let showcaseRequest = null;
  let curatedRfqs = [];
  let curatedRequest = null;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = value => Number(value).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
  const tokenMoney = value => Number(value).toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6});
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',pause:'<path d="M9 6v12M15 6v12"/>',play:'<path d="m9 5 10 7-10 7V5Z"/>',globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>'})[name]}</svg>`;
  const metric = (label,value) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`;
  function action(item,label,target,intent) {
    if(item.demo){
      const origin=/^(?:[a-z0-9-]+\.)*opennextlab\.ai$/i.test(window.location?.hostname||'')?'https://terminal.opennextlab.ai':'';
      const href=`${origin}/demo/?role=${intent==='buy'?'buyer':'seller'}&opportunity=${encodeURIComponent(item.id)}&intent=${intent}#terminal/market`;
      return `<a class="on-listing-cta${intent==='buy'?' on-listing-cta-buy':''}" href="${escape(href)}" data-showcase-opportunity="${escape(item.id)}" aria-label="${escape(label)}: ${escape(item.name)}"><span>${label}</span>${icon('right')}</a>`;
    }
    return `<button class="on-listing-cta${intent==='buy'?' on-listing-cta-buy':''}" type="button" data-public-action="open-workspace" data-target="${target}" data-listing-selection="${escape(item.id)}" data-listing-intent="${intent}"${item.exchange?` data-exchange-id="${escape(item.id)}" data-exchange-intent="${intent}"`:''}${item.kind==='rental'?' data-mode="rental"':item.kind==='hardware'?' data-mode="hardware"':''} aria-label="${escape(label)}: ${escape(item.name)}"><span>${label}</span>${icon('right')}</button>`;
  }

  // Homepage showcase data is never inserted into the authenticated exchange.
  // A real approved lane always takes precedence over this isolated demo feed.
  async function loadShowcase() {
    if(showcaseRequest)return showcaseRequest;
    if(typeof fetch!=='function')return null;
    const real=window.OpenNEXTExchange?.featured?.();
    if(real?.rfqs?.length&&real?.supplies?.length)return null;
    showcaseRequest=(async()=>{
      try{
        const response=await fetch('/api/demo/showcase',{credentials:'omit',headers:{Accept:'application/json'}});
        if(!response.ok)return null;
        const data=await response.json();
        if(data?.demo!==true||!data.featured)return null;
        const lane=key=>(Array.isArray(data.featured[key])?data.featured[key]:[])
          .filter(item=>item&&typeof item.id==='string'&&typeof item.model==='string'&&['rental','gpu_rental'].includes(item.kind))
          .map(item=>({...item,kind:'rental',demo:true}));
        showcase={rfqs:lane('rfqs'),supplies:lane('supplies')};
        refresh();
        return showcase;
      }catch{return null;}
    })();
    return showcaseRequest;
  }

  async function loadCuratedRfqs() {
    if(curatedRequest)return curatedRequest;
    if(typeof fetch!=='function')return null;
    curatedRequest=(async()=>{
      try{
        const response=await fetch('/api/homepage/rfqs',{credentials:'omit',headers:{Accept:'application/json'}});
        if(!response.ok)return null;
        const data=await response.json();
        if(!Array.isArray(data?.rfqs))return null;
        curatedRfqs=data.rfqs.filter(item=>item?.sourceKind==='customer_requirement'&&item.kind==='rental'&&item.side==='demand'&&typeof item.id==='string'&&typeof item.title==='string'&&Array.isArray(item.specifications)).map(item=>({...item,curated:true,name:item.title}));
        refresh();
        return curatedRfqs;
      }catch{return null;}
    })();
    return curatedRequest;
  }

  function rowsFor(kind, side) {
    const key=side==='demand'?'rfqs':'supplies';
    const exchange=window.OpenNEXTExchange;
    const published=typeof exchange?.listPublic==='function'?(kind==='rental'?(exchange.featured?.()?.[key]||[]):exchange.listPublic(kind,side)||[]):[];
    const mapExchange=item=>({...item,exchange:true,side,name:item.title||item.model,note:item.description||'',region:item.region||'Flexible region',input:item.input??item.price,output:item.output??item.outputPrice});
    if(kind==='rental'){
      const requirements=side==='demand'?curatedRfqs:[];
      const listings=(published.length?published:(showcase?.[key]||[])).filter(item=>!requirements.some(row=>row.id===item.id)).map(mapExchange);
      const combined=[];
      for(let i=0;i<Math.max(requirements.length,listings.length);i++){
        if(requirements[i])combined.push(requirements[i]);
        if(listings[i])combined.push(listings[i]);
      }
      return combined;
    }
    if(published.length)return published.map(mapExchange);
    // Existing dated catalog quotes are references, never fabricated exchange inventory.
    return side==='supply'?groups[marketKinds.indexOf(kind)]:[];
  }

  const urgencyBadge = urgency => /^(high(?:[\s_-]+urgency)?|urgent)$/i.test(String(urgency||'').trim()) ? '<span class="on-listing-urgency">High Urgency</span>' : '';

  function exchangeCard(item,index,total) {
    const demand=item.side==='demand', isModel=item.kind==='model', isHardware=item.kind==='hardware';
    const unit=isModel?'1M tokens':isHardware?'GPU':'GPU-hour';
    const specifications=isModel
      ? metric('Model',item.model)+metric('Region',item.region)+metric('Allocation',item.count || 'On inquiry')+metric('Term',item.term || (item.hours?`${item.hours} hours`:'Confirm in quote'))
      : metric('GPU model',item.model)+metric('Quantity',`${item.count || 'On inquiry'}${item.count?' GPUs':''}`)+metric(isHardware?'Delivery':'Usage window',item.hours?`${item.hours} hours`:item.term || 'Confirm in quote')+metric('Region',item.region);
    const prices=isModel && !demand && Number.isFinite(Number(item.output))
      ? `<div class="on-listing-token-prices"><div><span>Input / 1M tokens</span><strong>${tokenMoney(item.input)}</strong></div><div><span>Output / 1M tokens</span><strong>${tokenMoney(item.output)}</strong></div></div>`
      : `<div class="on-listing-single-price"><span>${escape(item.priceLabel || (demand?'Buyer target price':'Supplier asking price'))}</span><div><strong>${Number.isFinite(Number(item.price))?money(item.price):'On inquiry'}</strong><small>${/total|budget/i.test(item.priceLabel || '')?'total':'/ '+unit}</small></div></div>`;
    const label=demand?'Offer capacity':'Buy capacity';
    return `<article class="on-listing-card" data-listing-id="${escape(item.id)}" data-listing-index="${index}" data-listing-side="${item.side}" role="group" aria-roledescription="slide" aria-label="${index+1} of ${total}: ${escape(item.name)}"><div class="on-listing-card-top"><span class="on-listing-kind"><i></i>${demand?'Buyer RFQ':'Supplier offer'}</span>${demand?urgencyBadge(item.urgency):''}</div><h3>${escape(item.name)}</h3><div class="on-listing-location">${icon('globe')}<span>${escape(item.region)}</span></div><p class="on-listing-description">${escape(item.note)}</p><dl class="on-listing-specs">${specifications}</dl><div class="on-listing-pricing">${prices}<p>${demand?'Respond to this requirement with your offer.':'Confirm availability and delivery before purchase.'}</p></div>${action(item,label,demand?'supply':isModel?'models':'rfq',demand?'offer':'buy')}</article>`;
  }

  function card(item,index,items) {
    if(item.curated){
      const specs=metric('Quantity',item.quantityLabel)+metric('Rental term',item.termLabel)+metric('Deployment',item.deliveryLabel)+metric('Payment','Flexible with supplier');
      return `<article class="on-listing-card on-listing-curated" data-listing-id="${escape(item.id)}" data-listing-index="${index}" data-listing-side="demand" role="group" aria-roledescription="slide" aria-label="${index+1} of ${items.length}: ${escape(item.title)}"><div class="on-listing-card-top"><span class="on-listing-kind"><i></i>Buyer RFQ</span></div><h3>${escape(item.title)}</h3><div class="on-listing-location">${icon('globe')}<span>${escape(item.region)}</span></div><p class="on-listing-description">${escape(item.description)}</p><dl class="on-listing-specs">${specs}</dl><div class="on-listing-pricing"><div class="on-listing-single-price"><span>Supplier quotes invited</span><strong>Price on request</strong></div><p>Submit a proposal against the complete requirements.</p></div><div class="on-listing-actions"><button class="on-listing-details" type="button" data-curated-rfq-details="${escape(item.id)}" aria-label="View requirements: ${escape(item.title)}">View requirements</button><button class="on-listing-cta" type="button" data-curated-rfq-offer="${escape(item.id)}" aria-label="Offer capacity: ${escape(item.title)}"><span>Offer capacity</span>${icon('right')}</button></div></article>`;
    }
    if(item.exchange)return exchangeCard(item,index,items.length);
    const isModel = item.kind==='model', isRental = item.kind==='rental';
    const tag = isModel?item.sourceLabel:isRental?'Buyer demand':item.unit==='server'?'Complete system':'Physical GPU';
    const place = isModel?item.brand:isRental?item.region:'NVIDIA';
    const tier = item.priceKind==='supplier_quote' ? item.context.replace('Not specified — confirm in quote','Confirm in quote').replace('context — threshold requires quote confirmation','· confirm threshold') : item.context;
    const specs = isModel?metric('Context / tier',tier)+metric('Billing','Per 1M tokens'):isRental?metric('Total GPUs',item.count)+metric('GPUs / node',8)+metric('Nodes',item.nodes)+metric('Minimum term',item.months+' months'):metric('Memory',item.memory)+metric('Form factor',item.form)+metric('Price unit','Per '+item.unit)+metric('Min. order',item.minimum);
    const prices = isModel?`<div class="on-listing-token-prices"><div><span>Input / 1M tokens</span><strong>${tokenMoney(item.input)}</strong></div><div><span>Output / 1M tokens</span><strong>${tokenMoney(item.output)}</strong></div></div>${Number.isFinite(item.cachedInput)?`<div class="on-listing-cached-price" title="Cache billing semantics require quote confirmation"><span>Cache / 1M tokens</span><strong>${tokenMoney(item.cachedInput)}</strong></div>`:''}`:`<div class="on-listing-single-price"><span>${isRental?'Buyer target price':'Reference purchase price'}</span><div><strong>${money(item.price)}</strong><small>${isRental?'/ GPU-hour':'/ '+item.unit}</small></div></div>`;
    const actions = action(item,isRental?'Offer capacity':'Buy capacity',isRental?'supply':isModel?'models':'rfq',isRental?'offer':'buy');
    const marker=isRental?urgencyBadge(item.urgency):'<span class="on-listing-sample">Reference</span>';
    return `<article class="on-listing-card" data-listing-id="${item.id}" data-listing-index="${index}" data-listing-side="${isRental?'demand':'supply'}" role="group" aria-roledescription="slide" aria-label="${index+1} of ${items.length}: ${escape(item.name)}"><div class="on-listing-card-top"><span class="on-listing-kind"><i></i>${tag}</span>${marker}</div><h3>${escape(item.name)}</h3><div class="on-listing-location">${icon('globe')}<span>${escape(place)}</span></div><p class="on-listing-description">${escape(item.note)}</p><dl class="on-listing-specs">${specs}</dl><div class="on-listing-pricing">${prices}<p>${isModel?(item.priceKind==='supplier_quote'?'Supplier quote · final terms confirmed on inquiry':'Official reference · standard non-cached rate'):isRental?'Buyer budget · availability requires a separate quote':item.status||'Price and delivery subject to quote'}</p></div>${actions}</article>`;
  }

  const emptyCards = () => `<div class="on-listing-empty"><h3>${selectedSide==='supply'?'No published offers in this market yet.':'No open requirements in this market yet.'}</h3><p>${selectedSide==='supply'?'Tell suppliers what you need and invite a quote.':'Publish your capacity so buyers can find you.'}</p><button type="button" class="on-button on-button-outline" data-public-action="open-workspace" data-target="${selectedSide==='supply'?'rfq':'supply'}">${selectedSide==='supply'?'Post an RFQ':'List capacity'}</button></div>`;

  const disclosureFor=items=>items.some(item=>item.demo)?items.some(item=>item.curated)?'Includes demo listings · Availability, pricing and delivery confirmed by quote.':'Demo marketplace · Test data · No real transactions.':items.some(item=>item.curated)?'Buyer requirements · Pricing, capacity and delivery confirmed in supplier quotes.':`${items.some(item=>item.sample)?'Preview marketplace · ':''}USD · Final availability, fees and delivery confirmed by quote.`;

  function render(copy) {
    currentCopy=copy;
    renderedGroups=marketKinds.map(kind=>rowsFor(kind,selectedSide));
    const names = [copy.rental,copy.models,copy.physical];
    const disclosure=disclosureFor(renderedGroups[0]);
    return `<div class="public-listing-preview on-listing-carousel" role="region" aria-roledescription="carousel" aria-label="Capacity market listings"><div class="on-listing-sides"><div role="group" aria-label="Choose your side of the market"><button type="button" data-listing-side-filter="supply" aria-pressed="${selectedSide==='supply'}">Buy capacity<span>Browse supplier offers</span></button><button type="button" data-listing-side-filter="demand" aria-pressed="${selectedSide==='demand'}">Offer capacity<span>Respond to buyer RFQs</span></button></div><p>One workspace.<br>Both sides of the market.</p></div>${names.map((name,i)=>`<input class="public-listing-radio" type="radio" name="public-listings" id="public-listings-${i}"${i===0?' checked':''}><label class="public-listing-tab public-listing-tab-${i}" for="public-listings-${i}">${escape(name)}</label>`).join('')}<div class="on-listing-controls"><span class="on-listing-position" aria-hidden="true">${renderedGroups[0].length?`01 — ${String(Math.min(5,renderedGroups[0].length)).padStart(2,'0')} / ${renderedGroups[0].length}`:'No listings'}</span><button type="button" data-listing-move="-1" aria-label="Previous listing">${icon('left')}</button><button type="button" data-listing-toggle aria-label="Pause listing carousel" aria-pressed="false">${icon('pause')}</button><button type="button" data-listing-move="1" aria-label="Next listing">${icon('right')}</button></div><div class="public-listing-panels">${renderedGroups.map((items,i)=>`<div class="public-listing-panel public-listing-panel-${i}" role="region" aria-label="${escape(names[i])}" data-listing-panel="${i}"><div class="on-listing-viewport"><div class="on-listing-track">${items.map(card).join('')}</div>${items.length?'':emptyCards()}</div></div>`).join('')}</div><div class="on-listing-under"><span>${disclosure}</span><span class="on-listing-motion-hint">Hover to pause</span></div><span class="on-listing-announcement" role="status" aria-live="polite"></span></div>`;
  }

  let component = null;
  let timer = null;
  let visibilityObserver = null;
  let resizeObserver = null;
  let states = [];
  let inView = false;
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const active = () => states[Number(component?.querySelector('.public-listing-radio:checked')?.id.split('-').pop()||0)];

  function visibleCount() {
    return Math.max(1,Number(getComputedStyle(component).getPropertyValue('--on-visible-cards'))||5);
  }
  function update(manual=false) {
    if (!component) return;
    const state = active(), count = visibleCount();
    if (!state) return;
    component.querySelector('.on-listing-under>span').textContent=disclosureFor(renderedGroups[Number(state.panel.dataset.listingPanel)]||[]);
    state.track.style.setProperty('--on-card-columns',Math.min(count,Math.max(1,state.track.children.length)));
    const cards = [...state.track.children];
    cards.forEach((item,i)=>{item.inert=i>=count;item.setAttribute('aria-hidden',String(i>=count));});
    const start = cards.length?Number(cards[0].dataset.listingIndex)+1:0;
    const end = cards.length?(start+Math.min(count,cards.length)-2)%cards.length+1:0;
    component.querySelector('.on-listing-position').textContent=cards.length?`${String(start).padStart(2,'0')} — ${String(end).padStart(2,'0')} / ${cards.length}`:'No listings';
    if (manual) component.querySelector('.on-listing-announcement').textContent=cards.length?`Showing ${Math.min(count,cards.length)} listings, starting with ${cards[0].querySelector('h3').textContent}.`:'No listings for this selection.';
    component.querySelectorAll('[data-listing-move],[data-listing-toggle]').forEach(button=>{button.disabled=cards.length<=count;});
    const toggle = component.querySelector('[data-listing-toggle]');
    toggle.setAttribute('aria-label',`${paused?'Play':'Pause'} listing carousel`);
    toggle.setAttribute('aria-pressed',String(paused));
    toggle.innerHTML=icon(paused?'play':'pause');
    component.dataset.paused=String(paused);
  }

  function step(direction=1,manual=false) {
    const state=active();
    if (!state || state.busy || state.track.children.length<=visibleCount()) return;
    const track=state.track, first=track.firstElementChild;
    const distance=first.getBoundingClientRect().width+parseFloat(getComputedStyle(track).gap||'0');
    if (!distance) return;
    state.busy=true;
    state.finish=() => {
      clearTimeout(state.fallback);
      track.removeEventListener('transitionend',ended);
      if (direction>0) track.append(track.firstElementChild);
      track.style.transition='none';
      track.style.transform='translate3d(0,0,0)';
      state.busy=false;
      state.finish=null;
      track.classList.remove('is-moving');
      update(manual);
    };
    const ended=event=>{if(event.target===track&&event.propertyName==='transform')state.finish?.();};
    track.addEventListener('transitionend',ended);
    track.classList.add('is-moving');
    if (direction<0) {
      track.prepend(track.lastElementChild);
      track.style.transition='none';
      track.style.transform=`translate3d(-${distance}px,0,0)`;
      void track.offsetWidth;
    }
    track.style.transition=reducedMotion.matches?'none':'transform 580ms cubic-bezier(.22,.68,.2,1)';
    track.style.transform=direction>0?`translate3d(-${distance}px,0,0)`:'translate3d(0,0,0)';
    state.fallback=setTimeout(()=>state.finish?.(),reducedMotion.matches?0:660);
  }

  function destroy() {
    clearInterval(timer);
    timer=null;
    visibilityObserver?.disconnect();
    resizeObserver?.disconnect();
    states.forEach(state=>{clearTimeout(state.fallback);});
    states=[];
    component=null;
    inView=false;
  }
  function refresh() {
    if(!component || !currentCopy)return;
    const tab=Number(component.querySelector('.public-listing-radio:checked')?.id.split('-').pop()||0);
    const previous=component;
    const focused=document.activeElement;
    const focusAttributes=['id','data-listing-side-filter','data-listing-move','data-listing-toggle','data-listing-selection','data-listing-intent','data-showcase-opportunity','data-curated-rfq-details','data-curated-rfq-offer'];
    const restoreFocus=previous.contains(focused)?{
      cardId:focused.closest('.on-listing-card')?.dataset.listingId,
      tag:focused.tagName,
      attributes:focusAttributes.filter(name=>focused.hasAttribute(name)).map(name=>[name,focused.getAttribute(name)]),
    }:null;
    const markup=render(currentCopy);
    destroy();
    previous.outerHTML=markup;
    const next=document.querySelector('.on-listing-carousel');
    const selected=next?.querySelector(`#public-listings-${tab}`);
    if(selected)selected.checked=true;
    mount();
    if(!restoreFocus||!restoreFocus.attributes.length||!next)return;
    const state=active();
    const card=restoreFocus.cardId&&[...(state?.track.children||[])].find(item=>item.dataset.listingId===restoreFocus.cardId);
    if(restoreFocus.cardId&&!card)return;
    if(card&&[...state.track.children].indexOf(card)>=visibleCount()){
      while(state.track.firstElementChild!==card)state.track.append(state.track.firstElementChild);
      update();
    }
    const target=[...(card||next).querySelectorAll('a,button,input,select,textarea,[tabindex]')].find(item=>item.tagName===restoreFocus.tag&&restoreFocus.attributes.every(([name,value])=>item.getAttribute(name)===value));
    if(target&&!target.disabled)target.focus({preventScroll:true});
  }
  function selectSide(side) {
    if(!['supply','demand'].includes(side))return;
    selectedSide=side;
    refresh();
  }
  function mount() {
    const next=document.querySelector('.on-listing-carousel');
    if (next===component) return;
    destroy();
    if (!next) return;
    component=next;
    states=[...next.querySelectorAll('[data-listing-panel]')].map(panel=>({panel,track:panel.querySelector('.on-listing-track'),busy:false}));
    update();
    component.addEventListener('change',event=>{
      if(!event.target.matches('.public-listing-radio'))return;
      states.forEach(state=>state.finish?.());
      update(true);
    });
    component.addEventListener('click',event=>{
      const inquiry=event.target.closest('[data-curated-rfq-details],[data-curated-rfq-offer]');
      if(inquiry){
        event.preventDefault();
        const item=curatedRfqs.find(row=>row.id===(inquiry.dataset.curatedRfqDetails||inquiry.dataset.curatedRfqOffer));
        if(item)window.OpenNEXTCuratedInquiries?.[inquiry.hasAttribute('data-curated-rfq-details')?'showDetails':'offer'](item);
        return;
      }
      const side=event.target.closest('[data-listing-side-filter]');
      if(side){event.preventDefault();selectSide(side.dataset.listingSideFilter);component?.querySelector(`[data-listing-side-filter="${selectedSide}"]`)?.focus();return;}
      const move=event.target.closest('[data-listing-move]'),toggle=event.target.closest('[data-listing-toggle]');
      if(move){event.preventDefault();step(Number(move.dataset.listingMove),true);}
      if(toggle){event.preventDefault();paused=!paused;update();}
    });
    component.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight'].includes(event.key)||event.target.matches('.public-listing-radio'))return;
      event.preventDefault();step(event.key==='ArrowLeft'?-1:1,true);
    });
    let startX=null,swipedUntil=0;
    const viewport=component.querySelector('.public-listing-panels');
    viewport.addEventListener('pointerdown',event=>{if(event.pointerType==='touch')startX=event.clientX;});
    viewport.addEventListener('pointerup',event=>{
      if(startX===null)return;
      const delta=event.clientX-startX;startX=null;
      if(Math.abs(delta)>45){swipedUntil=performance.now()+350;step(delta<0?1:-1,true);}
    });
    viewport.addEventListener('pointercancel',()=>{startX=null;});
    viewport.addEventListener('click',event=>{if(performance.now()<swipedUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
    visibilityObserver=new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;},{threshold:.15});
    visibilityObserver.observe(viewport);
    resizeObserver=new ResizeObserver(()=>{states.forEach(state=>state.finish?.());update();});
    resizeObserver.observe(viewport);
    timer=setInterval(()=>{
      if(!component?.isConnected){destroy();return;}
      if(paused||!inView||document.hidden||component.matches(':hover')||component.querySelector('.on-listing-card:focus-within'))return;
      step(1);
    },4600);
    void loadShowcase();
    void loadCuratedRfqs();
  }
  reducedMotion.addEventListener('change',event=>{if(event.matches){paused=true;update();}});
  new MutationObserver(mount).observe(document.getElementById('app'),{childList:true});
  window.addEventListener?.('opennext:exchange',refresh);
  window.OpenNEXTListings={render,get:id=>renderedGroups.flat().find(item=>item.id===id)||curatedRfqs.find(item=>item.id===id)||window.OpenNEXTExchange?.get(id)||groups.flat().find(item=>item.id===id),mount,step,destroy,refresh,selectSide,loadShowcase,loadCuratedRfqs,groups};
})();
