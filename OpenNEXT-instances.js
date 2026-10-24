(function(root) {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>Number.isFinite(Number(v))?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v):'Not available';
  const timestamp=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&v.trim()?Date.parse(v):NaN;
  const stamp=v=>{const d=new Date(v);return v&&Number.isFinite(d.getTime())?d.toLocaleString('en-GB',{timeZone:'UTC'})+' UTC':'Not provided';};
  const button=(text,action,id,attrs='')=>`<button class="btn secondary small" type="button" data-act="${action}" data-id="${esc(id)}" ${attrs}>${text}</button>`;
  const inMemory=new Map(),ending=new Set();
  function scope(c){const user=root.OpenNEXTAuth?.getUser?.();return String(user?.id||c.S.identity?.id||c.S.identity?.email||'anonymous')+':'+String(c.S.role||'Buyer');}
  function previewState(c){
    const key='opennext-instance-preview-v2:'+scope(c);let saved=inMemory.get(key);
    if(!saved){try{saved=JSON.parse(root.localStorage?.getItem(key)||'null');}catch{}}
    let created=false;
    if(!saved||saved.version!==2||!saved.example||!['Running','Connecting','End'].includes(saved.example.status)||!Number.isFinite(Date.parse(saved.example.createdAt))||!Number.isFinite(Date.parse(saved.example.serviceEnd))){saved={version:2,example:{status:'Running',createdAt:new Date().toISOString(),serviceEnd:new Date(Date.now()+172800000).toISOString()},endedDemo:{}};created=true;}
    if(!saved.endedDemo||typeof saved.endedDemo!=='object'||Array.isArray(saved.endedDemo))saved.endedDemo={};
    inMemory.set(key,saved);if(created){try{root.localStorage?.setItem(key,JSON.stringify(saved));}catch{}}return saved;
  }
  function savePreview(c,saved){const key='opennext-instance-preview-v2:'+scope(c);inMemory.set(key,saved);try{root.localStorage?.setItem(key,JSON.stringify(saved));}catch{}}
  const isSpot=i=>/spot/i.test(String(i.term||i.marketTerms||i.marketType||i.pricingType||''));
  const localDemo=i=>root.OpenNEXTDemo?.active===true&&(i.sample===true||i.demo===true||i.preview===true);
  function lifecycle(i,now=Date.now()){
    const status=String(i.status||'').toLowerCase(),end=timestamp(i.serviceEnd??i.end),connection=String(i.connectionStatus||i.connection?.status||'').toLowerCase();
    if(i.releasedAt||i.endedAt||['end','ended','released','expired','terminated','completed','cancelled','canceled'].includes(status)||(Number.isFinite(end)&&end<=now))return {label:'End',ended:true,connecting:false,running:false};
    if(isSpot(i)&&[status,connection].some(value=>/^(connecting|interrupted|reconnecting|preempted|recovering|resuming|disconnected|offline)$/.test(value)))return {label:'Connecting',ended:false,connecting:true,running:false};
    if(['running','active'].includes(status))return {label:'Running',ended:false,connecting:false,running:true};
    // Unknown lifecycle data does not prove that a resource is running or interrupted.
    return {label:'Awaiting status',ended:false,connecting:false,running:false};
  }
  function instanceView(i,c){const ends=localDemo(i)?previewState(c).endedDemo:null,ended=ends&&Object.prototype.hasOwnProperty.call(ends,i.id)&&ends[i.id];return ended?{...i,status:'Ended',endedAt:ended}:i;}
  function example(c){const saved=previewState(c).example;return {...saved,id:'INSTANCE-EXAMPLE',name:'Training workspace',model:'H100 SXM',region:'US East',term:'Spot',count:8,rate:2.3,paymentStatus:'Example only',resaleAllowed:false,telemetry:{utilizationPercent:saved.status==='Running'?71:null,observedAt:new Date().toISOString()}};}
  function telemetry(i,now=Date.now()){
    const t=i.telemetry||{},value=Number(t.utilizationPercent),at=timestamp(t.observedAt);
    const fresh=t.utilizationPercent!==null&&t.utilizationPercent!==undefined&&Number.isFinite(value)&&value>=0&&value<=100&&Number.isFinite(at)&&now-at<=120000&&now>=at-5000;
    return {fresh,value:fresh?value:null,at:t.observedAt};
  }
  function eligibility(i,S,now=Date.now()){
    const t=telemetry(i,now),end=timestamp(i.serviceEnd??i.end),life=lifecycle(i,now);
    if(S.role!=='Buyer')return {allowed:false,reason:'Resale is available for purchased buyer capacity.'};
    if(i.resaleAllowed!==true)return {allowed:false,reason:'Supplier resale permission is required.'};
    if(i.paymentStatus!=='Paid'||!life.running||!Number.isFinite(end)||end<=now)return {allowed:false,reason:'Only an active, paid allocation can be resold.'};
    if(!t.fresh)return {allowed:false,reason:'Waiting for current utilization telemetry.'};
    if(t.value>=95)return {allowed:false,reason:'Resale is paused at 95% utilization or above.'};
    if(!Number.isInteger(i.availableResellCount)||i.availableResellCount<1)return {allowed:false,reason:'No independently allocatable idle GPUs are available.'};
    return {allowed:true,reason:'Idle capacity is available for an authorized resale request.'};
  }
  const statusTag=life=>`<span class="tag instance-status instance-status-${life.ended?'end':life.connecting?'connecting':'running'}" data-instance-status>${esc(life.label)}</span>`;
  const endLabel=i=>lifecycle(i).ended?'ENDED AT':'ENDS AT';
  function exampleCard(c){
    const i=example(c),life=lifecycle(i),end=new Date(i.endedAt||i.serviceEnd).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC';
    return `<section class="instance-example" aria-label="Example instance"><div class="instance-example-caption"><strong>Example instance</strong><span>Example only · not an active resource</span></div><article class="instance-card instance-example-card" data-instance-example-live data-instance-life="${esc(life.label)}"><div class="row spread"><h3>Training workspace</h3>${statusTag(life)}</div><p class="instance-example-meta">US East</p><div class="instance-example-specs"><div><small>CAPACITY</small><strong>8 × H100 SXM</strong></div><div><small>RATE</small><strong>$2.30/GPU-hr</strong></div><div><small>${endLabel(i)}</small><strong>${end}</strong></div></div><svg class="instance-example-chart ${life.ended?'instance-chart-ended':life.connecting?'instance-chart-connecting':''}" viewBox="0 0 1000 150" preserveAspectRatio="none" role="img" aria-label="${life.ended?'Example utilization history before the instance ended':life.connecting?'Example utilization history before a Spot interruption':'Example GPU utilization trend, ending at 71 percent'}"><path d="M190 118 L220 114 L250 99 L280 108 L310 75 L340 84 L370 66 L400 73 L430 57 L460 66 L490 50 L520 61 L550 73 L580 64 L610 58 L640 69 L670 57 L700 48 L730 63 L760 50 L790 55" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg><div class="instance-example-footer"><span>${life.ended?'Instance ended · no active utilization':life.connecting?'Spot interrupted · reconnecting to capacity':'GPU utilization 71% · healthy'}</span><div class="row">${button('Connect','instance-example-connect','',life.running?'':'disabled')}${button('Manage','instance-example-manage','')}</div></div></article></section>`;
  }
  function instanceCards(c){
    const S=c.S,items=S.instances||[];
    return `<div class="page-content"><div class="page-heading"><div><h1>Instances</h1><p>${S.role==='Seller'?'Your verified supplied resources and delivery status.':'Your purchased GPU capacity, access and utilization.'}</p></div>${S.role==='Buyer'?button('Find capacity','navigate-market',''):''}</div>${items.length?`<div class="instance-grid">${items.map(original=>{const i=instanceView(original,c),life=lifecycle(i),t=telemetry(i);return `<article class="instance-card" data-instance-live="${esc(i.id)}" data-instance-life="${esc(life.label)}"><div class="row spread"><h3>${esc(i.name||i.model)}</h3>${statusTag(life)}</div><p class="instance-example-meta">${esc(i.region||'Region not provided')}</p><div class="details-grid"><div><small>CAPACITY</small><strong>${esc(i.count)} × ${esc(i.model)}</strong></div><div><small>RATE / GPU-HOUR</small><strong>${money(i.rate)}</strong></div><div><small>${endLabel(i)}</small><strong>${stamp(i.endedAt||i.serviceEnd||i.end)}</strong></div></div><div class="instance-util"><div class="row spread"><span>GPU utilization</span><strong>${life.ended?'Not active':life.connecting?'Waiting for reconnection':t.fresh?t.value.toFixed(1)+'%':'Awaiting telemetry'}</strong></div><progress max="100" value="${life.running&&t.fresh?t.value:0}" aria-label="GPU utilization"></progress><small>${life.ended?'This allocation has ended.':life.connecting?'A Spot interruption was reported. Connection and resale are paused.':t.fresh?'Observed '+stamp(t.at):'No current measurement is available.'}</small></div><div class="row">${button('Connect','instance-connect',i.id,life.running&&i.sshHost?'':'disabled')}${button('Manage','instance-manage',i.id)}</div></article>`;}).join('')}</div>`:`<div class="instance-empty-summary"><strong>No instances yet</strong><p>${S.role==='Seller'?'Your supplied GPU resources will appear here after verification and Agent installation.':'Your GPU instances will appear here after a purchase is delivered.'}</p></div>${exampleCard(c)}`}</div>`;
  }
  function sshLibrary(c,scope){return root.OpenNEXTAccountProfile?.sshSection(c,{scope})||'<p class="form-note">SSH key management is temporarily unavailable.</p>';}
  function page(c){return instanceCards(c)+`<div class="page-content instance-access-page">${sshLibrary(c,'instances')}</div>`;}
  function orderFor(i,S){const id=i.orderId||i.purchaseOrderId;return (S.orders||[]).find(order=>(id&&order.id===id)||(i.id&&order.instanceId===i.id));}
  function orderField(i,S,isExample=false){const order=isExample?{id:'ORDER-EXAMPLE-1024'}:orderFor(i,S);return `<div><small>ORDER</small>${order?`<button type="button" class="detail-link instance-order-link" data-act="${isExample?'instance-example-order':'instance-order'}" data-id="${esc(i.id)}">${esc(order.id)} <span aria-hidden="true">↗</span></button>`:'<strong>Purchase record not linked</strong>'}</div>`;}
  function exampleOrder(c){const i=example(c),subtotal=8*2.3*48;return {title:'Example purchase record',wide:true,body:`<p class="instance-example-record-note">Example only · no purchase, payment or active resource</p><div class="details-grid"><div><small>ORDER</small><strong>ORDER-EXAMPLE-1024</strong></div><div><small>RESOURCE</small><strong>8 × H100 SXM</strong></div><div><small>REGION</small><strong>US East</strong></div><div><small>MARKET TERMS</small><strong>Spot</strong></div><div><small>UNIT RATE</small><strong>$2.30 / GPU-hour</strong></div><div><small>ILLUSTRATIVE DURATION</small><strong>48 hours</strong></div><div><small>START</small><strong>${stamp(i.createdAt)}</strong></div><div><small>END</small><strong>${stamp(i.endedAt||i.serviceEnd)}</strong></div><div><small>RESOURCE STATUS</small><strong>${lifecycle(i).label}</strong></div><div><small>PAYMENT</small><strong>Not charged · example only</strong></div></div><div class="instance-example-pricing"><div><span>Illustrative capacity subtotal</span><strong>${money(subtotal)}</strong></div><div><span>OpenNEXT Fee 5%</span><strong>${money(subtotal*.05)}</strong></div><div><span>Illustrative total</span><strong>${money(subtotal*1.05)}</strong></div></div><p class="form-note">This record demonstrates the information linked to a purchased instance. It is not added to your real orders or Billing activity.</p><div class="modal-footer">${button('Back to instance','instance-example-manage','')}${button('Close','close-modal','')}</div>`};}
  function endModal(c,i,isExample){
    const life=lifecycle(i),local=isExample||localDemo(i),configured=typeof root.OpenNEXTInstanceLifecycle?.end==='function';
    return {title:life.ended?'Instance has ended':'End this instance?',body:`<p class="instance-end-warning">${life.ended?'This allocation is no longer active.':local?'This ends only the local example or demo allocation. No real server is released.':'Ending an instance stops its workloads and releases the allocation. Save any required data before proceeding.'}</p><div class="details-grid"><div><small>RESOURCE</small><strong>${esc(i.count)} × ${esc(i.model)}</strong></div><div><small>REGION</small><strong>${esc(i.region||'Not provided')}</strong></div><div><small>STATUS</small><strong data-instance-status>${esc(life.label)}</strong></div></div>${!local&&!configured?'<div class="instance-end-unavailable">Resource termination is not connected yet. No resource will be released and no billing change will be made. Contact operations to end this allocation.</div>':''}${!life.ended?`<form data-form="instance-end" data-id="${esc(i.id)}" data-example="${isExample?'true':'false'}"><label class="instance-end-confirm"><input type="checkbox" name="confirmEnd" value="yes" required ${!local&&!configured?'disabled':''}> <span>I understand that this ${local?'local preview':'allocation'} will end and connection access will stop.</span></label><p class="form-note" data-instance-end-error role="alert"></p><div class="modal-footer">${button('Cancel',isExample?'instance-example-manage':'instance-manage',i.id)}<button type="submit" class="btn danger" ${!local&&!configured?'disabled':''}>END instance</button></div></form>`:`<div class="modal-footer">${button('Close','close-modal','')}</div>`}`};
  }
  function instanceModal(c,type,extra={}){
    if(type==='instance')type='instance-manage';
    if(type==='instance-example-order')return exampleOrder(c);
    if(type==='instance-example-connect'){const life=lifecycle(example(c));return {title:'Connect to your workspace',body:`<p class="form-note">${life.ended?'This example has ended. Reset it in Manage to explore the connection state.':life.connecting?'This Spot example is reconnecting after an interruption. Access resumes only after the Running state is confirmed.':'This is an example instance, not an active resource. Delivered allocations show a verified SSH endpoint, port, username and SSH key instructions.'}</p><div class="instance-example-access"><span>SSH access</span><strong>${life.running?'Available after real delivery':esc(life.label)}</strong></div><p class="form-note">No server connection is made from this example.</p><div class="modal-footer">${button('Close','close-modal','')}</div>`};}
    if(type==='instance-example-manage'){
      const i=example(c),life=lifecycle(i);
      return {title:'Training workspace · example',body:`<div class="details-grid"><div><small>STATUS</small><strong data-instance-status>${esc(life.label)}</strong></div><div><small>CAPACITY</small><strong>8 × H100 SXM</strong></div><div><small>REGION</small><strong>US East</strong></div><div><small>UNIT RATE</small><strong>$2.30/GPU-hr</strong></div><div><small>UTILIZATION</small><strong>${life.running?'71%':life.ended?'Not active':'Awaiting reconnection'}</strong></div>${orderField(i,c.S,true)}</div><p class="form-note">Example only. These controls demonstrate the instance lifecycle without creating a purchase, connecting to a server or changing Billing.</p><div class="instance-example-controls">${life.ended?button('Reset example','instance-example-reset',''):button(life.connecting?'Restore connection':'Preview Spot interruption',life.connecting?'instance-example-recover':'instance-example-interrupt','')}<span>Local example controls</span></div><div class="modal-footer">${button('Close','close-modal','')}${button('Connect','instance-example-connect','',life.running?'':'disabled')}${button('Resell','instance-example-resell','','disabled title="Example capacity cannot be listed for resale."')}${button('END','instance-example-end','',life.ended?'disabled':'')}</div>`};
    }
    if(type==='instance-example-end')return endModal(c,example(c),true);
    if(!['instance-manage','instance-resell','instance-end-confirm'].includes(type))return null;
    const original=(c.S.instances||[]).find(x=>x.id===(extra.id||c.S.modal?.id));if(!original)return {title:'Instance unavailable',body:'<p>Refresh your instances and try again.</p>'};
    const i=instanceView(original,c),life=lifecycle(i),e=eligibility(i,c.S),t=telemetry(i);
    if(type==='instance-end-confirm')return endModal(c,i,false);
    if(type==='instance-manage')return {title:esc(i.name||i.model),body:`<div class="details-grid"><div><small>STATUS</small><strong data-instance-status>${esc(life.label)}</strong></div><div><small>CAPACITY</small><strong>${esc(i.count)} × ${esc(i.model)}</strong></div><div><small>REGION</small><strong>${esc(i.region||'Not provided')}</strong></div><div><small>UNIT RATE</small><strong>${money(i.rate)} / GPU-hour</strong></div><div><small>UTILIZATION</small><strong>${life.ended?'Not active':life.connecting?'Awaiting reconnection':t.fresh?t.value.toFixed(1)+'%':'Awaiting telemetry'}</strong></div>${orderField(i,c.S)}</div><p class="form-note">${esc(e.reason)}</p><p class="form-note">Resale is limited to authorized, independently allocatable idle GPUs within your existing service window. Active allocations are never reclaimed automatically.</p>${localDemo(i)?'<p class="instance-example-record-note">Demo allocation · local lifecycle changes only</p>':''}<div class="modal-footer">${button('Connection details','instance-connect',i.id,life.running&&i.sshHost?'':'disabled')}${c.S.role==='Buyer'?button('Resell','instance-resell',i.id,`${e.allowed?'':'disabled'} title="${esc(e.reason)}"`):''}${button('Refresh status','instance-refresh',i.id)}${button('END','instance-end',i.id,life.ended?'disabled':'')}</div>`};
    if(!e.allowed)return {title:'Resale unavailable',body:`<p>${esc(e.reason)}</p>${button('Refresh status','instance-refresh',i.id)}`};
    return {title:'Resell idle capacity',body:`<form data-form="instance-resell" data-id="${esc(i.id)}"><p class="form-note">A server-side availability and utilization check is required before listing. Your listed unit price has no markup. OpenNEXT Fee 5% is added at buyer checkout and deducted from seller proceeds, each based on the order subtotal.</p><div class="form-grid"><label class="form-label">Idle GPU count<input class="field" type="number" name="count" min="1" max="${i.availableResellCount}" step="1" required></label><label class="form-label">Your unit price · USD / GPU-hour<input class="field" type="number" name="rate" min="0.01" step="0.01" required></label><label class="form-label">Duration · hours<input class="field" type="number" name="hours" min="1" max="${Math.max(0,Math.floor((timestamp(i.serviceEnd??i.end)-Date.now())/3600000))}" required></label></div><p class="form-note">Pending offers pause when utilization reaches 95% or telemetry is stale.</p><div class="modal-footer"><button class="btn">Submit resale request</button></div></form>`};
  }
  function modal(c,type,extra={}){
    if(type==='instance-access'){
      const isExample=extra.example===true,original=isExample?example(c):(c.S.instances||[]).find(row=>row.id===extra.id);
      if(!original)return {title:'Instance unavailable',body:'<p>Refresh your instances and try again.</p>'};
      const i=isExample?original:instanceView(original,c);
      return {title:'SSH access',wide:true,body:`<div class="instance-access-summary"><strong>${esc(i.count)} × ${esc(i.model)}</strong><span>${esc(i.region||'Region not provided')}</span></div><p class="form-note instance-access-installation">${isExample?'This example has no server to connect to.':'Instance-specific key installation is not connected yet.'} Save a public key below for provisioning. Adding a key here does not install it on an existing instance.</p>${sshLibrary(c,'instance-access')}<div class="modal-footer">${button('Back to instance',isExample?'instance-example-manage':'instance-manage',i.id)}${button('Close','close-modal','')}</div>`};
    }
    const result=instanceModal(c,type,extra);
    if(result&&['instance','instance-manage','instance-example-manage'].includes(type)){
      const isExample=type==='instance-example-manage',id=extra.id||c.S.modal?.id||'';
      result.body=result.body.replace('<div class="modal-footer">',`<div class="modal-footer">${button('SSH keys','instance-access',id,isExample?'data-example="true"':'')}`);
    }
    return result;
  }
  async function request(path,method='GET',body){return root.OpenNEXTAuth.request('/api/marketplace/'+path,{method,body:body?JSON.stringify(body):undefined});}
  async function refresh(c){try{const data=await request('instances');c.S.instances=data.instances||[];c.render();}catch(error){c.toast(error.message);}}
  function scenario(c,value){const saved=previewState(c);if(value==='reset')saved.example={status:'Running',createdAt:new Date().toISOString(),serviceEnd:new Date(Date.now()+172800000).toISOString()};else if(!lifecycle(example(c)).ended)saved.example.status=value==='interrupted'?'Connecting':'Running';savePreview(c,saved);}
  function action(c,act,b={dataset:{}}){
    const id=b.dataset?.id;
    if(act==='instance-access'){c.open('instance-access',{id,example:b.dataset?.example==='true'});return true;}
    if(['instance-example-connect','instance-example-manage','instance-example-order','instance-example-end'].includes(act)){c.open(act,{});return true;}
    if(['instance-example-reset','instance-example-interrupt','instance-example-recover'].includes(act)){scenario(c,act==='instance-example-reset'?'reset':act==='instance-example-interrupt'?'interrupted':'running');c.render();c.open('instance-example-manage',{});return true;}
    if(act==='instance-example-resell'){c.toast('Example capacity cannot be listed for resale.');return true;}
    if(['instance-manage','instance-resell'].includes(act)){c.open(act,{id});return true;}
    if(['instance-end','end-instance'].includes(act)){c.open('instance-end-confirm',{id});return true;}
    if(act==='instance-order'){const i=(c.S.instances||[]).find(row=>row.id===id),order=i&&orderFor(i,c.S);if(order)c.open('bill-order',{id:order.id});else c.toast('The purchase record is not linked to this allocation yet.');return true;}
    if(act==='instance-connect'||act==='connect'){
      const original=(c.S.instances||[]).find(row=>row.id===id);if(!original)return act==='instance-connect';
      const i=instanceView(original,c);if(!lifecycle(i).running){c.toast(lifecycle(i).ended?'This instance has ended.':'Connection is unavailable until the resource is Running.');return true;}
      if(!i.sshHost){c.toast('Verified connection details are not available yet.');return true;}c.open('connect',{id});return true;
    }
    if(act==='instance-refresh'){refresh(c);return true;}return false;
  }
  async function finishEnd(c,form,data){
    const id=form.dataset.id,isExample=form.dataset.example==='true',key=scope(c)+':'+id,errorNode=form.querySelector('[data-instance-end-error]');
    if(data.confirmEnd!=='yes'){if(errorNode)errorNode.textContent='Confirm that you want to end this instance.';return;}
    if(ending.has(key))return;ending.add(key);const b=form.querySelector('button[type="submit"]');if(b)b.disabled=true;
    try{
      const original=isExample?example(c):(c.S.instances||[]).find(row=>row.id===id);if(!original)throw new Error('This allocation is no longer available.');
      const i=isExample?original:instanceView(original,c);if(lifecycle(i).ended)throw new Error('This instance has already ended.');
      if(isExample||localDemo(i)){
        const saved=previewState(c),now=new Date().toISOString();if(isExample){saved.example.status='End';saved.example.endedAt=now;}else saved.endedDemo[id]=now;savePreview(c,saved);
        c.S.modal=null;c.render();c.toast('Local preview instance ended. No real resource or billing was changed.');return;
      }
      // The future backend adapter authorizes the account, releases resources,
      // settles metering, and returns an authoritative terminal record.
      // OpenNEXTInstanceLifecycle.end({instanceId,confirmation:'END'})
      // -> {confirmed:true,instance:{id,status:'Ended'|'Released',...}}.
      if(typeof root.OpenNEXTInstanceLifecycle?.end!=='function')throw new Error('Termination is not connected. No resource has been released. Contact operations.');
      const result=await root.OpenNEXTInstanceLifecycle.end({instanceId:id,confirmation:'END'});
      const finalStatus=String(result?.instance?.status||'').toLowerCase(),terminalRecord=Boolean(result?.instance?.releasedAt||result?.instance?.endedAt)||['end','ended','released','expired','terminated','completed','cancelled','canceled'].includes(finalStatus);
      if(result?.confirmed!==true||result.instance?.id!==id||!terminalRecord)throw new Error('Termination has not been confirmed. The allocation was not marked as ended. Refresh its status or contact operations.');
      Object.assign(original,result.instance);c.S.modal=null;c.render();c.toast('Instance ended. The backend confirmed release.');
    }catch(error){if(errorNode&&form.isConnected)errorNode.textContent=error.message;c.toast(error.message);}finally{ending.delete(key);if(b?.isConnected)b.disabled=false;}
  }
  function submit(c,form,data){
    if(form.dataset.form==='instance-end'){finishEnd(c,form,data);return true;}
    if(form.dataset.form!=='instance-resell')return false;
    const original=(c.S.instances||[]).find(i=>i.id===form.dataset.id),e=original?eligibility(instanceView(original,c),c.S):{allowed:false,reason:'The allocation is no longer available.'};
    if(!e.allowed){c.toast(e.reason);return true;}
    const b=form.querySelector('button');b.disabled=true;request('instances/'+encodeURIComponent(form.dataset.id)+'/resell','POST',{count:Number(data.count),rate:Number(data.rate),hours:Number(data.hours)}).then(()=>{c.S.modal=null;c.toast('Resale request submitted. Track it in your supply.');refresh(c);}).catch(error=>c.toast(error.message)).finally(()=>{if(b.isConnected)b.disabled=false;});return true;
  }
  function syncModal(c){
    if(!root.document)return;
    if(!c.S.modal&&c.S.route==='instances'){
      const changed=[...root.document.querySelectorAll('[data-instance-live]')].some(el=>{const i=(c.S.instances||[]).find(row=>row.id===el.dataset.instanceLive);return i&&el.dataset.instanceLife!==lifecycle(instanceView(i,c)).label;});
      const preview=root.document.querySelector('[data-instance-example-live]');if(changed||(preview&&preview.dataset.instanceLife!==lifecycle(example(c)).label)){c.render();return;}
    }
    const type=c.S.modal?.type;if(!['instance','instance-manage','instance-resell','instance-end-confirm','instance-example-manage','instance-example-end'].includes(type))return;
    const isExample=type.startsWith('instance-example'),original=isExample?example(c):(c.S.instances||[]).find(row=>row.id===c.S.modal.id),i=original&&(isExample?original:instanceView(original,c)),life=i?lifecycle(i):{label:'End',ended:true,running:false},e=i?eligibility(i,c.S):{allowed:false,reason:'The allocation is no longer available.'};
    const container=root.document.querySelector('.modal-body');if(!container)return;
    container.querySelectorAll('[data-instance-status]').forEach(el=>{el.textContent=life.label;});
    const actionButton=container.querySelector('[data-act="instance-resell"]'),form=container.querySelector('form[data-form="instance-resell"]');
    if(actionButton){actionButton.disabled=!e.allowed;actionButton.title=e.reason;}
    if(form){const count=form.querySelector('[name="count"]'),submit=form.querySelector('button');count.max=String(i?.availableResellCount||0);submit.disabled=!e.allowed;}
    container.querySelectorAll('[data-act="instance-connect"],[data-act="instance-example-connect"]').forEach(el=>{el.disabled=!life.running||(!isExample&&!i?.sshHost);});
    container.querySelectorAll('[data-act="instance-end"],[data-act="instance-example-end"]').forEach(el=>{el.disabled=life.ended;});
    const endForm=container.querySelector('[data-form="instance-end"]');if(endForm){const submit=endForm.querySelector('[type="submit"]');submit.disabled=life.ended||ending.has(scope(c)+':'+i?.id)||(!isExample&&!localDemo(i||{})&&typeof root.OpenNEXTInstanceLifecycle?.end!=='function');}
    if(!isExample&&['instance','instance-manage','instance-resell'].includes(type)){let note=container.querySelector('[data-instance-live-status]');if(!note){note=root.document.createElement('p');note.className='form-note';note.setAttribute('data-instance-live-status','');note.setAttribute('role','status');container.prepend(note);}note.textContent=e.reason;}
  }
  const api={page,modal,action,submit,telemetry,eligibility,refresh,syncModal,lifecycle,example,instanceView,setExampleScenario:scenario,finishEnd,timestamp};root.OpenNEXTInstances=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
