(() => {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-GB',{timeZone:'UTC'})+' UTC':'Not provided';
  const present=value=>value!==null&&value!==undefined&&value!=='';
  const receivedReceipt=r=>r.submission?.status==='Received'&&typeof r.submission.receiptId==='string'&&r.submission.receiptId.trim().length>0&&Number.isFinite(Date.parse(r.submission.receivedAt));
  const money=value=>present(value)&&Number.isFinite(Number(value))?'$'+Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:6}):'Not provided';
  const number=value=>present(value)&&Number.isFinite(Number(value))?Number(value).toLocaleString('en-US'):'Not provided';
  const empty=()=>({rfqs:[],supplies:[],kyb:[],featured:[]});
  const labels={rfqs:'Buyer RFQs',supplies:'Supplier capacity',kyb:'Supplier KYB',featured:'Homepage review'};
  const markets={gpu_rental:'GPU rental',model_capacity:'Model capacity',physical_gpu:'Physical GPUs'};
  const kind=r=>({rental:'gpu_rental',model:'model_capacity',hardware:'physical_gpu'}[r.kind]||r.kind||'gpu_rental');
  const unit=r=>kind(r)==='model_capacity'?'USD total request':kind(r)==='physical_gpu'?'USD / GPU':'USD / GPU-hour';
  const quantity=r=>kind(r)==='model_capacity'?(present(r.inputMillion)||present(r.outputMillion)?`${present(r.inputMillion)?number(r.inputMillion)+'M':'Unspecified'} input / ${present(r.outputMillion)?number(r.outputMillion)+'M':'unspecified'} output tokens`:'Token allocation not provided'):`${number(r.count)} GPUs`;
  const duration=r=>kind(r)==='model_capacity'?(present(r.days)?number(r.days)+' days':'Service duration not provided'):kind(r)==='physical_gpu'?'One-time hardware purchase':number(r.hours)+' hours';
  let root,controller,dialog,refreshTimer,pendingRefresh,lastSuccess='',lastError='',accessDenied=false,returnFocus;
  let scope='production',tab='rfqs',query='',reviewFilter='Current',statusFilter='All',kindFilter='All',data=empty();

  const demo=()=>scope==='demo';
  const visibleTabs=()=>Object.entries(labels).filter(([key])=>!demo()||key!=='featured');
  const heading=()=>demo()?'Demo submissions · '+labels[tab]:labels[tab];
  const workspace=r=>demo()?`<small class="market-demo-workspace">${esc(r.workspaceId)}</small><small>Expires ${date(r.workspaceExpiresAt)}</small>`:'';
  function render(selected='rfqs',options={}){
    const nextScope=options.scope==='demo'?'demo':'production';if(nextScope!==scope){query='';kindFilter='All';statusFilter='All';}scope=nextScope;
    tab=labels[selected]&&(!demo()||selected!=='featured')?selected:'rfqs';
    return `<section class="on-marketplace-console"><div class="page-head"><div><h1>${heading()}</h1><p>${demo()?'Test submissions from isolated guest workspaces. Never mixed with production.':'Terminal submissions, account details and operational review in one place.'}</p></div><button class="btn" data-market-action="refresh">Refresh</button></div>${demo()?'<div class="market-console-demo-banner"><strong>DEMO · TEST ONLY</strong><p>Only submissions made by demo users appear here; catalog fixtures are excluded. Workspaces expire automatically. Demo KYB review enables listing tests only, not real identity verification, payments or infrastructure.</p></div>':''}<div class="market-console-status" role="status" hidden></div><div class="market-console-sync" aria-live="polite">Waiting for a server snapshot.</div><section class="panel"><div class="market-console-toolbar"><div class="market-console-tabs">${visibleTabs().map(([key,label])=>`<button class="btn ${key===tab?'primary':''}" data-market-tab="${key}">${label} <span data-market-count="${key}">0</span></button>`).join('')}</div><div class="market-console-filters"><input class="field" type="search" data-market-query aria-label="Search submissions" placeholder="Search ID, model, country, company or account…"><select class="field" data-market-kind aria-label="Market type"><option value="All">All markets</option>${Object.entries(markets).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select><select class="field" data-market-status aria-label="Marketplace status"><option value="All">All statuses</option></select><select class="field" data-review-filter aria-label="Homepage review status" hidden>${['Current','Pending','Approved','Rejected','History'].map(value=>`<option value="${value}">${value==='Current'?'All current candidates':value==='History'?'Superseded history':value}</option>`).join('')}</select></div></div><div class="market-console-results" aria-live="polite"></div><div class="market-console-table"><p>Loading private records…</p></div></section><p class="form-note">${demo()?'Demo records cannot be published to the live marketplace or homepage. Approval affects only the selected test workspace; agent installation is not simulated.':'Received confirms a server-recorded submission, not publication or approval. KYB, agent installation and homepage review remain separate. Production records only; demo workspaces are isolated.'}</p></section>`;
  }
  function notice(message){if(!root)return;const el=root.querySelector('.market-console-status');el.hidden=!message;el.textContent=message;}
  function syncStatus(){
    if(!root)return;
    const button=root.querySelector('[data-market-action="refresh"]');
    if(button){button.disabled=!!pendingRefresh;button.textContent=pendingRefresh?'Refreshing…':'Refresh';}
    const el=root.querySelector('.market-console-sync');
    if(el)el.textContent=(lastSuccess?'Last synced '+date(lastSuccess)+'. ':'No successful server sync yet. ')+(lastError?'Updates are unavailable; the last successful snapshot may be out of date.':'Refreshes every 30 seconds while this page is visible.');
  }
  async function api(path,method='GET',body){
    const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',signal:controller?.signal,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const result=await response.json().catch(()=>({error:'Unable to read the server response.'}));
    if(!response.ok){const error=Error(result.error||'Request failed.');error.status=response.status;throw error;}
    return result;
  }
  function receipt(r){
    const received=receivedReceipt(r);
    return `<span class="market-receipt ${received?'received':'recorded'}">${received?'Received':'Recorded'}</span><small>${received?esc(r.submission.receiptId):'Receipt not available'}</small><small>${date(received?r.submission.receivedAt:r.createdAt)}</small>${r.submission?.updatedAt&&r.submission.updatedAt!==r.submission.receivedAt?'<small>Updated '+date(r.submission.updatedAt)+'</small>':''}`;
  }
  function account(r){return `<small>${esc(r.ownerName||r.accountName||'')}</small><small>${esc(r.company||r.ownerCompany||'')}</small><small>${esc(r.ownerEmail||r.email||'Account email unavailable')}</small>`;}
  function rowPrice(r){return tab==='rfqs'?money(r.budget):money(r.netPrice)+' / '+money(r.buyerPrice);}
  function statusOptions(){
    const select=root.querySelector('[data-market-status]');
    const values=[...new Set((data[tab]||[]).map(r=>r.status).filter(Boolean))].sort();
    if(statusFilter!=='All'&&!values.includes(statusFilter))statusFilter='All';
    select.innerHTML='<option value="All">All statuses</option>'+values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');select.value=statusFilter;
  }
  function update(){
    if(!root?.isConnected)return;
    root.querySelector('h1').textContent=heading();
    root.querySelectorAll('[data-market-tab]').forEach(b=>b.classList.toggle('primary',b.dataset.marketTab===tab));
    root.querySelectorAll('[data-market-count]').forEach(el=>{el.textContent=String((data[el.dataset.marketCount]||[]).length);});
    root.querySelector('[data-review-filter]').hidden=tab!=='featured';
    root.querySelector('[data-market-kind]').hidden=!['rfqs','supplies'].includes(tab);
    root.querySelector('[data-market-status]').hidden=tab==='featured';statusOptions();
    if(accessDenied){root.querySelector('.market-console-results').textContent='';root.querySelector('.market-console-table').innerHTML='<div class="market-console-empty"><h3>Administrator access required</h3><p>Connect the server administrator session to view private marketplace submissions.</p><button class="btn primary" data-market-action="login">Connect administrator session</button></div>';return;}
    if(tab==='featured'){featuredUpdate();return;}
    const rows=(data[tab]||[]).filter(r=>[r.id,r.requestId,r.submission?.receiptId,r.model,r.sku,r.company,r.ownerCompany,r.ownerName,r.ownerEmail,r.email,r.workspaceId,r.region,r.country,r.status,r.title,r.project].join(' ').toLowerCase().includes(query.toLowerCase())&&(statusFilter==='All'||r.status===statusFilter)&&(tab==='kyb'||kindFilter==='All'||kind(r)===kindFilter));
    root.querySelector('.market-console-results').textContent=`${rows.length} of ${(data[tab]||[]).length} records`;
    const columns=tab==='kyb'?['Business / account','Country','Registration','Submitted','Status','']:tab==='rfqs'?['Requirement / account','Market / location','Requested capacity','Maximum price','Console receipt','Marketplace status','']:['Supply / account','Market / location','Offered capacity','Seller / buyer price','Console receipt','Marketplace status',''];
    root.querySelector('.market-console-table').innerHTML=rows.length?`<table><thead><tr>${columns.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>tab==='kyb'?`<tr><td><strong>${esc(r.company)}</strong><small>${esc(r.email)}</small>${workspace(r)}</td><td>${esc(r.country)}</td><td>${esc(r.registration)}</td><td>${date(r.submittedAt)}</td><td><span class="market-status ${r.status==='Reviewing'?'reviewing':''}">${esc(r.status)}</span></td><td><button class="btn small" data-market-action="details" data-id="${esc(r.id)}" data-workspace="${esc(r.workspaceId||'')}">Review submission</button></td></tr>`:`<tr><td><strong>${esc(r.title||r.model)}</strong>${account(r)}<small>${esc(r.id)}</small>${workspace(r)}</td><td><strong>${esc(r.model)}</strong><small>${esc(markets[kind(r)]||kind(r))}</small><small>${esc(r.region)}</small></td><td>${esc(quantity(r))}<small>${esc(duration(r))}</small><small>${esc(r.term)}</small></td><td>${rowPrice(r)}<small>${esc(unit(r))}</small></td><td>${receipt(r)}</td><td><span class="market-status">${esc(r.status)}</span>${tab==='supplies'&&r.agentStatus?'<small>Agent: '+esc(r.agentStatus)+'</small>':''}</td><td><button class="btn small" data-market-action="details" data-id="${esc(r.id)}" data-workspace="${esc(r.workspaceId||'')}">View details</button></td></tr>`).join('')}</tbody></table>`:`<div class="market-console-empty"><strong>${query||statusFilter!=='All'||kindFilter!=='All'?'No matching records':lastSuccess?'No submissions yet':'Submission data unavailable'}</strong><p>${query||statusFilter!=='All'||kindFilter!=='All'?'Try another search or filter.':lastSuccess?demo()?'New demo user submissions will appear here. Catalog fixtures are excluded; expired workspaces are removed.':'Submitted customer RFQs and supply will appear here once the server acknowledges them.':'Connect the backend and refresh to load customer submissions.'}</p></div>`;
  }
  function refresh(){
    if(pendingRefresh)return pendingRefresh;if(!root?.isConnected)return Promise.resolve();
    const requestRoot=root,requestController=controller,requestScope=scope;
    const request=(async()=>{
      try{
        const result=await api(demo()?'/api/admin/demo/marketplace':'/api/admin/marketplace');
        if(root!==requestRoot||controller!==requestController||scope!==requestScope||!root?.isConnected)return;
        if(!result||!(demo()?['rfqs','supplies','kyb']:['rfqs','supplies','kyb','featured']).every(key=>Array.isArray(result[key])))throw Error('The marketplace backend returned an incomplete snapshot.');
        if(demo()?(result.scope!=='demo'||!['rfqs','supplies','kyb'].every(key=>result[key].every(row=>typeof row.workspaceId==='string'&&row.workspaceId))):result.scope==='demo')throw Error('The backend returned records for a different workspace scope.');
        data={...empty(),...result};lastSuccess=Number.isFinite(Date.parse(result.generatedAt))?result.generatedAt:new Date().toISOString();lastError='';accessDenied=false;notice('');update();
      }catch(error){
        if(error.name==='AbortError'||root!==requestRoot||controller!==requestController)return;
        lastError=error.message;if(error.status===401||error.status===403){data=empty();lastSuccess='';accessDenied=true;close();}
        notice(error.message+(lastSuccess?' The last successful snapshot is retained.':''));update();
      }finally{if(controller===requestController){pendingRefresh=null;syncStatus();}}
    })();pendingRefresh=request;syncStatus();return request;
  }
  function close(){const closing=dialog;dialog=null;if(closing){closing.close();closing.remove();}if(returnFocus?.isConnected)returnFocus.focus();returnFocus=null;}
  function modal(title,body){
    close();returnFocus=document.activeElement;const current=document.createElement('dialog');dialog=current;current.className='market-console-dialog';current.innerHTML=`<header><h2>${esc(title)}</h2><button class="btn" data-market-action="close" aria-label="Close dialog">×</button></header>${body}`;document.body.append(current);current.showModal();
    current.addEventListener('click',event=>{event.stopPropagation();click(event);});current.addEventListener('submit',submit);current.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});current.addEventListener('close',()=>{if(dialog===current){dialog=null;current.remove();if(returnFocus?.isConnected)returnFocus.focus();returnFocus=null;}});
  }
  function recordInfo(r){
    const type=kind(r),received=receivedReceipt(r);
    const info=[...(demo()?[['Data scope','Demo · test only'],['Demo workspace',r.workspaceId],['Workspace expires',date(r.workspaceExpiresAt)]]:[]),['Record',r.id],['Account',r.ownerEmail||r.email],['Account name',r.ownerName||r.accountName],['Company',r.company||r.ownerCompany],['Account ID',r.ownerId],['Market',markets[type]||type],['Model / SKU',r.model+(r.sku?' / '+r.sku:'')],['Country / territory',r.region],['Quantity',quantity(r)],['Duration',duration(r)],['Terms',r.term],['Marketplace status',r.status],['Console receipt',received?'Received':'Recorded; receipt unavailable'],['Receipt ID',r.submission?.receiptId],['Submission source',r.submission?.source],['Received',received?date(r.submission.receivedAt):'Not provided'],['Receipt revision',r.submission?.revision],['Client request ID',r.requestId],['Created',date(r.createdAt)],['Updated',date(r.updatedAt||r.submission?.updatedAt)],['Service start',date(r.start||r.serviceStart)],['Service end',date(r.serviceEnd)],['Quote deadline',date(r.quoteDeadline)]];
    if(tab==='supplies')info.push(['Seller net price',money(r.netPrice)+' · '+unit(r)],['Buyer price',money(r.buyerPrice)+' · '+unit(r)],['Buyer markup',present(r.markupPercent)?number(r.markupPercent)+'%':'Not provided'],['Agent status',r.agentStatus],['Source instance',r.resaleOf]);
    else info.push(['Maximum buyer price',money(r.budget)+' · '+unit(r)],['Project',r.project],['Visibility',r.visibility],['Urgency',r.urgency],['Selected supplier offer',r.originSupply],['Share closing price',typeof r.shareClosingPrice==='boolean'?r.shareClosingPrice?'Yes':'No':null]);
    const specific=[['Network / interconnect',r.network],['Storage',r.storage],['System image',r.image],['SLA / acceptance',r.sla],['Delivery method',r.deliveryMethod],['Payment terms',r.paymentTerms],['Access policy',r.accessPolicy],['Required TPS',r.tps],['Condition',r.condition],['Shipping address',r.shippingAddress],['Incoterms',r.incoterms],['Warranty',r.warranty],['Input price / 1M tokens',present(r.inputRate)?money(r.inputRate):null],['Output price / 1M tokens',present(r.outputRate)?money(r.outputRate):null]];
    info.push(...specific.filter(([,value])=>present(value)));
    if(type==='gpu_rental'&&tab==='supplies')info.push(['SSH endpoint','Handled securely by the backend; credentials are not displayed.']);return info;
  }
  function details(id,workspaceId){
    const r=data[tab].find(r=>r.id===id&&(!demo()||r.workspaceId===workspaceId));if(!r)return;if(tab==='featured'){featuredDetails(r);return;}
    const info=tab==='kyb'?[...(demo()?[['Data scope','Demo · test only'],['Demo workspace',r.workspaceId],['Workspace expires',date(r.workspaceExpiresAt)]]:[]),['Company',r.company],['Account',r.email],['Registration',r.registration],['Country',r.country],['Submitted',date(r.submittedAt)],['Status',r.status]]:recordInfo(r);
    modal(r.id,`<div class="market-console-detail">${info.map(([key,value])=>`<div><small>${esc(key)}</small><strong>${esc(present(value)?value:'Not provided')}</strong></div>`).join('')}</div>${tab==='kyb'?`<h3>Business evidence</h3><p class="market-console-notes">${esc(r.evidence)}</p><h3>Supply rights</h3><p class="market-console-notes">${esc(r.rights)}</p>${r.status==='Reviewing'?`<form data-market-form="review" data-id="${esc(r.id)}" data-workspace="${esc(r.workspaceId||'')}"><label>Decision notes<textarea class="field" name="reason" rows="3" maxlength="2000" placeholder="Required when rejecting; optional approval notes"></textarea></label><p class="market-console-error" role="alert" hidden></p><div class="market-console-decisions"><button type="submit" class="btn" name="decision" value="Rejected">Reject</button><button type="submit" class="btn primary" name="decision" value="Approved">${demo()?'Approve Demo KYB & rights':'Approve KYB & rights'}</button></div></form>`:`<p>${esc(r.reason||'Decision recorded.')}</p>`}`:`<h3>Requirements / commercial terms</h3><p class="market-console-notes">${esc(r.notes||'No additional notes supplied.')}</p><p class="form-note">${demo()?'Test-only record. It cannot enter the live marketplace or homepage.':'A Console receipt does not approve this record or publish it on the homepage.'}${tab==='supplies'?' Agent completion is accepted only from the trusted installer integration. Operations cannot simulate success here.':''}</p>${Array.isArray(r.audit)&&r.audit.length?'<h3>Record activity</h3><ol class="market-console-audit">'+r.audit.map(event=>'<li><time>'+date(event.at)+'</time> '+esc(event.event)+'</li>').join('')+'</ol>':''}`}`);
  }
  function click(event){
    const tabButton=event.target.closest('[data-market-tab]');if(tabButton){const selected=tabButton.dataset.marketTab;if(!labels[selected]||(demo()&&selected==='featured'))return;tab=selected;statusFilter='All';update();return;}
    const button=event.target.closest('[data-market-action]');if(!button)return;event.preventDefault();
    if(button.dataset.marketAction==='refresh')void refresh();if(button.dataset.marketAction==='close')close();if(button.dataset.marketAction==='details')details(button.dataset.id,button.dataset.workspace);
    if(button.dataset.marketAction==='login')modal('Administrator session','<form data-market-form="login"><p>Use the server administrator token to create an HTTP-only session.</p><label>Administrator token<input class="field" type="password" name="token" required autocomplete="new-password"></label><p class="market-console-error" role="alert" hidden></p><button type="submit" class="btn primary">Connect</button></form>');
  }
  async function submit(event){
    event.preventDefault();event.stopPropagation();const form=event.target,button=event.submitter;if(!button||button.disabled)return;
    const body=Object.fromEntries(new FormData(form)),error=form.querySelector('.market-console-error');error.hidden=true;button.disabled=true;
    try{
      if(form.dataset.marketForm==='login'){form.querySelector('[name="token"]').value='';await api('/api/admin/pricing/session','POST',{token:body.token});}
      else{if(button.value==='Rejected'&&!body.reason.trim())throw Error('Explain why the submission is being rejected.');const featured=form.dataset.marketForm==='featured';if(demo()&&(featured||!form.dataset.workspace))throw Error('Select a valid demo KYB submission.');await api((demo()?'/api/admin/demo/marketplace/kyb/':'/api/admin/marketplace/'+(featured?'featured/':'kyb/'))+encodeURIComponent(form.dataset.id),'PATCH',{status:button.value,reason:body.reason,...(demo()?{workspaceId:form.dataset.workspace}:{}),...(featured?{fingerprint:form.dataset.fingerprint}:{})});}
      close();await refresh();
    }catch(e){if(error.isConnected){error.textContent=e.message;error.hidden=false;}}finally{if(button.isConnected)button.disabled=false;}
  }
  function visibleRefresh(){if(!document.hidden&&root?.isConnected)void refresh();}
  function destroy(){
    controller?.abort();controller=null;clearInterval(refreshTimer);refreshTimer=null;pendingRefresh=null;
    document.removeEventListener('visibilitychange',visibleRefresh);window.removeEventListener('focus',visibleRefresh);
    close();root=null;data=empty();lastSuccess='';lastError='';accessDenied=false;
  }
  function mount(){
    destroy();root=document.querySelector('.on-marketplace-console');if(!root)return;controller=new AbortController();
    root.addEventListener('click',click,{signal:controller.signal});
    const search=root.querySelector('[data-market-query]');search.value=query;search.addEventListener('input',event=>{query=event.target.value;update();},{signal:controller.signal});
    const review=root.querySelector('[data-review-filter]');review.value=reviewFilter;review.addEventListener('change',()=>{reviewFilter=review.value;update();},{signal:controller.signal});
    const market=root.querySelector('[data-market-kind]');market.value=kindFilter;market.addEventListener('change',()=>{kindFilter=market.value;update();},{signal:controller.signal});
    const status=root.querySelector('[data-market-status]');status.addEventListener('change',()=>{statusFilter=status.value;update();},{signal:controller.signal});
    document.addEventListener('visibilitychange',visibleRefresh);window.addEventListener('focus',visibleRefresh);refreshTimer=setInterval(visibleRefresh,30000);void refresh();
  }
  function featuredUpdate(){
    const rows=(data.featured||[]).filter(row=>{
      const snapshot=row.snapshot||{},matches=[row.id,row.sourceId,row.model,snapshot.title,snapshot.ownerEmail,snapshot.region,row.status].join(' ').toLowerCase().includes(query.toLowerCase());
      return matches&&(reviewFilter==='History'?!row.current:row.current&&(reviewFilter==='Current'||row.status===reviewFilter));
    });
    root.querySelector('.market-console-results').textContent=`${rows.length} of ${(data.featured||[]).length} review records`;
    const note='<div class="market-console-review-note">The highest public buyer budget and lowest seller net price are selected for each GPU model. Only current, approved candidates appear on the homepage. A replacement or material edit requires a new review.</div>';
    root.querySelector('.market-console-table').innerHTML=note+(rows.length?`<table><thead><tr><th>Model / side</th><th>Selected record</th><th>Price · USD / GPU-hour</th><th>Review dates</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(row=>{const snapshot=row.snapshot||{},supply=row.side==='supply';return `<tr><td><strong>${esc(row.model)}</strong><small>${supply?'Supplier offer':'Buyer RFQ'}</small><small>${esc(row.sourceId)}</small></td><td><strong>${esc(snapshot.title)}</strong><small>${esc(snapshot.ownerEmail)}</small><small>${esc(snapshot.region)} · ${snapshot.count} GPU · ${snapshot.hours} hours</small></td><td>${money(supply?snapshot.netPrice:snapshot.price)}<small>${supply?'Lowest seller net price':'Highest maximum buyer price'}</small>${supply?'<small>Buyer price '+money(snapshot.buyerPrice)+' · includes 5%</small>':''}</td><td>${date(row.submittedAt)}${row.reviewedAt?'<small>Reviewed '+date(row.reviewedAt)+'</small>':''}</td><td><span class="market-status ${row.status==='Pending'?'reviewing':row.status==='Rejected'?'rejected':''}">${esc(row.status)}</span>${row.current?'':'<small>Superseded · not displayed</small>'}</td><td><button class="btn small" data-market-action="details" data-id="${esc(row.id)}">${row.current?'Review candidate':'View history'}</button></td></tr>`;}).join('')}</tbody></table>`:'<div class="market-console-empty"><strong>No candidates in this view</strong><p>Eligible public RFQs and published supply are selected automatically, then wait for operations approval.</p></div>');
  }
  function featuredDetails(row){
    const snapshot=row.snapshot||{},supply=row.side==='supply';
    const info=[['Record',row.sourceId],['Account',snapshot.ownerEmail],['Model',row.model],['Side',supply?'Supplier offer':'Buyer RFQ'],['Country',snapshot.region],['Capacity',snapshot.count+' GPUs · '+snapshot.hours+' hours'],['Terms',snapshot.term],['Homepage status',row.current?row.status:row.status+' · superseded'],[supply?'Seller net price':'Maximum buyer price',money(supply?snapshot.netPrice:snapshot.price)],...(supply?[['Buyer-facing price',money(snapshot.buyerPrice)+' · includes 5%']]:[]),['Start',date(snapshot.start)],['End / quote deadline',date(snapshot.serviceEnd||snapshot.quoteDeadline)],['Selected',date(row.submittedAt)],['Reviewed by',row.reviewedBy||'Not reviewed']];
    modal('Homepage candidate · '+row.model,`<div class="market-console-detail">${info.map(([key,value])=>`<div><small>${esc(key)}</small><strong>${esc(value)}</strong></div>`).join('')}</div><h3>Homepage content</h3><strong>${esc(snapshot.title)}</strong><p class="market-console-notes">${esc(snapshot.description)}</p><p class="form-note">Approval applies only to this record and its reviewed price and terms. It cannot transfer to a replacement or material edit.</p>${row.reason?'<p class="market-console-notes">Decision notes: '+esc(row.reason)+'</p>':''}${row.current?`<form data-market-form="featured" data-id="${esc(row.id)}" data-fingerprint="${esc(row.fingerprint)}"><label>Decision notes<textarea class="field" name="reason" rows="3" maxlength="2000" placeholder="Required when rejecting; optional approval notes"></textarea></label><p class="market-console-error" role="alert" hidden></p><div class="market-console-decisions">${row.status!=='Rejected'?`<button type="submit" class="btn" name="decision" value="Rejected">${row.status==='Approved'?'Remove from homepage':'Reject'}</button>`:''}${row.status!=='Approved'?'<button type="submit" class="btn primary" name="decision" value="Approved">Approve for homepage</button>':''}</div></form>`:'<p class="market-console-review-note">This candidate has been superseded. Review the current candidate instead.</p>'}`);
  }
  window.OpenNEXTConsoleMarketplace={render,mount,destroy,refresh};
})();
