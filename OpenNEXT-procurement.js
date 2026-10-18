(function () {
  'use strict';
  const X=window.OpenNEXTExchange;
  let marketContext=null,settlementDays=3;
  const submissionIds=new WeakMap(),submittingForms=new WeakSet();
  const receiptFor=record=>record?.submission?.status==='Received'&&typeof record.submission.receiptId==='string'&&record.submission.receiptId.trim().length>0&&Number.isFinite(Date.parse(record.submission.receivedAt))?record.submission:null;
  const isDemo=()=>!!window.OpenNEXTDemo?.active||!!window.OpenNEXTAuth?.getUser?.()?.demo;
  function receiptDetails(c,record){
    const receipt=receiptFor(record);
    return receipt?'<section class="callout"><strong>'+ (isDemo()?'Demo submission received':'Received by OpenNEXT operations')+'</strong><p class="form-note">'+c.esc(receipt.receiptId)+' · '+date(receipt.receivedAt)+' · Revision '+c.esc(receipt.revision||1)+'</p><p class="form-note">Receipt confirms submission, not approval, publication or payment.</p></section>':'';
  }
  async function submitRecord(c,formEl,recordKind,data){
    const button=formEl.querySelector('[type="submit"]');
    if(submittingForms.has(formEl)||button?.disabled)return;
    submittingForms.add(formEl);if(button)button.disabled=true;
    let saved=null;
    try{
      const id=formEl.dataset.id;
      if(!submissionIds.has(formEl))submissionIds.set(formEl,window.crypto?.randomUUID?.()||X.uid('REQ'));
      const input=recordKind==='supply'?{...data,serviceStart:new Date(data.serviceStart+'Z').toISOString(),serviceEnd:new Date(data.serviceEnd+'Z').toISOString()}:{...data,start:new Date(data.start+'Z').toISOString(),quoteDeadline:new Date(data.quoteDeadline+'Z').toISOString(),shareClosingPrice:!!data.shareClosingPrice};
      if(!id)input.clientSubmissionId=submissionIds.get(formEl);
      const path='/api/marketplace/'+(recordKind==='supply'?'supplies':'rfqs')+(id?'/'+encodeURIComponent(id):'');
      const result=await X.api(path,id?'PATCH':'POST',input);
      const record=result?.[recordKind];
      if(!record||typeof record.id!=='string'||!record.id)throw Error('The server did not return a submission reference. Refresh your records before trying again.');
      saved={type:'proc-submission',id:record.id,recordKind,receipt:receiptFor(record),recordStatus:record.status||'Saved',warnings:[],demo:isDemo()};
      c.S.modal=saved;c.S.route=recordKind==='supply'?'supply':'rfqs';
      if(recordKind==='supply'){
        try{
          const installation=await X.api('/api/marketplace/supplies/'+encodeURIComponent(record.id)+'/agent','POST',{});
          if(installation.message)saved.warnings.push(installation.message);
        }catch{
          saved.warnings.push('Capacity is saved. The agent setup request is pending; use Refresh status in My Supply instead of submitting the capacity again.');
        }
      }
      try{await X.refresh(c.S);}catch{saved.warnings.push('Your submission is saved, but the workspace could not refresh. Keep this reference and refresh your records. Do not submit it again.');}
      c.persist();c.render();
      c.toast(saved.receipt?(saved.demo?'Saved to the isolated Demo workspace.':'Submission received by OpenNEXT operations.'):'Saved to your account. Operations receipt has not been confirmed.');
    }catch(error){
      c.toast(saved?'Your submission is saved. Keep reference '+saved.id+' and refresh your records.':error.message);
    }finally{submittingForms.delete(formEl);if(button?.isConnected)button.disabled=false;}
  }
  const settlementPeriods=[[1,'1D'],[3,'3D'],[7,'1W'],[30,'1M'],[90,'3M'],[180,'6M'],[365,'1Y'],['all','ALL']];
  function supplyPage(c) {
    const S=c.S,review=S.review||{},reviewed=review.status==='Approved',pending=review.status==='Reviewing';
    return '<div class="page-content"><div class="page-heading"><div><h1>My Supply</h1><p>Verified capacity, visible to qualified buyers.</p></div>'+btn('List supply','new-supply','','',true)+'</div><section class="panel"><div class="row spread"><div><h2>Supplier review</h2><p class="form-note">Complete eligibility, business verification and capacity rights before publishing supply.</p></div><span class="tag '+(pending?'proc-reviewing':'')+'">'+c.esc(review.status||'Not started')+'</span></div><div class="proc-review-steps">'+['Eligibility','KYB','Rights'].map(label=>'<span class="'+(reviewed?'approved':pending?'reviewing':'')+'">'+(reviewed?'✓ ':pending?'◷ ':'')+label+(label==='KYB'&&pending?' · Reviewing':'')+'</span>').join('')+'</div>'+btn(reviewed?'View approval record':pending?'View submission':'Start supplier review','review')+(pending?'<p class="form-note">Your submission is being reviewed by operations. You will receive a workspace notification when a decision is ready.</p>':'')+'</section><section class="panel"><h2>Your capacity</h2><div class="table-scroll"><table class="data-table"><thead><tr><th>GPU / quantity</th><th>Region</th><th>Your unit price</th><th>Buyer price</th><th>Verification</th><th></th></tr></thead><tbody>'+(S.listings||[]).map(r=>'<tr><td><strong>'+c.esc(r.model||r.name)+'</strong><small class="proc-sub">'+r.count+' GPU · '+r.hours+' hours</small></td><td>'+c.esc(r.region)+'</td><td>'+c.money(r.netPrice??r.rate)+'</td><td>'+c.money(r.buyerPrice)+'</td><td>'+c.esc(r.status)+'<small class="proc-sub">Agent: '+c.esc(r.agentStatus)+'</small></td><td>'+btn('View details','proc-supply-status',r.id)+'</td></tr>').join('')+(!(S.listings||[]).length?'<tr><td colspan="6">No supply submitted yet. Saved submissions appear here immediately; publication waits for verification.</td></tr>':'')+'</tbody></table></div></section>'+supplyDemand(c)+supplyExtra(c)+'</div>';
  }
  function reviewDialog(c) {
    const r=c.S.review||{};
    if(['Reviewing','Approved','Rejected'].includes(r.status))return {title:'Supplier review',body:'<span class="tag '+(r.status==='Reviewing'?'proc-reviewing':'')+'">'+c.esc(r.status)+'</span><div class="details-grid">'+[['Company',r.company],['Registration',r.registration],['Country',r.country],['Submitted',date(r.submittedAt)]].map(([k,v])=>field(c,k,v)).join('')+'</div><p class="form-note">'+(r.status==='Reviewing'?'Your application is in review. Listing is locked until operations approves your business identity and rights.':r.status==='Approved'?'Your business is approved. Each capacity submission still requires successful agent installation.':c.esc(r.reason||'Review the submission and provide the requested evidence.'))+'</p>'+(r.status==='Rejected'?btn('Revise submission','proc-kyb-revise'):'')};
    return {title:'Verify your business',wide:true,body:'<form data-form="proc-kyb"><h3>Eligibility & business verification</h3><div class="form-grid">'+input(c,'Registered company name','company','','text','required maxlength="160"')+input(c,'Registration / business identifier','registration','','text','required maxlength="160"')+country(c,'country','','Country of registration')+'<div class="full"><label class="form-label">Business verification evidence</label><textarea class="field" name="evidence" rows="3" maxlength="3000" required placeholder="Provide a secure document reference or the evidence operations should review. Do not include passwords or private keys."></textarea></div><div class="full"><label class="form-label">Ownership / authorized supply rights</label><textarea class="field" name="rights" rows="3" maxlength="3000" required placeholder="Explain ownership or contractual rights to offer the capacity."></textarea></div></div><label class="row proc-check"><input name="eligibility" type="checkbox" required>I am authorized to represent this business and meet supplier eligibility requirements.</label><label class="row proc-check"><input name="rightsConfirmed" type="checkbox" required>The business has valid ownership or authorized supply rights.</label><p class="form-note">Operations reviews every submission. Completing this form does not automatically approve your business.</p><div class="modal-footer"><button class="btn" type="submit">Submit for review</button></div></form>'};
  }
  function supplyForm(c) {
    if(c.S.review?.status!=='Approved')return reviewDialog(c);
    return {title:'List GPU capacity',wide:true,body:'<form data-form="proc-supply"><input type="hidden" name="kind" value="gpu_rental"><div class="form-grid">'+input(c,'Listing title','title','','text','required maxlength="140"')+input(c,'GPU model','model',c.S.model,'text','required maxlength="100"')+country(c,'region','')+input(c,'Available GPU count','count','','number','required min="1" max="65536" step="1"')+input(c,'Available duration (hours)','hours','','number','required min="1" max="26280" step="1"')+'<div><label class="form-label">Market terms</label><select class="field" name="term"><option>Spot</option><option>On-demand</option><option>Reserved</option></select></div>'+input(c,'Your unit price (USD / GPU-hour)','netPrice','','number','required min="0.01" step="0.01" data-proc-net-price')+'<div class="proc-price-preview"><span>Buyer price (+5%)</span><strong data-proc-buyer-price>—</strong></div>'+input(c,'Available from (UTC)','serviceStart','','datetime-local','required')+input(c,'Available until (UTC)','serviceEnd','','datetime-local','required')+'<div class="full"><label class="form-label">Specifications and commercial terms</label><textarea class="field" name="notes" rows="3" maxlength="4000" required></textarea></div></div><h3>Agent installation handoff</h3><p class="form-note">Provide the SSH endpoint for the backend installation team. Never paste a private key or password. Supply stays unavailable until the trusted installer reports successful verification.</p><div class="form-grid">'+input(c,'SSH host / IP','sshHost','','text','required maxlength="253"')+input(c,'SSH user','sshUser','','text','required maxlength="100"')+input(c,'SSH port','sshPort','22','number','required min="1" max="65535"')+'</div><div class="modal-footer"><button class="btn" type="submit">Submit capacity & request agent setup</button></div></form>'};
  }
  function supplyStatus(c,id) {
    const r=c.S.listings.find(r=>r.id===id);if(!r)return {title:'Supply unavailable',body:'Refresh your supply list to load this record.'};
    return {title:r.model+' capacity',body:'<div class="details-grid">'+[['Supply',r.id],['Status',r.status],['Agent',r.agentStatus],['Country',r.region],['Your unit price',c.money(r.netPrice)],['Buyer price',c.money(r.buyerPrice)],['Service starts',date(r.serviceStart)],['Service ends',date(r.serviceEnd)]].map(([k,v])=>field(c,k,v)).join('')+'</div><div class="callout">'+(r.agentStatus==='Succeeded'?'Agent installation is verified. This supply is available in the marketplace.':'Agent installation must be completed by the backend integration before this offer can be published. Browser actions cannot approve installation.')+'</div><div class="modal-footer">'+(['Pending','Failed'].includes(r.agentStatus)?btn('Request installation update','proc-agent-request',r.id,'',true):'')+btn('Refresh status','proc-refresh')+'</div>'};
  }
  async function runServer(c,button,work) {
    if(button?.disabled)return; if(button)button.disabled=true;
    try{await work();await X.refresh(c.S);c.persist();c.render();}
    catch(error){c.toast(error.message);}
    finally{if(button?.isConnected)button.disabled=false;}
  }

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
  function notifications(c){const items=c.S.notifications.filter(n=>n.ownerId?n.ownerId===window.OpenNEXTAuth?.getUser?.()?.id:n.role===c.S.role||(c.S.role==='Broker'&&['Buyer','Seller'].includes(n.role))).slice(0,15);return `<section class="panel"><div class="row spread"><h2>Workspace notifications</h2>${items.some(n=>!n.read)?btn('Mark all read','proc-read'):''}</div>${items.map(n=>`<article class="proc-notice ${n.read?'read':''}"><div><strong>${c.esc(n.subject)}</strong><small>${date(n.created)}${n.supplier?' · '+c.esc(n.supplier):''}</small><p>${c.esc(n.message)}</p></div>${n.orderId?btn('Order details','bill-order',n.orderId):''}</article>`).join('')||'<p class="form-note">Quote, payment and delivery updates will appear here.</p>'}<p class="form-note">Verified account notifications. Email delivery requires the configured notification service.</p></section>`;}
  function listingTable(c){
    const sides=[['demand','RFQs'],['supply','Supply']],S=c.S;
    return '<div class="compare proc-market-listings"><div class="compare-title"><span>'+c.esc(S.model)+' Supply &amp; Demand</span><small>Verified marketplace records</small></div>'+sides.map(([side,label])=>{
      const rows=X.matches(S,side),supply=side==='supply',canAct=supply?S.role==='Buyer':S.role==='Seller';
      const prices=rows.map(r=>r.price),best=prices.length>1&&new Set(prices).size>1?Math.min(...prices):null;
      return '<section class="proc-market-section"><h3>'+label+'</h3><div class="table-scroll"><table><thead><tr><th>Counterparty</th><th>Country / region</th><th>$/GPU-hour</th><th>Quantity / term</th><th>'+(S.role==='Buyer'?'Bidding Parties':'Capacity')+'</th><th></th></tr></thead><tbody>'+rows.map(r=>'<tr><td><strong>'+c.esc(r.provider)+'</strong><small class="proc-sub">'+c.esc(r.id)+'</small></td><td>'+c.esc(r.region)+'</td><td '+(supply&&r.price===best?'class="best"':'')+'>'+c.money(r.price)+'</td><td>'+r.count+' GPU · '+r.hours+'h<small class="proc-sub">'+c.esc(r.term)+'</small></td><td>'+(S.role==='Buyer'?Number(r.biddingParties||0):r.count+' GPU')+'</td><td>'+btn('Details','proc-listing',r.id)+(canAct?' '+btn(supply?'Buy capacity':'Offer capacity','proc-opportunity',r.id,'data-intent="'+(supply?'buy':'offer')+'"',true):'')+'</td></tr>').join('')+'<tr '+(rows.length?'hidden':'')+'><td colspan="6">No '+(supply?'published supply':'open RFQs')+' match these filters.</td></tr></tbody></table></div></section>';
    }).join('')+'<p class="form-note proc-market-note">Bidding Parties counts unique verified buyers who requested a quote for this GPU model in the last 30 days. Supplier rental prices include a 5% platform markup.</p></div>';
  }
  function matches(c,kind){
    marketContext=c;
    const S=c.S,status=X.status(),rows=kind==='best'?X.best().filter(r=>r.model===S.model&&(!S.region||S.region==='All regions'||X.regionMatches(r.region,S.region))):recent(S);
    const empty=kind==='best'?(status.matchReason||'No matches.'):'No matches.';
    const cards=rows.map(r=>'<article class="match-card proc-match" data-match-id="'+c.esc(r.id)+'" data-match-side="'+c.esc(r.side||'settled')+'"><div class="match-top"><strong>'+c.esc(r.model)+'</strong><strong>'+c.money(r.price)+'<small> /GPU-hr</small></strong></div><p>'+c.esc(r.provider)+' · '+c.esc(r.region)+'<br>'+r.count+' GPU · '+c.esc(r.term)+' · '+r.hours+'h</p><div class="match-bottom"><span class="fit">'+(kind==='best'?(r.bestMatch?'Matches your submitted requirements':'Same-model recommendation'):'Settled '+date(r.settledAt))+'</span>'+btn(kind==='best'?(r.side==='demand'?'Offer':'Request quote'):'Details',kind==='best'?'proc-opportunity':'proc-settlement',r.id,kind==='best'?'data-intent="'+(r.side==='demand'?'offer':'buy')+'"':'')+'</div></article>').join('');
    return '<section class="matches" data-match-kind="'+kind+'"><div class="matches-head"><div><h3>'+(kind==='best'?'Best Matches':'Recent Settled')+'</h3><small>'+c.esc(S.model)+' · '+c.esc(S.region)+'</small></div>'+(kind==='best'?'<button class="icon-btn" data-act="proc-refresh" aria-label="Refresh matches">↻</button>':'<select class="field proc-history-days" aria-label="Settlement history" data-proc-days>'+settlementPeriods.map(([days,label])=>'<option value="'+days+'" '+(days===settlementDays?'selected':'')+'>'+label+'</option>').join('')+'</select>')+'</div>'+(kind==='best'&&status.matchPrompt?'<p class="proc-match-prompt">'+c.esc(status.matchPrompt)+'</p>':'')+'<div class="match-viewport proc-match-viewport" data-scroll="'+kind+'" tabindex="0"><div class="match-cycle">'+(cards||'<div class="proc-match-empty"><strong>'+c.esc(empty)+'</strong>'+(kind==='best'&&!rows.length?btn(S.role==='Seller'?'List supply':'Post RFQ',S.role==='Seller'?'new-supply':'new-rfq'):'')+'</div>')+'</div>'+(rows.length>3?'<div class="match-copy" aria-hidden="true" inert>'+cards+'</div>':'')+'</div><div class="match-foot"><span>'+rows.length+' '+(kind==='best'?'matches':'settlements')+'</span><span>Hover to pause</span></div></section>';
  }
  const settlements=new Map();
  function recent(S){const cutoff=Date.now()-settlementDays*86400000,rows=X.recent().filter(r=>r.model===S.model&&(S.region==='All regions'||X.regionMatches(S.region,r.region))&&Date.parse(r.settledAt)>=cutoff&&Date.parse(r.settledAt)<=Date.now());rows.forEach(r=>settlements.set(r.id,r));return rows;}
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
  function record(c,r){if(!r)return '<p>Requirement not found.</p>';const order=c.S.orders.find(o=>o.id===r.orderId);return `<div class="row spread"><span class="form-note">${r.id}${r.sample?' · Preview requirement':''}</span>${tag(c.esc(r.status))}</div>${requirementFields(c,r)}${['Open','Quoted'].includes(r.status)?quoteRows(c,r):''}${order?`<section class="proc-award"><h3>Selected supplier · ${c.esc(order.provider)}</h3><p>${order.id} · ${c.money(order.total)} · ${c.esc(order.status)}</p><div class="row">${btn('Order details','bill-order',order.id)}${order.paymentStatus!=='Paid'?btn('Review & pay','proc-payment',order.id,'',true):order.status==='Paid'?btn('Confirm delivery details','proc-delivery',order.id,'',true):order.status==='Provisioning'?btn('Verify delivery','proc-verify',order.id,'',true):order.status==='Active'?btn('Manage service','proc-manage',order.id,'',true):btn('View completed order','bill-order',order.id)}</div></section>`:''}<div class="modal-footer">${['Open','Quoted'].includes(r.status)?`${btn('Edit requirement','proc-edit',r.id)}${btn('Close RFQ','proc-close',r.id)}`:''}</div><details class="proc-audit"><summary>Decision history & rejected quotes</summary>${(r.audit||[]).map(a=>`<p>${date(a.at)} · ${c.esc(a.event)}</p>`).join('')||'<p>No decisions yet.</p>'}${(r.quotes||[]).filter(q=>q.status!=='Pending').map(q=>`<p>${c.esc(q.provider)} · ${c.esc(q.status)} · ${c.money(q.price)}</p>`).join('')}</details>`;}
  function input(c,label,name,value,type='text',attributes=''){return `<div><label class="form-label" for="proc-${name}">${label}</label><input class="field" id="proc-${name}" name="${name}" type="${type}" value="${c.esc(value??'')}" ${attributes}></div>`;}
  function country(c,name,value,label='Region / data location'){return `<div><label class="form-label" for="proc-${name}">${label}</label><select class="field" id="proc-${name}" name="${name}" required>${window.OpenNEXTCountries?.options(value)||'<option value="">Country list unavailable</option>'}</select></div>`;}
  function budgetRange(c,r){
    if(model(r)||hardware(r))return '';
    const selected=r.model||c.S.model,chart=window.OpenNEXTHistory?.priceRange?.({...c.S,model:selected});
    const rates=(window.ONMarket?.offers?.({model:selected,term:r.term||c.S.term,region:'All regions'})||[]).filter(o=>!o.stale&&Number(o.price)>0).map(o=>Number(o.price));
    const min=chart?.min??(rates.length?Math.min(...rates):null),max=chart?.max??(rates.length?Math.max(...rates):null),average=chart?.average??(rates.length?rates.reduce((a,b)=>a+b,0)/rates.length:null);
    if(!Number.isFinite(min)||!Number.isFinite(max)||min<=0)return '<div class="proc-range full"><p class="form-note">No current reference range is available for this GPU. Enter your maximum price manually.</p></div>';
    const selectedValue=Number(r.budget)||min;
    return `<div class="proc-range full"><label class="form-label" for="proc-budget-slider">${c.esc(selected)} reference price range</label><input id="proc-budget-slider" type="range" data-proc-budget-range min="${min}" max="${max}" step="0.000001" value="${Math.min(max,Math.max(min,selectedValue))}" ${min===max?'disabled':''}><div class="row spread"><span>Low ${c.money(min)}</span>${Number.isFinite(average)?'<span>Average '+c.money(average)+'</span>':''}<span>High ${c.money(max)}</span></div><p class="form-note">USD / GPU-hour · Observed market prices, not a guaranteed quote. You may enter a higher maximum for urgent requirements.</p></div>`;
  }
  function form(c,r={},editing=false){
   const isModel=model(r),isHardware=hardware(r),S=c.S,chosen=X.get(r.originSupply);
   const fields=[
   input(c,'Requirement name','title',r.title||'','text','required maxlength="140"'),
   input(c,S.role==='Broker'?'Client / mandate reference':'Project / cost centre','project',r.project||'','text','required maxlength="120"'),
   input(c,'GPU / model','model',r.model||S.model,'text',`required ${r.originSupply?'readonly':''}`),
   country(c,'region',r.region||S.region),
   isModel?input(c,'Input volume (million tokens)','inputMillion',r.inputMillion??1,'number','min="0" step="0.000001" required')+input(c,'Output volume (million tokens)','outputMillion',r.outputMillion??1,'number','min="0" step="0.000001" required')+input(c,'Service duration (days)','days',r.days||30,'number','min="1" max="1095" required')+input(c,'Required TPS','tps',r.tps||'','number','min="1"'):input(c,'GPU quantity','count',r.count||S.count||8,'number','min="1" max="4096" step="1" required')+(isHardware?input(c,'Condition','condition',r.condition||'Brand new','text','required'):input(c,'Duration (hours)','hours',r.hours||72,'number','min="1" max="26280" required')),
   isHardware?'<input type="hidden" name="term" value="Physical GPU">':`<div><label class="form-label">Market terms</label><select class="field" name="term">${(isModel?['Authorized API access','Native allocation','Hosted inference']:['Spot','On-demand','Reserved']).map(v=>`<option ${v===(r.term||S.term)?'selected':''}>${v}</option>`).join('')}</select></div>`,
   input(c,isModel?'Maximum total budget (USD)':isHardware?'Maximum unit price (USD / GPU)':'Maximum USD / GPU-hour','budget',r.budget??'','number','min="0.01" step="0.01" required'),
   budgetRange(c,r),
   input(c,isHardware?'Required arrival (UTC)':'Required start (UTC)','start',isoInput(r.start),'datetime-local','required'),
   input(c,'Quotes due (UTC)','quoteDeadline',isoInput(r.quoteDeadline||Date.now()+12*3600000),'datetime-local','required'),
   isHardware?input(c,'Shipping destination / address','shippingAddress',r.shippingAddress||'','text','required maxlength="600"')+input(c,'Incoterms / shipping responsibility','incoterms',r.incoterms||'DAP · taxes and fees to confirm')+input(c,'Warranty and return requirements','warranty',r.warranty||'Warranty, authenticity and inspection terms required'):isModel?input(c,'Access and data policy requirements','accessPolicy',r.accessPolicy||'Authorized access; data location and retention to confirm'):input(c,'Network / interconnect','network',r.network||'')+input(c,'Storage capacity / type','storage',r.storage||'')+input(c,'Runtime / OS / image','image',r.image||''),
   input(c,isHardware?'Inspection / support requirements':'SLA / support needs','sla',r.sla||''),
   input(c,'Delivery / access method','deliveryMethod',r.deliveryMethod||X.deliveryMethod(r)),
   `<div><label class="form-label">Urgency</label><select class="field" name="urgency">${['Standard','High urgency','Flexible start'].map(v=>`<option ${v===r.urgency?'selected':''}>${v}</option>`).join('')}</select></div>`,
   `<div><label class="form-label">Visibility</label><select class="field" name="visibility" ${r.originSupply?'disabled':''}>${['Public requirements','Private RFQ'].map(v=>`<option ${v===(r.originSupply?'Private RFQ':r.visibility)?'selected':''}>${v}</option>`).join('')}</select></div>`,
   S.role==='Broker'?input(c,'Represented client','client',r.client||'','text','required maxlength="120"'):''
   ];
   return `<form data-form="proc-rfq" data-id="${editing?r.id:''}"><input type="hidden" name="kind" value="${X.kindOf(r)}"><input type="hidden" name="originSupply" value="${c.esc(r.originSupply||'')}"><input type="hidden" name="sku" value="${c.esc(r.sku||'')}">${r.originSupply?`<div class="callout">Selected supply · ${c.esc(chosen?.provider||r.originSupply)}. This request goes to this supplier, not to the public RFQ board.</div>`:''}${isModel&&chosen?`<p class="form-note">Listed rates: input $${Number(chosen.price)} / 1M tokens · output $${Number(chosen.outputPrice)} / 1M tokens. Total depends on your input and output volumes; final terms require a quote.</p>`:''}<div class="form-grid">${fields.join('')}<div class="full"><label class="form-label">${isHardware?'Hardware specifications and acceptance requirements':'Workload and acceptance requirements'}</label><textarea class="field" name="notes" rows="4" maxlength="4000" required>${c.esc(r.notes||'')}</textarea></div></div><label class="row form-note"><input type="checkbox" name="shareClosingPrice" ${r.shareClosingPrice!==false?'checked':''}>Share the awarded price with participating suppliers after the RFQ closes.</label>${S.role==='Broker'?'<label class="row form-note"><input type="checkbox" name="mandateConfirmed" required>I am authorized to request quotes for this client.</label>':''}<p class="form-note">No payment is taken. A supplier quote confirms the exact capacity, availability window and payable amount.</p><div class="modal-footer">${btn('Cancel','close-modal')}<button class="btn" type="submit">${editing?'Save requirement':r.originSupply?'Request supplier quote':'Post RFQ'}</button></div></form>`;
  }
  function orderAction(c,type,o){
    if(!o)return {title:'Order unavailable',body:'The order could not be found.'};
    const title=type==='proc-payment'?'Review payment':type==='proc-delivery'?'Delivery details':type==='proc-verify'?'Verify delivery':'Manage service';
    const summary='<div class="details-grid">'+[['Order',o.id],['Resource',o.model],['Region',o.region],['Quantity',o.count+' GPU'],['Order total',c.money(o.total)],['Payment',o.paymentStatus||'Unpaid'],['Service starts',date(o.serviceStart)],['Service ends',date(o.serviceEnd)]].map(([label,value])=>field(c,label,value)).join('')+'</div>';
    const note=type==='proc-payment'?'Secure order checkout is not connected yet. The payment provider must confirm payment before provisioning begins. No funds have been charged.':type==='proc-delivery'?'Delivery begins after verified payment and backend provisioning. Access details will be attached to this order by the delivery integration.':type==='proc-verify'?'Acceptance checks become available after the backend confirms delivery. Browser actions cannot create or activate GPU instances.':'Manage active capacity in My Instances. The backend verifies service windows, access rights and utilization before changes are allowed.';
    return {title:title+' · '+o.id,body:summary+'<div class="callout">'+note+'</div><div class="modal-footer">'+(type==='proc-payment'?'<button class="btn" type="button" disabled title="Order payment integration is pending">Proceed to payment</button>':'')+'<button class="btn secondary" type="button" data-nav="'+(type==='proc-manage'?'instances':'billing')+'">'+(type==='proc-manage'?'My Instances':'Open billing')+'</button></div>'};
  }
  function responseDialog(c,req){
    if(!req)return {title:'RFQ unavailable',body:'This RFQ is no longer available.'};
    const choices=c.S.listings.filter(s=>s.status==='Published'&&s.model===req.model&&s.region===req.region);
    return {title:'Respond to '+req.id,wide:true,body:'<p class="form-note">'+c.esc(req.model)+' · '+req.count+' GPU · '+c.esc(req.region)+'</p>'+(choices.length?'<form data-form="proc-response" data-id="'+req.id+'"><div class="form-grid"><div><label class="form-label">Verified supply</label><select class="field" name="supplyId" required>'+choices.map(s=>'<option value="'+s.id+'">'+c.esc(s.model)+' · '+s.count+' GPU · '+s.id+'</option>').join('')+'</select></div>'+input(c,'Your unit price (USD / GPU-hour)','rate','','number','required min="0.01" step="0.01"')+input(c,'Delivery lead time (minutes)','delivery','','number','required min="1"')+input(c,'Quote valid until (UTC)','validUntil','','datetime-local','required')+'<div class="full"><label class="form-label">Commercial and service terms</label><textarea name="notes" class="field" required maxlength="4000"></textarea></div></div><p class="form-note">The buyer sees your price plus the 5% platform markup. Only verified installed capacity can be quoted.</p><div class="modal-footer"><button class="btn" type="submit">Submit quote</button></div></form>':'<div class="callout">Publish matching, agent-verified capacity before responding to this requirement.</div>'+btn('List matching supply','new-supply'))};
  }
  function listingDialog(c,type,item){
    if(!item)return {title:'Record unavailable',body:'Refresh the market to load this record.'};
    const canAct=item.side==='supply'?c.S.role==='Buyer':c.S.role==='Seller';
    return {title:item.model+' · '+item.provider,body:'<div class="details-grid">'+[['Side',type==='proc-settlement'?'Settled':item.side],['Region',item.region],['Price',c.money(item.price)+unit(item)],['Capacity',item.count+' GPU'],['Term',item.term],['Duration',item.hours+' hours'],['Counterparty',item.provider],['Date',date(item.settledAt||item.created)]].map(([label,value])=>field(c,label,value)).join('')+'</div><p class="proc-notes">'+c.esc(item.description||'')+'</p>'+(type==='proc-listing'&&canAct?'<div class="modal-footer">'+btn(item.side==='supply'?'Buy capacity':'Offer capacity','proc-opportunity',item.id,'data-intent="'+(item.side==='supply'?'buy':'offer')+'"',true)+'</div>':'')};
  }
  function responseRecord(c,response){
    if(!response)return {title:'Response unavailable',body:'The response could not be found.'};
    return {title:'Supplier response · '+response.id,body:'<div class="details-grid">'+[['RFQ',response.rfqId],['Your unit price',c.money(response.netPrice??response.rate)],['Buyer unit price',c.money(response.buyerPrice)],['Status',response.status],['Valid until',date(response.validUntil)],['Verified supply',response.supplyId]].map(([label,value])=>field(c,label,value)).join('')+'</div><p class="proc-notes">'+c.esc(response.notes)+'</p><p class="form-note">The buyer reviews this quote in their account. Acceptance and payment are separate verified steps.</p>'+(response.orderId?btn('View order','bill-order',response.orderId):'')};
  }
  function modal(c,type,extra){
   if(type==='proc-submission'){
    const receipt=extra.receipt,confirmed=!!receipt,supply=extra.recordKind==='supply';
    const title=extra.demo?'Demo submission saved':confirmed?'Submission received':'Submission saved';
    return {title,body:'<p class="form-note">'+(extra.demo?'This record belongs only to your isolated test workspace. It is not a production submission.'+(confirmed?' Operations can find it in Console under Demo submissions while this workspace is active.':''):confirmed?'Your '+(supply?'capacity submission':'RFQ')+' is available in the OpenNEXT operations inbox.':'The server saved your record. A Console receipt has not been confirmed by the connected backend.')+'</p><div class="details-grid">'+[['Record',extra.id],['Operations receipt',receipt?.receiptId||'Not confirmed'],['Received',receipt?date(receipt.receivedAt):'Not confirmed'],['Version',receipt?.revision||'—'],['Marketplace status',extra.recordStatus]].map(([label,value])=>field(c,label,value)).join('')+'</div><div class="callout">'+(supply?'Receipt does not publish capacity. KYB approval and verified agent installation are still required.':'Receipt does not confirm a supplier match or place an order. Your RFQ can now be tracked in My RFQs.')+'</div>'+(extra.warnings||[]).map(message=>'<p class="form-note" role="status">'+c.esc(message)+'</p>').join('')+'<div class="modal-footer">'+btn('Close','close-modal')+btn(supply?'View My Supply':'View My RFQs','proc-submission-view',extra.recordKind,'',true)+'</div>'};
   }
   if(type==='proc-history-upgrade')return {title:'More market history',body:'<p class="form-note">Historical data for up to 3 months is free. Contact Sales for access to 6M, 1Y or all available history.</p><div class="modal-footer">'+btn('Not now','close-modal')+btn('Contact Sales','proc-contact-sales','','',true)+'</div>'};
   const S=c.S,r=extra.requirement||S.rfqs.find(r=>r.id===extra.id),q=r?.quotes?.find(q=>q.id===extra.quoteId);
   if(type==='review')return reviewDialog(c);
   if(type==='supply-form'||type==='supply-type')return supplyForm(c);
   if(type==='proc-supply-status'||type==='listing'){const view=supplyStatus(c,extra.id);view.body=receiptDetails(c,S.listings.find(row=>row.id===extra.id))+view.body;return view;}
   if(type==='rfq'||type==='model-rfq')return {title:r?.title||'Requirement',body:receiptDetails(c,r)+record(c,r),wide:true};
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
  function opportunity(c,id,intent){
    const item=X.get(id);if(!item){c.toast('Listing unavailable. Refresh the market.');return;}
    const user=window.OpenNEXTAuth?.getUser?.();
    if(user&&((intent==='offer'&&c.S.role!=='Seller')||(intent==='buy'&&c.S.role!=='Buyer'))){c.toast(intent==='offer'?'Use a verified Seller account to offer capacity.':'Use a Buyer account to request this capacity.');return;}
    c.S.pendingOpportunity={id,intent};c.persist();
    if(!c.S.auth){c.go(intent==='offer'?'supply':'rfqs');return;}
    if(intent==='buy'){runServer(c,null,async()=>{await X.api('/api/marketplace/quote-interest','POST',{supplyId:id});resume(c);});}
    else resume(c);
  }
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
     case'proc-contact-sales':S.modal=null;c.render();window.OpenNEXTContact?.open();return true;
     case'proc-submission-view':S.modal=null;c.go(id==='supply'?'supply':'rfqs');return true;
     case'new-supply':if(S.role!=='Seller'){c.toast('Only Seller accounts can list supply.');return true;}c.open(S.review?.status==='Approved'?'supply-form':'review');return true;
     case'review':if(S.role!=='Seller'){c.toast('Supplier review is available to Seller accounts.');return true;}c.open('review');return true;
     case'proc-kyb-revise':S.review={...S.review,status:'Draft'};c.open('review');return true;
     case'proc-supply-status':c.open('proc-supply-status',{id});return true;
     case'proc-agent-request':runServer(c,b,async()=>{const result=await X.api('/api/marketplace/supplies/'+encodeURIComponent(id)+'/agent','POST',{});c.toast(result.message);});return true;
     case'proc-refresh':runServer(c,b,async()=>{});return true;
     case'proc-reject':case'proc-accept-confirm':
       runServer(c,b,async()=>{if(!r?.serverRecord||!q)throw Error('Refresh the verified quotation record.');await X.api('/api/marketplace/rfqs/'+encodeURIComponent(r.id)+'/quotes/'+encodeURIComponent(q.id)+'/'+(act==='proc-reject'?'reject':'accept'),'POST',{});c.toast(act==='proc-reject'?'Quote rejected.':'Supplier selected. The order awaits payment integration.');});return true;
     case'proc-sample-quotes':case'proc-response-test':case'proc-response-accept':case'proc-seller-progress':case'proc-pay-confirm':case'proc-complete':case'proc-close':
       c.toast('This action requires a verified backend transaction. Contact operations for assistance.');return true;

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
     case'proc-kyb':
      runServer(c,formEl.querySelector('[type="submit"]'),async()=>{await X.api('/api/marketplace/kyb','POST',{...data,eligibility:!!data.eligibility,rightsConfirmed:!!data.rightsConfirmed});S.modal=null;c.toast('Your supplier review is in progress. You will be notified when the review is complete.');});return true;
     case'proc-supply':
      void submitRecord(c,formEl,'supply',data);return true;
     case'proc-rfq':
      void submitRecord(c,formEl,'rfq',data);return true;
     case'proc-response':
      runServer(c,formEl.querySelector('[type="submit"]'),async()=>{await X.api('/api/marketplace/rfqs/'+encodeURIComponent(id)+'/quotes','POST',{...data,validUntil:new Date(data.validUntil+'Z').toISOString()});S.modal=null;c.toast('Your quote has been submitted to the buyer.');});return true;
     case'proc-delivery':case'proc-verify':c.toast('Delivery must be confirmed by the backend provisioning integration.');return true;

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
if(typeof document!=='undefined')document.addEventListener('input',event=>{
    if(event.target.matches('[data-proc-budget-range]')){const field=event.target.closest('form')?.querySelector('[name="budget"]');if(field)field.value=Number(event.target.value).toFixed(2);}
    if(event.target.matches('[data-proc-net-price]')){const value=event.target.closest('form')?.querySelector('[data-proc-buyer-price]');if(value)value.textContent=Number(event.target.value)>0?'$'+(Number(event.target.value)*1.05).toFixed(2):'—';}
  });
  if(typeof document!=='undefined')document.addEventListener('change',event=>{
    if(!event.target.matches('[data-proc-days]')||!marketContext)return;
    const value=event.target.value,days=Number(value);
    if(['180','365','all'].includes(value)){
      event.target.value=String(settlementDays);marketContext.open('proc-history-upgrade');
    }else if([1,3,7,30,90].includes(days)){
      settlementDays=days;marketContext.render();
    }else event.target.value=String(settlementDays);
  });
  window.OpenNEXTProcurement={page,modal,action,submit,matches,listingTable,supplyPage,supplyExtra,supplyDemand,opportunity,resume,notifications};
})();
