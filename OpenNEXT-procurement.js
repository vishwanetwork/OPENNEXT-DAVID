(function () {
  'use strict';
  const X=window.OpenNEXTExchange;
  const date=v=>v?new Date(v).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC':'To be confirmed';
  const isoInput=v=>new Date(v||Date.now()+86400000).toISOString().slice(0,16);
  const model=r=>X.kindOf(r)==='model_capacity';
  const hardware=r=>X.kindOf(r)==='physical_gpu';
  const unit=r=>model(r)?' total':hardware(r)?' / GPU':' / GPU-hour';
  const volume=r=>model(r)?`${r.inputMillion||0}M input / ${r.outputMillion||0}M output`:hardware(r)?`${r.count} GPUs · physical delivery`:`${r.count} GPU · ${r.hours} hours`;
  const deliveryTime=(minutes,r)=>hardware(r)?`${Math.ceil(Number(minutes)/1440)} days`:`${minutes} min`;
  const btn=(label,act,id='',extra='',primary=false)=>`<button type="button" class="btn ${primary?'':'secondary'} small" data-act="${act}" data-id="${id}" ${extra}>${label}</button>`;
  const tag=s=>`<span class="tag">${s}</span>`;
  function field(c,label,value){return `<div><small>${c.esc(label)}</small><strong>${c.esc(value??'To be confirmed')}</strong></div>`;}
  function card(c,r){
   return `<tr data-search-item="${c.esc([r.id,r.title,r.model,r.project,r.region,r.notes,r.client].join(' '))}"><td><button class="detail-link" data-act="view-rfq" data-id="${r.id}"><strong>${c.esc(r.title)}</strong></button><small class="proc-sub">${r.id} · ${c.esc(r.project||r.client||'No project label')}</small></td><td>${c.esc(r.model)}<small class="proc-sub">${c.esc(volume(r))} · ${c.esc(r.region)}</small></td><td>${c.money(r.budget)}${unit(r)}<small class="proc-sub">${hardware(r)?'Arrival by':'Start'} ${date(r.start)}<br>Quotes by ${date(r.quoteDeadline)}</small></td><td>${tag(c.esc(r.status))}<small class="proc-sub">${(r.quotes||[]).filter(q=>q.status==='Pending').length} pending quotes</small></td><td>${btn(r.status==='Quoted'?'Review quotes':'View details','view-rfq',r.id)}</td></tr>`;
  }
  function page(c){const {S}=c,rows=S.rfqs.filter(r=>!S.rfqFilter||S.rfqFilter==='All'||r.status===S.rfqFilter);return `<div class="page-content"><div class="page-heading"><div><h1>${S.role==='Broker'?'My RFQs & mandates':'My RFQs'}</h1><p>Keep requirements, competing quotes, decisions and delivery together.</p></div>${btn('Post RFQ','new-rfq','','',true)}</div><div class="stat-grid">${[['Open requirements',S.rfqs.filter(r=>r.status==='Open').length],['Quotes to review',S.rfqs.reduce((n,r)=>n+(r.quotes||[]).filter(q=>q.status==='Pending').length,0)],['Orders in progress',S.orders.filter(o=>!['Completed','Cancelled'].includes(o.status)).length]].map(([t,n])=>`<div class="stat-card"><span>${t}</span><strong>${n}</strong></div>`).join('')}</div><div class="panel"><div class="toolbar"><input class="field" data-search="rfqs" placeholder="Search requirement, ID, project, model, region or notes…"><select class="field proc-filter" data-proc-filter="rfqFilter" aria-label="RFQ status">${['All','Open','Quoted','Confirmed','Provisioning','Active','Completed','Cancelled'].map(v=>`<option ${v===(S.rfqFilter||'All')?'selected':''}>${v}</option>`).join('')}</select>${btn('Export CSV','export','','data-value="rfqs"')}</div><div class="table-scroll"><table class="data-table"><thead><tr><th>Requirement / project</th><th>Specification</th><th>Budget / schedule</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(r=>card(c,r)).join('')||'<tr><td colspan="5">No matching requirements.</td></tr>'}</tbody></table></div></div>${notifications(c)}</div>`;}
  function notifications(c){const items=c.S.notifications.filter(n=>n.role===c.S.role||(c.S.role==='Broker'&&['Buyer','Seller'].includes(n.role))).slice(0,15);return `<section class="panel"><div class="row spread"><h2>Workspace notifications</h2>${items.some(n=>!n.read)?btn('Mark all read','proc-read'):''}</div>${items.map(n=>`<article class="proc-notice ${n.read?'read':''}"><div><strong>${c.esc(n.subject)}</strong><small>${date(n.created)}${n.supplier?' · '+c.esc(n.supplier):''}</small><p>${c.esc(n.message)}</p></div>${n.orderId?btn('Order details','bill-order',n.orderId):''}</article>`).join('')||'<p class="form-note">Quote, payment and delivery updates will appear here.</p>'}<p class="form-note">Local workspace notifications. External email delivery is not connected.</p></section>`;}
  function listingTable(c){
   const supplies=X.matches(c.S,'supply').slice(0,5),rows=[...supplies,...X.matches(c.S,'demand').slice(0,5)];
   const comparable=key=>{const values=supplies.map(r=>Number(r[key])).filter(n=>Number.isFinite(n)&&n>0);return new Set(values).size>1?Math.min(...values):null;};
   const bestPrice=comparable('price'),bestDelivery=comparable('delivery');
   return `<div class="compare proc-market-listings"><div class="compare-title"><span>Same-model comparison · ${c.esc(c.S.model)}</span><small>Supply & buyer RFQs</small></div><div class="toolbar"><input class="field" data-search="listings" placeholder="Search suppliers, buyers or terms…"><small class="form-note">Preview listings · confirm terms before trading</small></div><div class="table-scroll"><table><thead><tr><th>Side / counterparty</th><th>Region</th><th>$/GPU-hour</th><th>Quantity / term</th><th>Delivery</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr data-search-item="${c.esc(r.provider+' '+r.region+' '+r.term)}"><td>${tag(r.side==='supply'?'Supply':'Buy RFQ')}<span class="supplier-name">${c.esc(r.provider)}</span></td><td>${c.esc(r.region)}</td><td ${r.side==='supply'&&r.price===bestPrice?'class="best"':''}>${c.money(r.price)}</td><td>${r.count} GPU · ${r.hours}h<small class="proc-sub">${c.esc(r.term)}</small></td><td ${r.side==='supply'&&r.delivery===bestDelivery?'class="best"':''}>${r.side==='supply'?r.delivery+' min':'Submit a window'}</td><td>${r.side==='supply'?`<button class="icon-btn" data-act="save" data-id="${c.esc(r.id)}" aria-label="Save ${c.esc(r.model+' from '+r.provider)}">☆</button> <button class="icon-btn" data-act="cart" data-id="${c.esc(r.id)}" aria-label="Add ${c.esc(r.model+' from '+r.provider)} to quote cart">+</button> `:''}${btn('Details','proc-listing',r.id)} ${btn(r.side==='supply'?'Buy capacity':'Offer capacity','proc-opportunity',r.id,`data-intent="${r.side==='supply'?'buy':'offer'}"`,true)}</td></tr>`).join('')||'<tr><td colspan="6">No listings match this configuration. Post an RFQ to specify your requirements.</td></tr>'}</tbody></table></div></div>`;
  }
  function matches(c,kind){const S=c.S,rows=kind==='best'?X.matches(S,S.role==='Seller'?'demand':'supply').slice(0,5):recent(S);const offset=rows.length?Number(S.matchOffset||0)%rows.length:0,rotated=[...rows.slice(offset),...rows.slice(0,offset)];const cards=rotated.map((r,i)=>`<article class="match-card proc-match" data-resource="${r.id}"><div class="match-top"><strong>${c.esc(r.model)}</strong><strong>${c.money(r.price)}<small> /GPU-hr</small></strong></div><p>${c.esc(r.provider)} · ${c.esc(r.region)}<br>${r.count} GPU · ${c.esc(r.term)} · ${r.hours}h</p><div class="match-bottom"><span class="fit">${kind==='best'?(r.side==='demand'?'Buyer requirement':'Supplier allocation'):'Settled '+date(r.settledAt)}</span>${kind==='best'?btn(r.side==='demand'?'Offer':'Request quote','proc-opportunity',r.id,`data-intent="${r.side==='demand'?'offer':'buy'}"`):btn('Details','proc-settlement',r.id)}</div></article>`).join('');return `<section class="matches"><div class="matches-head"><div><h3>${kind==='best'?'Best Matches':'Recent Settled'}</h3><small>${c.esc(S.model)} · ${c.esc(S.region)}</small></div><button class="icon-btn" data-act="refresh-matches" aria-label="Refresh ${kind} matches">↻</button></div><div class="match-viewport proc-match-viewport" data-scroll="${kind}" tabindex="0" aria-label="${kind==='best'?'Matching capacity':'Settled trades'}; hover or focus to pause"><div class="match-cycle">${cards||'<p class="form-note">No matching records.</p>'}</div>${rows.length>3?`<div class="match-copy" aria-hidden="true" inert>${cards}</div>`:''}</div><div class="match-foot"><span>${rows.length} ${kind==='best'?'listings':'settlements'}${rows.some(r=>r.sample)?' · preview records':''}</span><span>Hover to pause</span></div></section>`;}
  const settlements=new Map();
  function recent(S){const actual=S.orders.filter(o=>o.status==='Completed'&&o.model===S.model&&(S.region==='All regions'||X.regionCode(S.region)===X.regionCode(o.region))).map(o=>({...o,price:o.unitPrice,settledAt:o.completedAt||o.createdAt}));const samples=X.matches(S,'supply').slice(0,5).map((r,i)=>({...r,id:'SETTLED-'+r.id,price:X.round(r.price*(.98+i*.003)),settledAt:new Date(Date.now()-(i+1)*43*60000).toISOString(),sample:true}));const rows=[...actual,...samples].slice(0,5);rows.forEach(r=>settlements.set(r.id,r));return rows;}
  function requirementFields(c,r){
   const common=[['Project / purpose',r.project||r.title],['Client / procurement owner',r.client||c.S.identity.company||c.S.identity.name],['GPU / model',r.model],['Capacity',volume(r)],['Region / data location',r.region],['Commercial terms',r.term||'Model capacity'],[hardware(r)?'Required arrival':'Start time',date(r.start)],['Budget',c.money(r.budget)+unit(r)+(model(r)?'':' · '+c.money(X.totalFor(r,r.budget))+' maximum')],['Quote deadline',date(r.quoteDeadline)],['Delivery method',r.deliveryMethod||X.deliveryMethod(r)],['Urgency',r.urgency],['Visibility',r.visibility]];
   const specific=hardware(r)?[['Condition',r.condition||'Brand new'],['Shipping address / destination',r.shippingAddress||'Confirm securely before shipment'],['Incoterms',r.incoterms||'DAP · confirm fees'],['Warranty',r.warranty||'Confirm in quotation']]:model(r)?[['Exact model / tier SKU',r.sku||'Confirm in quotation'],['Duration',r.days+' days'],['Required throughput',(r.tps||'To confirm')+' TPS'],['Access / data policy',r.accessPolicy||'Confirm authorization, retention and region']]:[['Duration',r.hours+' hours'],['Network / storage',`${r.network||'Confirm with supplier'} / ${r.storage||'Confirm with supplier'}`],['Image / runtime',r.image||'Confirm with supplier']];
   return `<div class="details-grid proc-details">${[...common,...specific,['SLA / support',r.sla||'Confirm with supplier']].map(([label,value])=>field(c,label,value)).join('')}</div><h3>Requirement notes</h3><p class="proc-notes">${c.esc(r.notes||'No additional requirements.')}</p>`;
  }
  function quoteRows(c,r){
   const quotes=(r.quotes||[]).filter(q=>q.status==='Pending'),expired=q=>!q.validUntil||new Date(q.validUntil)<=new Date();
   const tokenPrice=v=>'$'+Number(v).toLocaleString('en-US',{maximumFractionDigits:6});
   return `<div class="row spread"><h3>${r.originSupply?'Selected supplier quotation':'Competing supplier quotes'}</h3><span class="form-note">${quotes.length} to review</span></div>${quotes.map(q=>`<article class="proc-quote"><div class="row spread"><div><strong>${c.esc(q.provider)}</strong><small class="proc-sub">${q.id}${q.sample?' · Preview quote':''}</small></div><strong>${c.money(q.price)}${unit(r)}</strong></div>${model(r)&&q.input!=null&&q.output!=null?`<p class="form-note">Input ${tokenPrice(q.input)} / 1M tokens · Output ${tokenPrice(q.output)} / 1M tokens</p>`:''}<div class="proc-quote-meta"><span>Total ${c.money(q.total)}</span><span>Delivery ${deliveryTime(q.delivery,r)}</span><span>${hardware(r)?'Warranty':'SLA'} ${c.esc(q.sla||'Confirm')}</span><span>${expired(q)?'Expired':'Valid until '+date(q.validUntil)}</span></div><p class="form-note">${c.esc(q.deliveryMethod||r.deliveryMethod)} · ${c.esc(q.notes||'Terms attached to the quotation.')}</p><div class="row">${btn('Details','proc-quote-details',r.id,`data-quote="${q.id}"`)}<span class="gap"></span>${btn('Reject','proc-reject',r.id,`data-quote="${q.id}"`)}<button class="btn small" data-act="proc-accept-review" data-id="${r.id}" data-quote="${q.id}" ${expired(q)?'disabled':''}>Accept</button></div></article>`).join('')||'<p class="form-note">No pending quotes. Rejected quotes remain in the audit trail.</p>'}`;
  }
  function record(c,r){if(!r)return '<p>Requirement not found.</p>';const order=c.S.orders.find(o=>o.id===r.orderId);return `<div class="row spread"><span class="form-note">${r.id}${r.sample?' · Preview requirement':''}</span>${tag(c.esc(r.status))}</div>${requirementFields(c,r)}${['Open','Quoted'].includes(r.status)?quoteRows(c,r):''}${order?`<section class="proc-award"><h3>Selected supplier · ${c.esc(order.provider)}</h3><p>${order.id} · ${c.money(order.total)} · ${c.esc(order.status)}</p><div class="row">${btn('Order details','bill-order',order.id)}${order.paymentStatus!=='Paid'?btn('Review & pay','proc-payment',order.id,'',true):order.status==='Paid'?btn('Confirm delivery details','proc-delivery',order.id,'',true):order.status==='Provisioning'?btn('Verify delivery','proc-verify',order.id,'',true):order.status==='Active'?btn('Manage service','proc-manage',order.id,'',true):btn('View completed order','bill-order',order.id)}</div></section>`:''}<div class="modal-footer">${['Open','Quoted'].includes(r.status)?`${btn('Edit requirement','proc-edit',r.id)}${btn('Load preview supplier quotes','proc-sample-quotes',r.id)}${btn('Close RFQ','proc-close',r.id)}`:''}</div><details class="proc-audit"><summary>Decision history & rejected quotes</summary>${(r.audit||[]).map(a=>`<p>${date(a.at)} · ${c.esc(a.event)}</p>`).join('')||'<p>No decisions yet.</p>'}${(r.quotes||[]).filter(q=>q.status!=='Pending').map(q=>`<p>${c.esc(q.provider)} · ${c.esc(q.status)} · ${c.money(q.price)}</p>`).join('')}</details>`;}
  function input(c,label,name,value,type='text',attributes=''){return `<div><label class="form-label" for="proc-${name}">${label}</label><input class="field" id="proc-${name}" name="${name}" type="${type}" value="${c.esc(value??'')}" ${attributes}></div>`;}
  function form(c,r={},editing=false){
   const isModel=model(r),isHardware=hardware(r),S=c.S,chosen=X.get(r.originSupply);
   const fields=[
   input(c,'Requirement name','title',r.title||S.model+' capacity request','text','required maxlength="140"'),
   input(c,S.role==='Broker'?'Client / mandate reference':'Project / cost centre','project',r.project||'','text','required maxlength="120"'),
   input(c,'GPU / model','model',r.model||S.model,'text',`required ${r.originSupply?'readonly':''}`),
   input(c,'Region / data location','region',r.region||S.region,'text','required'),
   isModel?input(c,'Input volume (million tokens)','inputMillion',r.inputMillion??1,'number','min="0" step="0.000001" required')+input(c,'Output volume (million tokens)','outputMillion',r.outputMillion??1,'number','min="0" step="0.000001" required')+input(c,'Service duration (days)','days',r.days||30,'number','min="1" max="1095" required')+input(c,'Required TPS','tps',r.tps||'','number','min="1"'):input(c,'GPU quantity','count',r.count||S.count||8,'number','min="1" max="4096" step="1" required')+(isHardware?input(c,'Condition','condition',r.condition||'Brand new','text','required'):input(c,'Duration (hours)','hours',r.hours||72,'number','min="1" max="26280" required')),
   isHardware?'<input type="hidden" name="term" value="Physical GPU">':`<div><label class="form-label">Market terms</label><select class="field" name="term">${(isModel?['Authorized API access','Native allocation','Hosted inference']:['Spot','On-demand','Reserved']).map(v=>`<option ${v===(r.term||S.term)?'selected':''}>${v}</option>`).join('')}</select></div>`,
   input(c,isModel?'Maximum total budget (USD)':isHardware?'Maximum unit price (USD / GPU)':'Maximum USD / GPU-hour','budget',r.budget??'','number','min="0.01" step="0.01" required'),
   input(c,isHardware?'Required arrival (UTC)':'Required start (UTC)','start',isoInput(r.start),'datetime-local','required'),
   input(c,'Quotes due (UTC)','quoteDeadline',isoInput(r.quoteDeadline||Date.now()+12*3600000),'datetime-local','required'),
   isHardware?input(c,'Shipping destination / address','shippingAddress',r.shippingAddress||'','text','required maxlength="600"')+input(c,'Incoterms / shipping responsibility','incoterms',r.incoterms||'DAP · taxes and fees to confirm')+input(c,'Warranty and return requirements','warranty',r.warranty||'Warranty, authenticity and inspection terms required'):isModel?input(c,'Access and data policy requirements','accessPolicy',r.accessPolicy||'Authorized access; data location and retention to confirm'):input(c,'Network / interconnect','network',r.network||'400 Gb/s InfiniBand or equivalent')+input(c,'Storage capacity / type','storage',r.storage||'1 TB NVMe per node')+input(c,'Runtime / OS / image','image',r.image||'Ubuntu 24.04 · CUDA 12'),
   input(c,isHardware?'Inspection / support requirements':'SLA / support needs','sla',r.sla||(isHardware?'Serial-number verification and hardware acceptance':'99.9% availability · 24/7 escalation')),
   input(c,'Delivery / access method','deliveryMethod',r.deliveryMethod||X.deliveryMethod(r)),
   `<div><label class="form-label">Urgency</label><select class="field" name="urgency">${['Standard','High urgency','Flexible start'].map(v=>`<option ${v===r.urgency?'selected':''}>${v}</option>`).join('')}</select></div>`,
   `<div><label class="form-label">Visibility</label><select class="field" name="visibility" ${r.originSupply?'disabled':''}>${['Public requirements','Private RFQ'].map(v=>`<option ${v===(r.originSupply?'Private RFQ':r.visibility)?'selected':''}>${v}</option>`).join('')}</select></div>`,
   S.role==='Broker'?input(c,'Represented client','client',r.client||'','text','required maxlength="120"'):''
   ];
   return `<form data-form="proc-rfq" data-id="${editing?r.id:''}"><input type="hidden" name="kind" value="${X.kindOf(r)}"><input type="hidden" name="originSupply" value="${c.esc(r.originSupply||'')}"><input type="hidden" name="sku" value="${c.esc(r.sku||'')}">${r.originSupply?`<div class="callout">Selected supply · ${c.esc(chosen?.provider||r.originSupply)}. This request goes to this supplier, not to the public RFQ board.</div>`:''}${isModel&&chosen?`<p class="form-note">Listed rates: input $${Number(chosen.price)} / 1M tokens · output $${Number(chosen.outputPrice)} / 1M tokens. Total depends on your input and output volumes; final terms require a quote.</p>`:''}<div class="form-grid">${fields.join('')}<div class="full"><label class="form-label">${isHardware?'Hardware specifications and acceptance requirements':'Workload and acceptance requirements'}</label><textarea class="field" name="notes" rows="4" maxlength="4000" required>${c.esc(r.notes||'')}</textarea></div></div><label class="row form-note"><input type="checkbox" name="shareClosingPrice" ${r.shareClosingPrice!==false?'checked':''}>Share the awarded price with participating suppliers after the RFQ closes.</label>${S.role==='Broker'?'<label class="row form-note"><input type="checkbox" name="mandateConfirmed" required>I am authorized to request quotes for this client.</label>':''}<p class="form-note">No payment is taken. A supplier quote confirms the exact capacity, availability window and payable amount.</p><div class="modal-footer">${btn('Cancel','close-modal')}<button class="btn" type="submit">${editing?'Save requirement':r.originSupply?'Request supplier quote':'Post RFQ'}</button></div></form>`;
  }
  function orderAction(c,type,o){
   if(!o)return {title:'Order unavailable',body:'The order could not be found.'};
   const r=c.S.rfqs.find(r=>r.id===o.rfqId)||o,isHardware=hardware(r),isModel=model(r);
   if(type==='proc-payment')return {title:'Review payment · '+o.id,body:`<div class="details-grid">${field(c,'Supplier',o.provider)}${field(c,'Capacity',o.model+' · '+volume(r))}${field(c,isHardware?'Required arrival':'Service window',date(o.serviceStart)+(isHardware?'':isModel?' · '+r.days+' days':' · '+r.hours+'h'))}${field(c,'Order total',c.money(o.total))}${field(c,'Available credit',c.money(c.S.balance))}${field(c,'Payment method','Workspace credit')}</div><p class="form-note">This local preview records a test order payment. No external charge is made.</p><div class="modal-footer">${c.S.balance<o.total?btn('Add credit','pay-start','',`data-order-id="${o.id}"`,true):btn('Confirm test payment','proc-pay-confirm',o.id,'',true)}</div>`};
   if(type==='proc-delivery')return {title:isHardware?'Confirm shipping details':'Delivery requirements',body:`<form data-form="proc-delivery" data-id="${o.id}"><div class="callout">${c.esc(o.model)} · ${c.esc(o.region)} · ${date(o.serviceStart)}. Delivery target: ${deliveryTime(o.deliveryMinutes,r)}.</div>${isHardware?input(c,'Consignee name','consignee',c.S.identity.name,'text','required')+input(c,'Contact email','contactEmail',c.S.identity.email,'email','required')+input(c,'Contact phone','contactPhone','','tel','required')+input(c,'Complete shipping address','shippingAddress',r.shippingAddress||'','text','required maxlength="600"'):`<label class="form-label">${isModel?'Delivery contact email':'SSH public key'}</label><textarea class="field" name="access" rows="3" required placeholder="${isModel?'Email for authorized access invitation':'ssh-ed25519 …'}">${c.esc(isModel?c.S.identity.email:c.S.identity.ssh||'')}</textarea>`}<p class="form-note">${isHardware?'Confirm consignee, import eligibility, Incoterms and insurance with the supplier before shipment.':isModel?'Never paste an upstream API secret here.':'Public key only; never upload a private SSH key.'}</p><label class="row form-note"><input type="checkbox" required>I confirm the configuration and ${isHardware?'shipping details':'service window'}.</label><div class="modal-footer"><button class="btn">Send delivery details</button></div></form>`};
   if(type==='proc-verify'){
    const checks=isHardware?['Shipment received and packaging inspected','Exact GPU SKU, quantity and serial numbers verified','Hardware acceptance tests completed','Warranty, invoice and delivery documents received']:isModel?['Access invitation received','Model, token allowance and throughput match the quote','Service window and metering start verified','Acceptance checks completed']:['SSH access received','GPU model and count match the quote','Service window and metering start verified','Acceptance checks completed'];
    return {title:isHardware?'Inspect hardware delivery':'Verify delivery',body:`<div class="callout">Test delivery checklist · ${isHardware?'no goods are shipped':'no infrastructure is provisioned'} in this preview.</div><form data-form="proc-verify" data-id="${o.id}">${checks.map((t,i)=>`<label class="row proc-check"><input type="checkbox" name="check${i}" required>${t}</label>`).join('')}<div class="modal-footer"><button class="btn">${isHardware?'Accept hardware delivery':'Accept test delivery'}</button></div></form>`};
   }
   if(type==='proc-manage')return {title:'Service · '+o.id,body:`${requirementFields(c,r)}<div class="callout">Delivery accepted ${date(o.deliveredAt)}. ${isHardware?'Purchase':'Service'} is ${c.esc(o.status.toLowerCase())}.</div><div class="modal-footer">${isModel||isHardware?'':btn('Open instances','open-rfq-instance',r.id)}${btn(isHardware?'Complete hardware order':'Complete test service','proc-complete',o.id,'',true)}</div>`};
   return null;
  }
  function responseDialog(c,req){
   if(!req)return {title:'RFQ unavailable',body:'This RFQ is no longer available.'};
   const prices=model(req)?input(c,'Input rate (USD / 1M tokens)','inputRate',req.priceSnapshot?.input??req.price??'','number','min="0" step="0.000001" required')+input(c,'Output rate (USD / 1M tokens)','outputRate',req.priceSnapshot?.output??req.outputPrice??'','number','min="0" step="0.000001" required'):input(c,hardware(req)?'Your unit price (USD / GPU)':'Your unit price (USD / GPU-hour)','rate',req.budget||req.price,'number','min="0.01" step="0.01" required');
   return {title:'Respond to '+(req.id||'RFQ'),body:`<div class="callout">${c.esc(req.model)} · ${c.esc(volume(req))} · ${c.esc(req.region)}</div><form data-form="proc-response" data-id="${req.id}"><div class="form-grid">${prices}${input(c,hardware(req)?'Shipping lead time (days)':'Delivery lead time (minutes)',hardware(req)?'deliveryDays':'delivery',hardware(req)?7:30,'number','min="1" required')}${input(c,'Quote valid until (UTC)','validUntil',isoInput(Date.now()+24*3600000),'datetime-local','required')}${input(c,hardware(req)?'Ownership and serial-number evidence':model(req)?'Access authorization and capacity evidence':'Capacity evidence reference','evidence','','text','required')}${input(c,hardware(req)?'Exact SKU, condition and warranty':model(req)?'Model limits, access and data policy':'Network / storage specification','specification','','text','required')}<div class="full"><label class="form-label">Commercial and service terms</label><textarea class="field" name="notes" required placeholder="${hardware(req)?'Shipping, inspection, Incoterms, warranty, return and tax terms':'SLA, cancellation, limits, access rights and support'}"></textarea></div></div><div class="modal-footer"><button class="btn">Submit capacity for verification</button></div></form>`,wide:true};
  }
  function listingDialog(c,type,item){
   if(!item)return {title:'Record unavailable',body:'Refresh the market to load this record.'};
   const isModel=model(item),isHardware=hardware(item);
   return {title:item.model+' · '+item.provider,body:`<p class="form-note">${item.sample?'Preview market record · not a verified live transaction':'Workspace marketplace record'}</p><div class="details-grid">${field(c,'Side',type==='proc-settlement'?'Settled':item.side)}${field(c,'Region',item.region)}${field(c,'Price',c.money(item.price)+(isModel?' / 1M input tokens':unit(item)))}${isModel?field(c,'Output rate','$'+Number(item.outputPrice)+' / 1M tokens'):''}${field(c,'Capacity',isModel?`${item.count||'To confirm'}M input tokens`:item.count+' GPU')}${field(c,'Term',item.term)}${!isHardware?field(c,'Duration',isModel?(item.days||30)+' days':item.hours+' hours'):field(c,'Shipping / warranty','Confirm before purchase')}${field(c,'Counterparty',item.provider)}${field(c,'Date',date(item.settledAt||item.created))}</div><p class="proc-notes">${c.esc(item.description||'')}</p>${type==='proc-listing'?`<div class="modal-footer">${btn(item.side==='supply'?'Buy capacity':'Offer capacity','proc-opportunity',item.id,`data-intent="${item.side==='supply'?'buy':'offer'}"`,true)}</div>`:''}`};
  }
  function responseRecord(c,response){
   if(!response)return {title:'Response unavailable',body:'The response could not be found.'};
   return {title:'Supplier response · '+response.id,body:`<div class="details-grid">${field(c,'RFQ',response.rfqId)}${field(c,'Price',c.money(response.rate)+unit(response))}${field(c,'Quoted total',c.money(X.totalFor(response,response.rate)))}${model(response)?field(c,'Input / output rates',`$${response.inputRate} / $${response.outputRate} per 1M tokens`):''}${field(c,'Delivery',deliveryTime(response.delivery,response))}${field(c,'Status',response.status)}${field(c,'Validity',date(response.validUntil))}${field(c,'Capacity evidence',response.evidence)}</div><p class="proc-notes">${c.esc(response.notes)}</p><p class="form-note">Preview controls below advance a local buyer/supplier scenario; no external customer or payment is contacted.</p><div class="modal-footer">${response.status==='Pending test'?btn('Run test & submit quote','proc-response-test',response.id,'',true):response.status==='Submitted'?btn('Simulate buyer acceptance','proc-response-accept',response.id,'',true):response.orderId?btn('View order','bill-order',response.orderId):''}</div>`};
  }
  function modal(c,type,extra){
   const S=c.S,r=extra.requirement||S.rfqs.find(r=>r.id===extra.id),q=r?.quotes?.find(q=>q.id===extra.quoteId);
   if(type==='rfq'||type==='model-rfq')return {title:r?.title||'Requirement',body:record(c,r),wide:true};
   if(type==='rfq-form'||type==='proc-edit'){
    const item=extra.prefill||extra.offer||{};
    return {title:type==='proc-edit'?'Edit requirement':item.originSupply?'Request this listed offer':'Post capacity RFQ',body:form(c,type==='proc-edit'?r:{...item,model:extra.model||item.model||S.model,budget:item.budget??item.price},type==='proc-edit'),wide:true};
   }
   if(type==='proc-accept-review')return {title:'Accept supplier quote',body:`<div class="details-grid">${field(c,'Supplier',q?.provider)}${field(c,'Quoted total',c.money(q?.total))}${field(c,'Delivery',deliveryTime(q?.delivery,r))}${field(c,'Valid until',date(q?.validUntil))}</div><p class="form-note">Accepting selects this supplier and closes the other pending quotes. ${r?.shareClosingPrice?'Participating suppliers will see the closing price.':'The closing price remains private.'} Payment is a separate step.</p><div class="modal-footer">${btn('Back to quotes','view-rfq',r.id)}${btn('Confirm acceptance','proc-accept-confirm',r.id,`data-quote="${q.id}"`,true)}</div>`};
   if(type==='proc-quote-details')return {title:q?.provider+' quotation',body:`${requirementFields(c,r)}<div class="details-grid">${[['Unit / total quote',c.money(q?.price)+unit(r)],['Quoted total',c.money(q?.total)],['Delivery lead time',deliveryTime(q?.delivery,r)],['SLA / warranty',q?.sla],['Payment terms',q?.paymentTerms],['Delivery method',q?.deliveryMethod],['Cancellation',q?.cancellation],['Valid until',date(q?.validUntil)]].map(([k,v])=>field(c,k,v)).join('')}</div><div class="modal-footer">${btn('Back to quotes','view-rfq',r.id)}</div>`,wide:true};
   if(['proc-payment','proc-delivery','proc-verify','proc-manage'].includes(type))return orderAction(c,type,S.orders.find(o=>o.id===extra.id));
   if(type==='proc-listing'||type==='proc-settlement')return listingDialog(c,type,type==='proc-settlement'?settlements.get(extra.id):X.get(extra.id));
   if(type==='respond')return responseDialog(c,r||X.get(extra.id));
   if(type==='proc-response')return responseRecord(c,S.responses.find(x=>x.id===extra.id));
   return null;
  }
  function opportunity(c,id,intent){const item=X.get(id);if(!item){c.toast('Listing unavailable. Refresh the market.');return;}c.S.pendingOpportunity={id,intent};if(c.S.role!=='Broker')c.S.role=intent==='offer'?'Seller':'Buyer';c.persist();if(!c.S.auth){c.go(intent==='offer'?'supply':'rfqs');return;}resume(c);}
  function resume(c){
   const pending=c.S.pendingOpportunity;if(!pending||!c.S.auth)return;
   const item=X.get(pending.id);c.S.pendingOpportunity=null;c.persist();
   if(!item){c.toast('This listing is no longer available.');return;}
   const kind=X.kindOf(item);
   if(pending.intent==='offer'){
    const requirement=c.S.rfqs.find(r=>r.id===item.originRfq)||{...item,kind,budget:model(item)?X.tokenTotal({inputMillion:item.count||10,outputMillion:2},item.price,item.outputPrice||0):item.price,inputMillion:item.inputMillion??item.count??10,outputMillion:item.outputMillion??2,title:item.title,hours:hardware(item)?0:item.hours||72,deliveryMethod:X.deliveryMethod(item),priceSnapshot:model(item)?{input:item.price,output:item.outputPrice}:undefined};
    c.S.activeRequirement=requirement;c.go('supply');
    if(c.S.review.status!=='Approved'){c.S.afterReview={type:'respond',requirement};c.open('review');}else c.open('respond',{requirement});
   }else{
    c.go('rfqs');
    const inputMillion=item.inputMillion??10,outputMillion=item.outputMillion??2;
    c.open('rfq-form',{prefill:{...item,kind,title:item.model+' · '+item.provider,originSupply:item.id,selectedSupplier:item.provider,sku:item.sku,budget:model(item)?X.tokenTotal({inputMillion,outputMillion},item.price,item.outputPrice||0):item.price,inputMillion,outputMillion,days:item.days||30,project:'',visibility:'Private RFQ',hours:hardware(item)?0:item.hours||72,deliveryMethod:X.deliveryMethod(item),notes:item.description}});
   }
  }
  function sellerProgress(c,o) {
    if (!o || o.side !== 'sell' || !['Seller','Broker'].includes(c.S.role)) throw Error('Choose a sell-side order.');
    const at=new Date().toISOString(); let event;
    if(o.status==='Awaiting buyer payment'){o.status='Paid';o.paymentStatus='Paid';o.paidAt=at;o.paymentId=X.uid('PAY');o.paymentReference=o.paymentId;event='Buyer test payment confirmed';}
    else if(o.status==='Paid'){o.status='Provisioning';event='Supplier started test provisioning';}
    else if(o.status==='Provisioning'){o.status='Active';o.deliveredAt=at;event='Buyer accepted test delivery';}
    else if(o.status==='Active'){
      if(o.settledAt)throw Error('This order is already settled.');
      const net=X.round(o.sellerNet??o.subtotal??o.total);
      if(!Number.isFinite(net)||net<0)throw Error('Invalid settlement amount.');
      o.status='Completed';o.completedAt=at;o.settledAt=at;o.sellerNet=net;
      c.S.earningsBalance=X.round(Number(c.S.earningsBalance||0)+net);
      c.S.ledger.unshift({id:X.uid('SALE'),orderId:o.id,type:'Sale settlement',amount:net,date:at,createdAt:at,role:c.S.role,side:'sell',status:'Completed',test:true});
      event='Test service completed; proceeds released to withdrawable earnings';
    } else throw Error('This order has no next settlement action.');
    o.audit.push({at,event});X.notify(c.S,'Seller',event,o.id+' · '+o.status,{orderId:o.id});
  }
  function action(c,act,b){
   const S=c.S,id=b.dataset.id,r=S.rfqs.find(r=>r.id===id),q=r?.quotes?.find(q=>q.id===b.dataset.quote),o=S.orders.find(o=>o.id===id);
   try{
    switch(act){
     case'proc-listing':case'proc-settlement':case'proc-edit':case'proc-payment':case'proc-delivery':case'proc-verify':case'proc-manage':case'proc-response':c.open(act,{id});return true;
     case'proc-seller-progress':sellerProgress(c,o);c.persist();c.render();c.open('bill-order',{id});return true;
     case'proc-opportunity':opportunity(c,id,b.dataset.intent);return true;
     case'proc-read':S.notifications.forEach(n=>{if(n.role===S.role||(S.role==='Broker'&&['Buyer','Seller'].includes(n.role)))n.read=true;});break;
     case'proc-sample-quotes':
      if(!['Open','Quoted'].includes(r.status))throw Error('This RFQ is closed.');
      if(r.quotes.some(q=>q.status==='Pending'))throw Error('Review the current quotes before requesting another round.');
      const quotes=X.sampleQuotes(r).map(q=>({...q,id:X.uid('QUOTE')}));
      r.quotes.push(...quotes);r.status='Quoted';r.sample=true;r.audit.push({at:new Date().toISOString(),event:quotes.length+' preview supplier quotes loaded'});
      c.persist();c.render();c.open('rfq',{id});return true;
     case'proc-quote-details':case'proc-accept-review':if(!q)throw Error('Quotation not found.');c.open(act,{id,quoteId:q.id});return true;
     case'proc-reject':X.reject(S,r,q);c.persist();c.open('rfq',{id});return true;
     case'proc-accept-confirm':X.accept(S,r,q);c.persist();c.render();c.open('rfq',{id});c.toast('Supplier selected. Order is ready for payment.');return true;
     case'proc-pay-confirm':X.pay(S,o);c.persist();c.render();c.open('rfq',{id:o.rfqId});return true;
     case'proc-close':
      if(r.accepted)throw Error('An awarded RFQ cannot be cancelled here.');
      r.status='Cancelled';r.audit.push({at:new Date().toISOString(),event:'RFQ closed by buyer'});
      r.quotes.filter(q=>q.status==='Pending').forEach(q=>{q.status='Closed';const response=S.responses.find(res=>res.id===q.id);if(response)response.status='Closed';X.notify(S,'Seller','RFQ closed',r.id+' was closed without an award.',{supplier:q.provider,rfqId:r.id});});break;
     case'proc-complete':
      if(o.status!=='Active')throw Error('Service must be active first.');
      o.status='Completed';o.completedAt=new Date().toISOString();o.audit.push({at:o.completedAt,event:'Test service completed'});
      S.rfqs.find(r=>r.id===o.rfqId).status='Completed';
      const instance=S.instances.find(i=>i.id===o.instanceId);if(instance){instance.status='Ended';instance.end=Date.now();S.orders.filter(x=>x.instanceId===instance.id&&x.status==='Active').forEach(x=>{x.status='Completed';x.completedAt=o.completedAt;x.audit.push({at:o.completedAt,event:'Associated test instance ended'});});S.rfqs.filter(x=>x.instance===instance.id&&x.status==='Active').forEach(x=>x.status='Completed');}
      X.notify(S,'Seller','Service completed',o.id+' is completed.',{supplier:o.provider,orderId:o.id});break;
     case'proc-response-test':{
      const res=S.responses.find(x=>x.id===id);if(res.status!=='Pending test')throw Error('Capacity has already been tested.');
      res.status='Submitted';res.testedAt=new Date().toISOString();
      X.notify(S,'Buyer','New supplier quote',res.rfqId+' received a tested supplier quote.',{rfqId:res.rfqId});
      const req=S.rfqs.find(r=>r.id===res.rfqId);
      if(req&&['Open','Quoted'].includes(req.status)){req.quotes.push({id:res.id,provider:S.review.company||S.identity.company||S.identity.name,price:res.rate,total:X.totalFor(res,res.rate),input:res.inputRate,output:res.outputRate,delivery:res.delivery,validUntil:res.validUntil,status:'Pending',sample:true,notes:res.notes,deliveryMethod:X.deliveryMethod(res),sla:res.specification});req.status='Quoted';}
      c.persist();c.render();c.open('proc-response',{id});return true;
     }
     case'proc-response-accept':{
      const res=S.responses.find(x=>x.id===id);
      if(!res)throw Error('Response not found.');
      const existingOrder=S.orders.find(order=>order.quoteId===res.id||order.id===res.orderId);
      if(existingOrder){res.orderId=existingOrder.id;res.status='Accepted';c.persist();c.open('bill-order',{id:existingOrder.id});return true;}
      if(res.orderId)throw Error('This response already has an order. Refresh its order record.');
      if(res.status!=='Submitted'||!Number.isFinite(+new Date(res.validUntil))||new Date(res.validUntil)<=new Date())throw Error('The quote is not available or has expired.');
      const total=X.totalFor(res,res.rate);if(!Number.isFinite(total)||total<=0)throw Error('Invalid quote total.');
      res.status='Accepted';
      const start=new Date(Date.now()+86400000).toISOString(),serviceLength=model(res)?res.days*86400000:res.hours*3600000;
      const order={id:X.uid('ORDER'),rfqId:res.rfqId,quoteId:res.id,title:res.model+' supply',kind:X.kindOf(res),model:res.model,sku:res.sku,count:res.count,hours:res.hours,days:res.days,inputMillion:res.inputMillion,outputMillion:res.outputMillion,inputRate:res.inputRate,outputRate:res.outputRate,region:res.region,term:res.term,rate:res.rate,unitPrice:res.rate,priceUnit:X.unitLabel(res),total,amount:total,subtotal:total,fees:0,tax:0,role:S.role,side:'sell',deliveryMinutes:res.delivery,deliveryMethod:X.deliveryMethod(res),serviceStart:start,serviceEnd:hardware(res)?null:new Date(new Date(start).getTime()+serviceLength).toISOString(),tradeMethod:'RFQ award',paymentMethod:'Workspace credit',buyer:{name:'Preview buyer',company:res.client||'Preview buyer'},seller:{name:S.identity.name,company:S.review.company||S.identity.company},broker:S.role==='Broker'?{name:S.identity.name,company:S.identity.company}:null,provider:S.review.company||S.identity.name,status:'Awaiting buyer payment',paymentStatus:'Unpaid',createdAt:new Date().toISOString(),created:new Date().toISOString(),sample:true,shippingAddress:res.shippingAddress,sla:res.specification,cancellationTerms:res.notes,audit:[{at:new Date().toISOString(),event:'Preview buyer accepted supplier quote'}]};
      res.orderId=order.id;S.orders.unshift(order);X.notify(S,'Seller','Quote accepted',order.id+' is awaiting buyer payment.',{orderId:order.id});
      c.persist();c.render();c.open('proc-response',{id});return true;
     }
     default:return false;
    }
    c.persist();S.modal=null;c.render();return true;
   }catch(e){c.toast(e.message);return true;}
  }
  function submit(c,formEl,data){
   const S=c.S,id=formEl.dataset.id;
   try{
    switch(formEl.dataset.form){
     case'proc-rfq':{
      const kind=X.kindOf(data),isModel=model(data),isHardware=hardware(data),count=isModel?0:Number(data.count),hours=isHardware?0:Number(data.hours||0),budget=Number(data.budget),start=new Date(data.start+'Z'),deadline=new Date(data.quoteDeadline+'Z');
      const inputMillion=Number(data.inputMillion||0),outputMillion=Number(data.outputMillion||0),days=Number(data.days||30),tps=data.tps?Number(data.tps):null;
      if(!data.title?.trim()||!data.notes?.trim()||!data.project?.trim()||!data.region?.trim()||!Number.isFinite(budget)||budget<=0||!Number.isFinite(+start)||!Number.isFinite(+deadline)||start<=new Date()||deadline<=new Date()||deadline>start)throw Error('Enter the requirement, project, budget and a future schedule with quotes due before delivery.');
      if(!isModel&&(!Number.isInteger(count)||count<1||count>4096||(!isHardware&&(!Number.isFinite(hours)||hours<1||hours>26280))))throw Error('Enter a valid GPU quantity and rental duration.');
      if(isHardware&&(!data.shippingAddress?.trim()||!data.condition?.trim()))throw Error('Enter the hardware condition and shipping destination.');
      if(isModel&&(![inputMillion,outputMillion].every(n=>Number.isFinite(n)&&n>=0)||inputMillion+outputMillion<=0||!Number.isInteger(days)||days<1||days>1095||(tps!==null&&(!Number.isInteger(tps)||tps<1))))throw Error('Enter positive token usage, a valid duration and throughput.');
      if(S.role==='Broker'&&(!data.client?.trim()||!data.mandateConfirmed))throw Error('Identify the represented client and confirm your mandate.');
      const existing=S.rfqs.find(r=>r.id===id),chosen=data.originSupply?X.get(data.originSupply):null;
      if(existing?.accepted)throw Error('An awarded requirement cannot be edited.');
      if(data.originSupply&&(!chosen||chosen.side!=='supply'||X.kindOf(chosen)!==kind||chosen.model!==data.model))throw Error('The selected supply has changed. Reopen that listing.');
      const r={...existing,...data,kind,id:id||X.uid('RFQ'),count,hours,budget,start:start.toISOString(),quoteDeadline:deadline.toISOString(),inputMillion,outputMillion,days,tps,term:isHardware?'Physical GPU':data.term,selectedSupplier:chosen?.provider||existing?.selectedSupplier,priceSnapshot:isModel&&chosen?{input:chosen.price,output:chosen.outputPrice,sku:chosen.sku}:existing?.priceSnapshot,visibility:chosen?'Private RFQ':data.visibility,status:existing?.status||'Open',created:existing?.created||new Date().toISOString(),shareClosingPrice:!!data.shareClosingPrice,quotes:existing?.quotes||[],audit:existing?.audit||[]};
      if(existing){
       const substantive=['model','count','hours','budget','region','term','start','days','inputMillion','outputMillion','tps','shippingAddress','condition','incoterms','warranty','notes','deliveryMethod'].some(k=>String(existing[k]??'')!==String(r[k]??''));
       if(substantive){r.quotes.forEach(q=>{if(q.status==='Pending'){q.status='Needs refresh';const response=S.responses.find(res=>res.id===q.id);if(response)response.status='Needs refresh';}});r.status='Open';}
       Object.assign(existing,r);r.audit.push({at:new Date().toISOString(),event:'Requirement updated; changed specifications require new quotes'});
      }else{
       S.rfqs.unshift(r);
       if(chosen?.sample){r.quotes=X.sampleQuotes(r).map(q=>({...q,id:X.uid('QUOTE'),notes:'Preview quote for the selected listing; confirm schedule, access and commercial terms before award.'}));r.status='Quoted';r.sample=true;}
      }
      X.init(S);c.persist();c.go('rfqs');c.open('rfq',{id:r.id});return true;
     }
     case'proc-delivery':{
      const o=S.orders.find(o=>o.id===id);if(o.paymentStatus!=='Paid'||o.status!=='Paid')throw Error('Confirm payment before delivery.');
      const r=S.rfqs.find(r=>r.id===o.rfqId);
      if(hardware(r)){
       if(!data.consignee?.trim()||!data.shippingAddress?.trim()||!data.contactPhone?.trim()||!/^\S+@\S+\.\S+$/.test(data.contactEmail||''))throw Error('Enter consignee, complete address, phone and valid contact email.');
       o.shippingAddress=data.shippingAddress;o.consignee=data.consignee;o.deliveryContact=data.contactEmail;o.contactPhone=data.contactPhone;o.fulfillmentStage='Awaiting shipment';
      }else{
       const access=String(data.access||'').trim();
       if(!model(r)&&!/^ssh-(ed25519|rsa)\s+[A-Za-z0-9+/=]{16,}/.test(access))throw Error('Enter a valid SSH public key, never a private key.');
       if(model(r)&&!/^\S+@\S+\.\S+$/.test(access))throw Error('Enter a valid delivery email.');
       o.deliveryContact=access;
      }
      o.status='Provisioning';r.status='Provisioning';o.audit.push({at:new Date().toISOString(),event:hardware(r)?'Buyer confirmed shipping and consignee details':'Buyer supplied delivery details'});break;
     }
     case'proc-verify':{
      const o=S.orders.find(o=>o.id===id);if(o.status!=='Provisioning')throw Error('This order is not awaiting delivery verification.');
      if(![0,1,2,3].every(i=>data['check'+i]))throw Error('Complete each acceptance check.');
      const r=S.rfqs.find(r=>r.id===o.rfqId),at=new Date().toISOString();
      const extension=r.extensionOf?S.instances.find(i=>i.id===r.extensionOf):null;
      if(r.extensionOf){
       if(model(r)||hardware(r)||!extension||extension.status!=='Running'||extension.end<=Date.now()||o.paymentStatus!=='Paid')throw Error('An extension needs a paid order and the original running instance.');
       if(extension.model!==r.model||Number(extension.count)!==Number(r.count)||X.regionCode(extension.region)!==X.regionCode(r.region)||extension.end!==+new Date(r.start))throw Error('The original instance or service window has changed. Request a revised extension.');
       if(extension.nextReservation&&extension.end+r.hours*3600000>extension.nextReservation)throw Error('The extension conflicts with another reservation. Ask the supplier for a new window.');
      }
      o.status=hardware(r)?'Completed':'Active';r.status=o.status;o.deliveredAt=at;
      if(hardware(r)){o.completedAt=at;o.fulfillmentStage='Hardware accepted';}
      else if(extension){o.instanceId=extension.id;r.instance=extension.id;o.extensionOf=extension.id;extension.hours+=r.hours;extension.end+=r.hours*3600000;extension.extensionOrders=[...(extension.extensionOrders||[]),o.id];o.serviceEnd=new Date(extension.end).toISOString();}
      else if(!model(r)){o.instanceId=X.uid('ins');r.instance=o.instanceId;S.instances.push({id:o.instanceId,name:r.title,model:r.model,count:r.count,region:r.region,status:'Running',rate:o.unitPrice,hours:r.hours,start:Math.max(Date.now(),+new Date(r.start)),end:Math.max(Date.now(),+new Date(r.start))+r.hours*3600000,provider:o.provider,orderId:o.id,sample:true});}
      o.audit.push({at,event:hardware(r)?'Buyer accepted hardware after SKU, serial-number and warranty checks':'Buyer accepted test delivery'});
      X.notify(S,'Seller','Delivery accepted',o.id+' was accepted by the buyer.',{orderId:o.id,supplier:o.provider});break;
     }
     case'proc-response':{
      const req=S.activeRequirement||S.modal?.requirement||S.rfqs.find(r=>r.id===id)||X.get(id);if(!req)throw Error('Requirement not found.');
      if(S.review.status!=='Approved')throw Error('Complete supplier review first.');
      const kind=X.kindOf(req),inputRate=Number(data.inputRate),outputRate=Number(data.outputRate);
      const rate=model(req)?X.tokenTotal(req,inputRate,outputRate):Number(data.rate),delivery=hardware(req)?Number(data.deliveryDays)*1440:Number(data.delivery),validUntil=new Date(data.validUntil+'Z');
      if(!Number.isFinite(rate)||!(rate>0)||!Number.isFinite(delivery)||!(delivery>0)||!Number.isFinite(+validUntil)||validUntil<=new Date())throw Error('Provide positive rates, delivery lead time and future quote validity.');
      if(model(req)&&![inputRate,outputRate].every(n=>Number.isFinite(n)&&n>=0))throw Error('Provide valid input and output token rates.');
      if(!data.evidence?.trim()||!data.specification?.trim()||!data.notes?.trim())throw Error('Provide capacity evidence, specifications and commercial terms.');
      if(S.responses.some(r=>r.rfqId===id&&['Pending test','Submitted','Accepted'].includes(r.status)))throw Error('You already have an active response to this RFQ.');
      const res={...data,id:X.uid('RESPONSE'),rfqId:id,kind,model:req.model,sku:req.sku,count:model(req)?0:Number(req.count)||8,hours:hardware(req)||model(req)?0:Number(req.hours)||72,days:Number(req.days)||30,inputMillion:Number(req.inputMillion)||0,outputMillion:Number(req.outputMillion)||0,inputRate:model(req)?inputRate:null,outputRate:model(req)?outputRate:null,shippingAddress:req.shippingAddress,client:req.client,region:req.region,term:req.term,rate,delivery,validUntil:validUntil.toISOString(),status:'Pending test',createdAt:new Date().toISOString()};
      S.responses.unshift(res);S.activeRequirement=null;c.persist();c.go('supply');c.open('proc-response',{id:res.id});return true;
     }
     default:return false;
    }
    c.persist();const o=S.orders.find(o=>o.id===id);c.render();c.open('rfq',{id:o.rfqId});return true;
   }catch(e){c.toast(e.message);return true;}
  }
  function supplyExtra(c){
   return `<section class="panel"><h2>My RFQ responses</h2>${c.S.responses.map(r=>`<div class="proc-notice"><div><strong>${c.esc(r.model)} · ${r.rfqId}</strong><p>${c.money(r.rate)}${unit(r)} · ${c.esc(r.status)} · valid ${date(r.validUntil)}</p></div>${btn('View response','proc-response',r.id)}</div>`).join('')||'<p class="form-note">Respond to a buyer requirement to start a capacity verification.</p>'}</section>${notifications(c)}`;
  }
  function supplyDemand(c){return `<section class="panel"><h2>Buyer requirements</h2><p class="form-note">Matched to ${c.esc(c.S.model)} · ${c.esc(c.S.region)}. Change market filters to explore other requirements.</p>${X.matches(c.S,'demand').slice(0,5).map(r=>`<div class="proc-notice"><div><strong>${c.esc(r.model)} · ${r.count} GPU</strong><p>${c.esc(r.region)} · ${r.hours}h · target ${c.money(r.price)}/GPU-hour${r.sample?' · Preview RFQ':''}</p></div>${btn('Offer capacity','proc-opportunity',r.id,'data-intent="offer"')}</div>`).join('')}</section>`;}
  window.OpenNEXTProcurement={page,modal,action,submit,matches,listingTable,supplyExtra,supplyDemand,opportunity,resume,notifications};
})();
