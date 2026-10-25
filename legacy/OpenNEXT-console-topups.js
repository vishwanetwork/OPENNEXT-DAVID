/* Server-owned credit top-ups. Approval records verified receipt; it never moves payment-provider funds. */
(() => {
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const methods={credit_card:'Credit card',paypal:'PayPal',bank_transfer:'Bank transfer'};
  const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-GB',{timeZone:'UTC'}):'Not provided';
  const amount=row=>{const value=Number.isSafeInteger(row.amountCents)?row.amountCents/100:Number(row.amount);return Number.isFinite(value)&&value>0?value.toLocaleString('en-US',{style:'currency',currency:'USD'}):'Not provided';};
  const label=row=>row.status==='Approved'?'Solved':row.status==='Rejected'?'Rejected':row.status==='Pending'?'Pending':'Unknown';
  const token=row=>row.id+'|'+(row.workspaceId||'');
  let root,controller,lifecycle,dialog,returnFocus,timer,pendingRefresh;
  let rows=[],scope='production',query='',filter='All',generation=0,revision=0,authBlocked=false,loaded=false,reviewing=false;
  function render(){
    scope='production';query='';filter='All';
    return `<section class="on-topups"><div class="page-head"><div><h1>Top-up Requests</h1><p>Verify incoming payments before adding Credit to an account.</p></div><button class="btn" data-topup-action="refresh">Refresh</button></div><div class="on-topups-message" role="status" hidden></div><div class="on-topups-test-notice" hidden>Test accounts only. These approvals add test Credit and never affect live balances or real payments.</div><section class="panel"><div class="on-topups-toolbar"><label>Accounts<select data-topup-scope aria-label="Account scope"><option value="production">Live accounts</option><option value="demo">Test accounts</option></select></label><label class="on-topups-search"><span class="sr-only">Search top-up requests</span><input type="search" data-topup-search maxlength="256" placeholder="Search email or request…"></label><label><span class="sr-only">Top-up status</span><select data-topup-filter aria-label="Top-up status"><option value="All">All statuses</option><option value="Pending">Pending</option><option value="Approved">Solved</option><option value="Rejected">Rejected</option></select></label></div><div class="on-topups-count" aria-live="polite"></div><div class="on-topups-table"><p class="on-topups-empty">Loading top-up requests…</p></div></section><p class="on-topups-footnote">Approval requires payment verification. Rejected requests do not add Credit. Records refresh automatically while this page is open.</p></section>`;
  }
  const session=()=>({root,controller,generation,scope});
  const active=current=>current.generation===generation&&current.root===root&&current.scope===scope&&Boolean(root?.isConnected)&&!current.controller?.signal.aborted;
  const endpoint=(suffix='',selected=scope)=>'/api/admin/topups'+suffix+(selected==='demo'?'?scope=demo':'');
  function notice(message,error=false){if(!root?.isConnected)return;const box=root.querySelector('.on-topups-message');box.textContent=message;box.hidden=!message;box.classList.toggle('is-error',error);}
  async function api(url,method='GET',body,current=session()){
    const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',signal:current.controller?.signal,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    let data;try{data=await response.json();}catch{throw Object.assign(Error('The server returned an unreadable response. Refresh to confirm the latest status.'),{status:response.status});}
    if(!response.ok)throw Object.assign(Error(data.error||'The request could not be completed.'),{status:response.status});
    return data;
  }
  function pendingRow(row){return row?.status==='Pending'&&(!row.solved);}
  function update(){
    if(!root?.isConnected)return;
    root.querySelector('.on-topups-test-notice').hidden=scope!=='demo';
    root.querySelector('[data-topup-scope]').disabled=reviewing;
    if(authBlocked){root.querySelector('.on-topups-count').textContent='';root.querySelector('.on-topups-table').innerHTML='<div class="on-topups-empty"><strong>Administrator access required</strong><p>Connect an administrator session to review private top-up requests.</p><button class="btn primary" data-topup-action="login">Connect administrator session</button></div>';return;}
    const matched=rows.filter(row=>(filter==='All'||row.status===filter)&&[row.id,row.email,row.accountId,row.purchaseReference,methods[row.method]||row.method].join(' ').toLowerCase().includes(query.toLowerCase()));
    root.querySelector('.on-topups-count').textContent=loaded?`${matched.length} of ${rows.length} requests · ${scope==='demo'?'Test accounts':'Live accounts'}`:'';
    root.querySelector('.on-topups-table').innerHTML=matched.length?`<table><thead><tr><th>Email</th><th>Amount</th><th>Method</th><th>Submitted time <small>UTC</small></th><th>Status</th><th>Review</th></tr></thead><tbody>${matched.map(row=>`<tr><td><strong>${esc(row.email)}</strong><small>${esc(row.id)}</small>${scope==='demo'?'<small class="on-topup-test">Test account · '+esc(row.workspaceId)+'</small>':''}</td><td class="on-topup-amount">${esc(amount(row))}</td><td>${esc(methods[row.method]||row.method||'Not provided')}</td><td>${esc(stamp(row.createdAt))}</td><td><span class="on-topup-status ${row.status==='Approved'?'solved':row.status==='Rejected'?'rejected':'pending'}">${label(row)}</span>${row.reviewedAt?'<small>'+esc(stamp(row.reviewedAt))+' UTC</small>':''}${row.reason?'<small>'+esc(row.reason)+'</small>':''}</td><td><div class="on-topup-actions">${pendingRow(row)?`<button class="btn small primary" data-topup-action="approve" data-id="${esc(row.id)}" data-workspace="${esc(row.workspaceId||'')}" ${reviewing?'disabled':''}>Approve</button><button class="btn small" data-topup-action="reject" data-id="${esc(row.id)}" data-workspace="${esc(row.workspaceId||'')}" ${reviewing?'disabled':''}>Reject</button>`:'<span class="on-topup-complete">'+(row.status==='Approved'?'Credit added':row.status==='Rejected'?'No Credit added':'Review unavailable')+'</span>'}</div></td></tr>`).join('')}</tbody></table>`:`<div class="on-topups-empty"><strong>${!loaded?'Top-up requests are unavailable':rows.length?'No matching requests':'No top-up requests yet'}</strong><p>${!loaded?'Refresh to load the latest server records.':rows.length?'Try another email or status.':scope==='demo'?'New test-account top-ups will appear here.':'Customer top-up requests will appear here after submission.'}</p></div>`;
    const form=dialog?.querySelector('[data-topup-form="review"]');
    if(form){const latest=rows.find(row=>token(row)===form.dataset.record);const stale=form.querySelector('[data-topup-stale]'),submit=form.querySelector('button[type="submit"]');const changed=!pendingRow(latest);stale.hidden=!changed;submit.disabled=reviewing||changed;}
  }
  function requireAccess(error){authBlocked=true;rows=[];loaded=false;revision++;close();update();notice(error.message,true);}
  function refresh({automatic=false}={}){
    if(!root?.isConnected||(automatic&&(document.hidden||authBlocked||reviewing)))return Promise.resolve();
    if(pendingRefresh)return pendingRefresh.promise;
    const current=session(),startedRevision=revision,pending={promise:null};pendingRefresh=pending;
    pending.promise=(async()=>{
      try{
        const result=await api(endpoint('',current.scope),'GET',undefined,current);
        if(!active(current)||revision!==startedRevision)return;
        if(!Array.isArray(result.requests))throw Error('The server returned an invalid top-up request list.');
        if(current.scope==='demo'?(result.scope==='production'||!result.requests.every(row=>typeof row.workspaceId==='string'&&row.workspaceId)):(result.scope==='demo'||result.requests.some(row=>row.workspaceId||row.demo===true)))throw Error('The server returned records for a different account scope.');
        rows=result.requests;loaded=true;authBlocked=false;notice('');update();
      }catch(error){if(error.name==='AbortError'||!active(current))return;if(error.status===401||error.status===403)requireAccess(error);else{notice(error.message+(loaded?' The previous snapshot is retained.':''),true);update();}}
      finally{if(pendingRefresh===pending)pendingRefresh=null;}
    })();return pending.promise;
  }
  function close(){const current=dialog;dialog=null;current?.close();current?.remove();if(returnFocus?.isConnected)returnFocus.focus();returnFocus=null;}
  function modal(title,content){
    close();returnFocus=document.activeElement;const current=document.createElement('dialog');dialog=current;current.className='on-topup-dialog';current.setAttribute('aria-labelledby','on-topup-heading');
    current.innerHTML=`<header><h2 id="on-topup-heading">${esc(title)}</h2><button type="button" class="btn" data-topup-action="close" aria-label="Close dialog">×</button></header>${content}`;
    document.body.append(current);current.showModal();current.addEventListener('click',event=>{event.stopPropagation();click(event);});current.addEventListener('submit',submit);current.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});current.addEventListener('close',()=>{current.remove();if(dialog===current){dialog=null;if(returnFocus?.isConnected)returnFocus.focus();returnFocus=null;}});
  }
  function review(id,workspace,decision){
    if(reviewing||authBlocked)return;const row=rows.find(item=>item.id===id&&(scope!=='demo'||item.workspaceId===workspace));if(!pendingRow(row))return;
    const approve=decision==='Approve';
    modal(approve?'Approve top-up':'Reject top-up',`${scope==='demo'?'<p class="on-topup-test-warning">Test account only. No live Credit or real payment is affected.</p>':''}<div class="on-topup-summary"><div><small>Email</small><strong>${esc(row.email)}</strong></div><div><small>Amount</small><strong>${esc(amount(row))}</strong></div><div><small>Method</small><strong>${esc(methods[row.method]||row.method)}</strong></div><div><small>Request</small><strong>${esc(row.id)}</strong></div></div><p>${approve?'Only approve after independently verifying receipt of this payment. Approval adds the requested Credit once.':'Rejecting this request will not add Credit to the account.'}</p><form data-topup-form="review" data-id="${esc(row.id)}" data-record="${esc(token(row))}" data-workspace="${esc(row.workspaceId||'')}" data-decision="${decision}" data-scope="${scope}">${approve?'<label class="on-topup-confirm"><input type="checkbox" name="fundsVerified" required><span>I have verified that the payment has been received.</span></label>':''}<label class="on-topup-note">${approve?'Review notes':'Rejection reason'} <span>(optional)</span><textarea name="reason" rows="3" maxlength="2000"></textarea></label><p data-topup-stale class="on-topup-error" hidden>This request was already reviewed. Close this dialog and refresh before taking another action.</p><p class="on-topup-error" data-topup-error role="alert" hidden></p><div class="on-topup-dialog-actions"><button class="btn" type="button" data-topup-action="close">Cancel</button><button class="btn ${approve?'primary':''}" type="submit">${approve?'Approve and add Credit':'Reject request'}</button></div></form>`);
  }
  function click(event){const button=event.target.closest('[data-topup-action]');if(!button)return;event.preventDefault();event.stopPropagation();const action=button.dataset.topupAction;if(action==='refresh')return refresh();if(action==='close')return close();if(action==='approve'||action==='reject')return review(button.dataset.id,button.dataset.workspace,action==='approve'?'Approve':'Reject');if(action==='login')modal('Administrator session','<form data-topup-form="login"><label class="on-topup-note">Administrator token<input type="password" name="token" autocomplete="new-password" required></label><p class="on-topup-error" data-topup-error role="alert" hidden></p><button type="submit" class="btn primary">Connect</button></form>');}
  async function submit(event){
    event.preventDefault();event.stopPropagation();const form=event.target,current=session(),currentDialog=dialog,button=form.querySelector('button[type="submit"]'),errorBox=form.querySelector('[data-topup-error]');
    if(!active(current)||!form.isConnected||!button||button.disabled||reviewing)return;
    const fields=new FormData(form);errorBox.hidden=true;
    if(form.dataset.topupForm==='review'){
      if(form.dataset.scope!==scope||!['Approve','Reject'].includes(form.dataset.decision)||!pendingRow(rows.find(row=>token(row)===form.dataset.record))){errorBox.textContent='The request has changed. Close this dialog and refresh.';errorBox.hidden=false;return;}
      if(form.dataset.decision==='Approve'&&fields.get('fundsVerified')!=='on'){errorBox.textContent='Confirm that the payment has been received before approving.';errorBox.hidden=false;return;}
    }
    button.disabled=true;reviewing=true;revision++;update();
    try{
      if(form.dataset.topupForm==='login'){
        const value=String(fields.get('token')||'');form.querySelector('[name="token"]').value='';await api('/api/admin/pricing/session','POST',{token:value},current);
        if(!active(current))return;authBlocked=false;close();
      }else{
        const decision=form.dataset.decision,payload={decision,reason:String(fields.get('reason')||'')};if(decision==='Approve')payload.fundsVerified=true;if(scope==='demo')payload.workspaceId=form.dataset.workspace;
        const result=await api(endpoint('/'+encodeURIComponent(form.dataset.id)+'/review',current.scope),'POST',payload,current);
        if(!active(current))return;
        if(!result.request||result.request.id!==form.dataset.id||result.request.status!==(decision==='Approve'?'Approved':'Rejected')||(current.scope==='demo'?result.request.workspaceId!==form.dataset.workspace:Boolean(result.request.workspaceId||result.request.demo)))throw Error('The server did not confirm this decision. Refresh to check the request status before trying again.');
        revision++;rows=rows.map(row=>token(row)===form.dataset.record?{...row,...result.request}:row);if(dialog===currentDialog)close();update();
        notice(decision==='Approve'?'Top-up solved. The server confirmed that Credit was added.':'Request rejected. No Credit was added.');
      }
      await pendingRefresh?.promise;if(active(current)){reviewing=false;update();await refresh();}
    }catch(error){
      if(error.name==='AbortError'||!active(current))return;
      if(error.status===401||error.status===403){requireAccess(error);return;}
      if(dialog===currentDialog&&form.isConnected){errorBox.textContent=error.status===409?'This request was reviewed elsewhere. Refresh to see the recorded decision.':error.message;errorBox.hidden=false;}
      notice('The decision was not confirmed. Refresh to verify the latest status before trying again.',true);
      if(error.status===409){await pendingRefresh?.promise;if(active(current))await refresh();}
    }finally{if(active(current)){reviewing=false;update();if(form.dataset.topupForm==='login'&&button.isConnected)button.disabled=false;}}
  }
  function switchScope(value){
    const selected=value==='demo'?'demo':'production';if(selected===scope||reviewing)return;
    generation++;controller?.abort();controller=new AbortController();pendingRefresh=null;scope=selected;rows=[];loaded=false;authBlocked=false;revision++;close();notice('');update();void refresh();
  }
  const automaticRefresh=()=>refresh({automatic:true});
  function destroy(){generation++;controller?.abort();controller=null;lifecycle?.abort();lifecycle=null;clearInterval(timer);timer=null;window.removeEventListener('focus',automaticRefresh);document.removeEventListener('visibilitychange',automaticRefresh);close();root=null;rows=[];loaded=false;authBlocked=false;reviewing=false;pendingRefresh=null;}
  function mount(){destroy();root=document.querySelector('.on-topups');if(!root)return;controller=new AbortController();lifecycle=new AbortController();const options={signal:lifecycle.signal};root.addEventListener('click',click,options);root.querySelector('[data-topup-search]').addEventListener('input',event=>{query=event.target.value;update();},options);root.querySelector('[data-topup-filter]').addEventListener('change',event=>{filter=event.target.value;update();},options);root.querySelector('[data-topup-scope]').addEventListener('change',event=>switchScope(event.target.value),options);window.addEventListener('focus',automaticRefresh);document.addEventListener('visibilitychange',automaticRefresh);timer=setInterval(automaticRefresh,15000);void refresh();}
  window.OpenNEXTConsoleTopups={render,mount,destroy,refresh};
})();
