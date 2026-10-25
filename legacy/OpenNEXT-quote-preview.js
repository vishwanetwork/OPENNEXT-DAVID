/* Marketplace quote entry and account notifications. The filename is retained for existing entrypoints.
 * Quote submission is delegated to OpenNEXTProcurement's authenticated /api/marketplace/rfqs flow.
 * OpenNEXTDemo rewrites that existing API to its isolated, server-backed Demo session.
 * Notification read/mute preferences are device-local; no email or delivery outcome is invented.
 */
(function (scope) {
  'use strict';
  const MARKER = 'OpenNEXT Terminal quote request';
  const cache = {ctx:null,owner:'',generation:0,pending:null,ready:false,lastLoaded:0,error:'',panel:false,page:0,muted:false,readIds:new Set()};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => {const d=new Date(value);return Number.isFinite(+d)?d.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'UTC'})+' UTC':'Date not available';};
  const bellIcon = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>';
  const user = () => scope.OpenNEXTAuth?.getUser?.();
  function ownerKey() {const u=user();return u?.id&&u.onboardingCompleted?JSON.stringify([u.id,String(u.role).toLowerCase(),!!u.demo||!!scope.OpenNEXTDemo?.active]):'';}
  const prefKey = () => 'opennext-notification-preferences-v1:'+cache.owner;
  function sync(ctx=cache.ctx) {
    if(ctx)cache.ctx=ctx;
    const owner=ownerKey();
    if(owner!==cache.owner){
      cache.owner=owner;cache.generation++;cache.pending=null;cache.ready=false;cache.lastLoaded=0;cache.error='';cache.panel=false;cache.page=0;cache.muted=false;cache.readIds=new Set();
      if(owner)try{const saved=JSON.parse(localStorage.getItem(prefKey())||'{}');cache.muted=saved.muted===true;if(Array.isArray(saved.readIds))cache.readIds=new Set(saved.readIds.filter(x=>typeof x==='string').slice(-3000));}catch{}
    }
    return owner;
  }
  function preferences(){if(cache.owner)try{localStorage.setItem(prefKey(),JSON.stringify({muted:cache.muted,readIds:[...cache.readIds].slice(-3000)}));}catch{}}
  function accountRows(field){
    const u=user(),S=cache.ctx?.S;
    if(!cache.owner||!u?.id||S?.user?.id!==u.id)return [];
    // Server records have ownerId. Role alone does not establish account ownership.
    return (Array.isArray(S[field])?S[field]:[]).filter(row=>row&&(field==='orders'?row.buyerId===u.id||row.sellerId===u.id:row.ownerId===u.id));
  }
  function notices(){
    const unique=new Map();
    for(const n of accountRows('notifications'))if(typeof n.id==='string')unique.set(n.id,{id:n.id,title:n.subject||n.title||'Workspace update',message:n.message||'',createdAt:n.created||n.createdAt||'',read:!!n.read||cache.readIds.has(n.id),orderId:n.orderId,rfqId:n.rfqId,topupId:n.topupId});
    return [...unique.values()].sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0));
  }
  function quoteRequests(){return accountRows('rfqs').filter(r=>['On-demand','Reserved'].includes(r.term)&&(r.requestKind==='quote_request'||String(r.notes||'').includes(MARKER))).sort((a,b)=>(Date.parse(b.createdAt||b.created)||0)-(Date.parse(a.createdAt||a.created)||0));}
  function empty(){return `<div class="qp-empty"><div class="qp-empty-icon">${bellIcon}</div><h3>No notifications yet</h3><p>Quote, review, payment and delivery updates will appear here.</p></div>`;}
  function notificationRows(rows){return rows.map(n=>`<button type="button" class="qp-notification ${n.read?'':'qp-unread'}" data-qp-action="notification" data-qp-id="${esc(n.id)}"><span class="qp-read-dot" aria-label="${n.read?'Read':'Unread'}"></span><span><strong>${esc(n.title)}</strong><span class="qp-notification-copy">${esc(n.message)}</span><time datetime="${esc(n.createdAt)}">${esc(date(n.createdAt))}</time></span></button>`).join('');}
  function errorNotice(){return cache.error?`<p class="qp-service-error" role="status">${esc(cache.error)} <button type="button" class="qp-text-button" data-qp-action="refresh">Retry</button></p>`:'';}
  function bellContents(){
    const rows=notices(),unread=rows.filter(n=>!n.read).length;
    return `<button type="button" class="qp-bell" data-qp-action="bell" aria-label="Notifications${unread?', '+unread+' unread':''}${cache.muted?', alerts muted on this device':''}" aria-expanded="${cache.panel}" aria-controls="qp-notification-dropdown">${bellIcon}${unread&&!cache.muted?`<span class="qp-count">${unread>99?'99+':unread}</span>`:''}</button>${cache.panel?`<section class="qp-dropdown" id="qp-notification-dropdown" aria-label="Latest notifications"><header><strong>Notifications</strong><button type="button" class="qp-text-button" data-qp-action="mute" title="Mute the notification badge on this device; email settings are unchanged">${cache.muted?'Unmute':'Mute'}</button><button type="button" class="qp-text-button" data-qp-action="read-all" ${unread?'':'disabled'}>${unread?'Mark all as read':'All marked as read'}</button></header><div class="qp-notification-list">${errorNotice()}${rows.length?notificationRows(rows.slice(0,10)):!cache.ready&&cache.pending?'<p class="qp-service-error">Loading notifications…</p>':empty()}</div><footer><span>${cache.muted?'Alerts muted on this device':'Latest 10 updates'}</span><button type="button" class="qp-text-button" data-qp-action="more">More <span aria-hidden="true">→</span></button></footer></section>`:''}`;
  }
  function bell(ctx){sync(ctx);return `<div class="qp-bell-shell" data-qp-bell-shell>${bellContents()}</div>`;}
  function historyContents(){
    const rows=notices(),unread=rows.some(n=>!n.read);cache.page=Math.min(cache.page,Math.max(0,Math.ceil(rows.length/20)-1));
    return `<div class="qp-page-heading"><div><h1>Notifications</h1><p>Account updates and quote decisions in one place.</p></div><button type="button" class="btn secondary" data-qp-action="read-all" ${unread?'':'disabled'}>Mark all as read</button></div><div class="qp-history-panel">${errorNotice()}${rows.length?notificationRows(rows.slice(cache.page*20,(cache.page+1)*20)):empty()}</div><div class="qp-pagination"><span>${rows.length?`${cache.page*20+1}–${Math.min((cache.page+1)*20,rows.length)} of ${rows.length} notifications`:'No previous updates'}</span><button type="button" class="btn secondary small" data-qp-action="previous" ${cache.page?'':'disabled'}>Previous</button><button type="button" class="btn secondary small" data-qp-action="next" ${(cache.page+1)*20>=rows.length?'disabled':''}>Next</button></div><p class="qp-request-empty">Read and mute preferences are saved on this device. Email delivery depends on the configured notification service.</p>`;
  }
  function history(ctx){sync(ctx);return `<div class="page-content qp-page" data-qp-history>${historyContents()}</div>`;}
  function visibleStatus(r){return r.reviewStatus==='Approved'&&['Open','Quoted'].includes(r.status)?(r.visibility==='Private RFQ'?'Approved · Private RFQ':'Live RFQ'):r.status||'Status unavailable';}
  function requestsContents(){
    const rows=quoteRequests();
    return `<div class="qp-request-heading"><div><h2>Quote requests</h2><p>On-demand and Reserved requirements. Operations approval is required before publication.</p></div></div>${rows.length?`<div class="qp-table-scroll"><table class="qp-request-table"><thead><tr><th>Request</th><th>Resource</th><th>Term</th><th>Quantity</th><th>Submitted</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.id)}<small>${esc(r.project)}</small></td><td><strong>${esc(r.model)}</strong><small>${esc(r.region)}</small></td><td>${esc(r.term)}<small>${esc(r.hours)} hours</small></td><td>${esc(r.count)} GPUs</td><td>${esc(date(r.createdAt||r.created))}</td><td><span class="qp-status">${esc(visibleStatus(r))}</span></td><td><button type="button" class="btn secondary small" data-qp-action="request" data-qp-id="${esc(r.id)}">View details</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="qp-request-empty">Choose <strong>Ask for quote</strong> on an On-demand or Reserved resource to send your requirements.</p>'}`;
  }
  function requests(ctx){sync(ctx);return `<section class="qp-requests" data-qp-requests>${requestsContents()}</section>`;}
  function updateViews(){
    sync();
    const active=document.activeElement,focusAction=active?.dataset?.qpAction,focusId=active?.dataset?.qpId,container=active?.closest?.('[data-qp-bell-shell],[data-qp-history],[data-qp-requests]');
    document.querySelectorAll('[data-qp-bell-shell]').forEach(el=>{el.innerHTML=bellContents();});
    document.querySelectorAll('[data-qp-history]').forEach(el=>{el.innerHTML=historyContents();});
    document.querySelectorAll('[data-qp-requests]').forEach(el=>{el.innerHTML=requestsContents();});
    if(container?.isConnected&&focusAction)[...container.querySelectorAll('[data-qp-action]')].find(el=>el.dataset.qpAction===focusAction&&(!focusId||el.dataset.qpId===focusId))?.focus({preventScroll:true});
  }
  async function refresh(force=false){
    const owner=sync(),generation=cache.generation,ctx=cache.ctx;
    if(!owner||!ctx||ctx.S?.user?.id!==user()?.id)return;
    if(cache.pending)return cache.pending;
    if(!force&&Date.now()-cache.lastLoaded<15000){updateViews();return;}
    const job=(async()=>{
      try{
        if(!scope.OpenNEXTExchange?.api)throw Error('Account updates are temporarily unavailable.');
        const result=await scope.OpenNEXTExchange.api('/api/marketplace/me');
        if(ownerKey()!==owner||cache.generation!==generation||cache.ctx?.S?.user?.id!==user()?.id)return;
        if(!Array.isArray(result.notifications)||!Array.isArray(result.rfqs))throw Error('The account response was incomplete. Refresh to try again.');
        if(scope.OpenNEXTExchange.mergeNotifications)scope.OpenNEXTExchange.mergeNotifications(cache.ctx.S,result.notifications);
        else cache.ctx.S.notifications=result.notifications.filter(n=>n.ownerId===user().id);
        cache.ctx.S.rfqs=result.rfqs.filter(r=>r.ownerId===user().id);
        cache.ready=true;cache.error='';cache.lastLoaded=Date.now();
      }catch(error){if(ownerKey()===owner&&cache.generation===generation)cache.error=error.message||'Account updates are temporarily unavailable.';}
      finally{if(cache.generation===generation){cache.pending=null;updateViews();}}
    })();cache.pending=job;return job;
  }
  const bounded=(value,max)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
  function prefill(offer){
    if(!offer||!['On-demand','Reserved'].includes(offer.term))throw Error('Choose an On-demand or Reserved resource to request a quote.');
    const model=bounded(offer.model,100);if(!model)throw Error('The selected resource has no model. Refresh the market.');
    const countries=scope.OpenNEXTCountries?.list||[],aliases={UAE:'AE',UK:'GB',USA:'US','Hong Kong':'HK','South Korea':'KR'};
    const raw=bounded(offer.country,100),lookup=aliases[raw]||raw;
    const country=countries.find(c=>c.code===lookup||c.name===lookup)?.name||'';
    const positive=(value,max,integer=false,min=0.000001)=>{const number=Number(value);return value!=null&&value!==''&&Number.isFinite(number)&&number>=min&&number<=max&&(!integer||Number.isInteger(number))?number:null;};
    const gpu=positive(offer.gpuCount,4096,true,1),vcpu=positive(offer.vcpu,65536,true,1),memory=positive(offer.memory,65536,false,0.01),price=positive(offer.perGpuHourly,1000000);
    const selectedOffer={id:bounded(offer.id,160),model,country:raw,term:offer.term,gpuCount:gpu,vcpu,memory,perGpuHourly:price,instanceHourly:positive(offer.instanceHourly,1000000000)};
    return {kind:'gpu_rental',requestKind:'quote_request',model,region:country,term:offer.term,count:gpu||8,vcpu:vcpu??'',memory:memory??'',budget:price??'',notes:'',selectedOffer,visibility:'Public requirements',shareClosingPrice:false};
  }
  function open(ctx,offer){
    sync(ctx);const u=user();
    if(!u?.onboardingCompleted||ctx.S?.user?.id!==u.id){ctx.toast?.('Sign in and complete your account setup to request a quote.');ctx.go?.('rfqs');return false;}
    if(String(u.role).toLowerCase()!=='buyer'){ctx.toast?.('Use a Buyer account to request capacity.');return false;}
    if(!scope.OpenNEXTProcurement?.modal||!scope.OpenNEXTExchange?.api){ctx.toast?.('The quote request service is temporarily unavailable.');return false;}
    try{const fields=prefill(offer);cache.panel=false;ctx.open('rfq-form',{prefill:fields});return true;}catch(error){ctx.toast?.(error.message);return false;}
  }
  function markRead(ids){for(const n of notices())if(!ids||ids.includes(n.id))cache.readIds.add(n.id);preferences();updateViews();}
  async function action(button){
    sync();const act=button.dataset.qpAction,ctx=cache.ctx;if(!ctx)return;
    if(act==='bell'){cache.panel=!cache.panel;updateViews();if(cache.panel)await refresh(true);return;}
    if(act==='more'){cache.panel=false;cache.page=0;ctx.go('notifications');await refresh(true);return;}
    if(act==='previous'||act==='next'){cache.page=Math.max(0,cache.page+(act==='next'?1:-1));updateViews();return;}
    if(act==='refresh'){await refresh(true);return;}
    if(act==='mute'){cache.muted=!cache.muted;preferences();updateViews();return;}
    if(act==='read-all'){markRead();return;}
    if(act==='request'){const row=quoteRequests().find(r=>r.id===button.dataset.qpId);if(row)ctx.open('proc-request-details',{id:row.id});else ctx.toast?.('Refresh your RFQs to load this request.');return;}
    if(act==='notification'){
      const n=notices().find(row=>row.id===button.dataset.qpId);if(!n)return;
      markRead([n.id]);cache.panel=false;updateViews();
      if(n.topupId)ctx.open('payment-topup-status',{id:n.topupId});
      else if(n.orderId){if(accountRows('orders').some(o=>o.id===n.orderId))ctx.open('bill-order',{id:n.orderId});else ctx.go('billing');}
      else if(n.rfqId&&accountRows('rfqs').some(r=>r.id===n.rfqId))ctx.open('proc-request-details',{id:n.rfqId});
      else{cache.page=Math.floor(notices().findIndex(row=>row.id===n.id)/20);ctx.go('notifications');}
    }
  }
  let bound=false;
  function bind(ctx){
    sync(ctx);
    if(!bound){bound=true;
      document.addEventListener('click',event=>{
        const button=event.target.closest?.('[data-qp-action]');
        if(button){event.preventDefault();event.stopPropagation();if(!button.disabled)action(button).catch(error=>cache.ctx?.toast?.(error.message));return;}
        if(event.target.closest?.('.qp-bell-shell'))event.stopPropagation();
        else if(cache.panel){cache.panel=false;updateViews();}
      },true);
      document.addEventListener('keydown',event=>{if(event.key==='Escape'&&cache.panel){event.preventDefault();event.stopPropagation();cache.panel=false;updateViews();document.querySelector('[data-qp-action="bell"]')?.focus();}},true);
      scope.addEventListener('opennext:authchange',()=>{sync();updateViews();});
      scope.addEventListener('opennext:marketplace',()=>{sync();updateViews();});
      scope.addEventListener('opennext:billing',()=>{sync();updateViews();});
      scope.addEventListener('focus',()=>{if(!document.hidden)refresh();});
      setInterval(()=>{if(!document.hidden&&document.querySelector('[data-qp-bell-shell]'))refresh();},30000);
    }
    void refresh();
  }
  scope.OpenNEXTQuotePreview={open,bell,history,requests,bind,refresh,testHelpers:{prefill,notices,quoteRequests,markRead,ownerKey}};
})(window);
