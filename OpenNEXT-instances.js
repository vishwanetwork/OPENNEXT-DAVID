(function(root) {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>Number.isFinite(Number(v))?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v):'Not available';
  const stamp=v=>v?new Date(v).toLocaleString('en-GB',{timeZone:'UTC'})+' UTC':'Not provided';
  function telemetry(i,now=Date.now()) {
    const t=i.telemetry||{},value=Number(t.utilizationPercent),at=Date.parse(t.observedAt);
    const fresh=t.utilizationPercent!==null&&t.utilizationPercent!==undefined&&Number.isFinite(value)&&value>=0&&value<=100&&Number.isFinite(at)&&now-at<=120000&&now>=at-5000;
    return {fresh,value:fresh?value:null,at:t.observedAt};
  }
  function eligibility(i,S,now=Date.now()) {
    const t=telemetry(i,now),end=Date.parse(i.serviceEnd||i.end);
    if(S.role!=='Buyer')return {allowed:false,reason:'Resale is available for purchased buyer capacity.'};
    if(i.resaleAllowed!==true)return {allowed:false,reason:'Supplier resale permission is required.'};
    if(i.paymentStatus!=='Paid'||i.status!=='Running'||!Number.isFinite(end)||end<=now)return {allowed:false,reason:'Only an active, paid allocation can be resold.'};
    if(!t.fresh)return {allowed:false,reason:'Waiting for current provider utilization telemetry.'};
    if(t.value>=95)return {allowed:false,reason:'Resale is paused at 95% utilization or above.'};
    if(!Number.isInteger(i.availableResellCount)||i.availableResellCount<1)return {allowed:false,reason:'No independently allocatable idle GPUs are available.'};
    return {allowed:true,reason:'Idle capacity is available for an authorized resale request.'};
  }
  const button=(text,action,id,attrs='')=>`<button class="btn secondary small" type="button" data-act="${action}" data-id="${esc(id)}" ${attrs}>${text}</button>`;
  function page(c) {
    const S=c.S,items=S.instances||[];
    return `<div class="page-content"><div class="page-heading"><div><h1>My Instances</h1><p>${S.role==='Seller'?'Your verified supplied resources and delivery status.':'Your purchased GPU capacity, access and utilization.'}</p></div>${button(S.role==='Seller'?'List supply':'Find capacity',S.role==='Seller'?'new-supply':'navigate-market','')}</div>${items.length?`<div class="instance-grid">${items.map(i=>{const t=telemetry(i);return `<article class="instance-card"><div class="row spread"><h3>${esc(i.name||i.model)}</h3><span class="tag">${esc(i.status)}</span></div><p class="form-note">${esc(i.id)} · ${esc(i.region||'')} · ${esc(i.provider||'')}</p><div class="details-grid"><div><small>CAPACITY</small><strong>${esc(i.count)} × ${esc(i.model)}</strong></div><div><small>RATE / GPU-HOUR</small><strong>${money(i.rate)}</strong></div><div><small>ENDS AT</small><strong>${stamp(i.serviceEnd||i.end)}</strong></div></div><div class="instance-util"><div class="row spread"><span>GPU utilization</span><strong>${t.fresh?t.value.toFixed(1)+'%':'Awaiting telemetry'}</strong></div><progress max="100" value="${t.fresh?t.value:0}" aria-label="GPU utilization"></progress><small>${t.fresh?'Observed '+stamp(t.at):'No current measurement is available.'}</small></div><div class="row">${button('Manage','instance-manage',i.id)}</div></article>`;}).join('')}</div>`:`<div class="panel empty-state"><strong>No instances yet</strong><p>${S.role==='Seller'?'Your supplied GPU resources will appear here after verification and Agent installation.':'Your GPU instances will appear here after a purchase is delivered.'}</p></div><details class="panel instance-example"><summary>See an example instance layout</summary><div class="instance-example-grid"><span>Example only · not an active resource</span><h3>GPU allocation</h3><p>Model · GPU count · Country · Service window</p><p>Connection details and measured utilization will be available after delivery.</p><button class="btn secondary small" disabled>Manage instance</button></div></details>`}</div>`;
  }
  function modal(c,type,extra) {
    if(!['instance-manage','instance-resell'].includes(type))return null;
    const i=(c.S.instances||[]).find(x=>x.id===(extra.id||c.S.modal?.id));if(!i)return {title:'Instance unavailable',body:'<p>Refresh your instances and try again.</p>'};
    const e=eligibility(i,c.S),t=telemetry(i);
    if(type==='instance-manage')return {title:esc(i.name||i.model),body:`<div class="details-grid"><div><small>STATUS</small><strong>${esc(i.status)}</strong></div><div><small>CAPACITY</small><strong>${esc(i.count)} × ${esc(i.model)}</strong></div><div><small>UTILIZATION</small><strong>${t.fresh?t.value.toFixed(1)+'%':'Awaiting telemetry'}</strong></div></div><p class="form-note">${esc(e.reason)}</p><p class="form-note">Resale is limited to authorized, independently allocatable idle GPUs within your existing service window. Active allocations are never reclaimed automatically.</p><div class="modal-footer">${i.sshHost?button('Connection details','connect',i.id):''}${c.S.role==='Buyer'?button('Resell','instance-resell',i.id,`${e.allowed?'':'disabled'} title="${esc(e.reason)}"`):''}${button('Refresh status','instance-refresh',i.id)}</div>`};
    if(!e.allowed)return {title:'Resale unavailable',body:`<p>${esc(e.reason)}</p>${button('Refresh status','instance-refresh',i.id)}`};
    return {title:'Resell idle capacity',body:`<form data-form="instance-resell" data-id="${esc(i.id)}"><p class="form-note">A server-side availability and utilization check is required before listing. Buyer-facing prices include a 5% platform markup.</p><div class="form-grid"><label class="form-label">Idle GPU count<input class="field" type="number" name="count" min="1" max="${i.availableResellCount}" step="1" required></label><label class="form-label">Your unit price · USD / GPU-hour<input class="field" type="number" name="rate" min="0.01" step="0.01" required></label><label class="form-label">Duration · hours<input class="field" type="number" name="hours" min="1" max="${Math.max(0,Math.floor((Date.parse(i.serviceEnd||i.end)-Date.now())/3600000))}" required></label></div><p class="form-note">Pending offers pause when utilization reaches 95% or telemetry is stale.</p><div class="modal-footer"><button class="btn">Submit resale request</button></div></form>`};
  }
  async function request(path,method='GET',body) {return root.OpenNEXTAuth.request('/api/marketplace/'+path,{method,body:body?JSON.stringify(body):undefined});}
  async function refresh(c) {try{const data=await request('instances');c.S.instances=data.instances||[];c.render();}catch(error){c.toast(error.message);}}
  function action(c,act,b) {if(act==='instance-manage'||act==='instance-resell'){c.open(act,{id:b.dataset.id});return true;}if(act==='instance-refresh'){refresh(c);return true;}return false;}
  function submit(c,form,data) {if(form.dataset.form!=='instance-resell')return false;const b=form.querySelector('button');b.disabled=true;request('instances/'+encodeURIComponent(form.dataset.id)+'/resell','POST',{count:Number(data.count),rate:Number(data.rate),hours:Number(data.hours)}).then(()=>{c.S.modal=null;c.toast('Resale request submitted. Track it in your supply.');refresh(c);}).catch(error=>c.toast(error.message)).finally(()=>{if(b.isConnected)b.disabled=false;});return true;}
  function syncModal(c){
    if(!['instance-manage','instance-resell'].includes(c.S.modal?.type)||!root.document)return;
    const i=c.S.instances.find(row=>row.id===c.S.modal.id),e=i?eligibility(i,c.S):{allowed:false,reason:'The allocation is no longer available.'};
    const container=root.document.querySelector('.modal-body');if(!container)return;
    const actionButton=container.querySelector('[data-act="instance-resell"]'),form=container.querySelector('form[data-form="instance-resell"]');
    if(actionButton){actionButton.disabled=!e.allowed;actionButton.title=e.reason;}
    if(form){const count=form.querySelector('[name="count"]'),submit=form.querySelector('button');count.max=String(i?.availableResellCount||0);submit.disabled=!e.allowed;}
    let note=container.querySelector('[data-instance-live-status]');if(!note){note=root.document.createElement('p');note.className='form-note';note.setAttribute('data-instance-live-status','');note.setAttribute('role','status');container.prepend(note);}note.textContent=e.reason;
  }
  const api={page,modal,action,submit,telemetry,eligibility,refresh,syncModal};root.OpenNEXTInstances=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
