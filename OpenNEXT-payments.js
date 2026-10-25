(function(root){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const usd=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
  const methods=[['credit_card','Credit card'],['paypal','PayPal']];
  let currentContext=null,pollTimer=null,listenersBound=false;
  const identity=c=>{const user=c.S.user,verified=typeof root.OpenNEXTAuth?.getUser==='function'?root.OpenNEXTAuth.getUser():user;return user?.id&&verified?.id===user.id&&c.S.auth!==false?JSON.stringify([user.id,String(c.S.role||user.role||'').toLowerCase(),String(verified.role||'').toLowerCase(),!!user.demo||!!verified.demo||!!root.OpenNEXTDemo?.active]):'';};
  const ownRequests=c=>(c.S.topupRequests||[]).filter(row=>row?.accountId===c.S.user?.id);
  const requestFor=(c,id)=>ownRequests(c).find(row=>row.id===id);
  const purchaseReference=c=>root.OpenNEXTSpotMarket?.hasPending?.(c)?String(root.OpenNEXTSpotMarket?.purchaseReference?.(c)||''):'';
  const canReturn=(c,request)=>request?.status==='Approved'&&!!request.purchaseReference&&request.purchaseReference===purchaseReference(c);
  function safeCheckoutUrl(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid payment checkout URL.');return url.href;}
  function selectCustomAmount(event){
    const input=event.target;if(input?.name!=='custom')return;
    const form=input.closest?.('form[data-form="payment-amount"]');if(!form)return;
    const other=form.querySelector('input[name="preset"][value="other"]');if(other)other.checked=true;
  }
  root.document?.addEventListener?.('input',selectCustomAmount);
  root.document?.addEventListener?.('change',selectCustomAmount);
  function modal(c,type,extra={}){
    if(type==='pay-start'||type==='topup'){
      const amount=Number(c.S.paymentDraft?.amount)||100,other=![100,500,1000].includes(amount);
      const linked=extra.spotCheckout===true?purchaseReference(c):typeof extra.purchaseReference==='string'&&extra.purchaseReference===purchaseReference(c)?extra.purchaseReference:'';
      return {title:'Add credit',body:'<form data-form="payment-amount" data-order-id="'+esc(extra.orderId||'')+'" data-purchase-reference="'+esc(linked)+'"><p class="form-note">Choose a top-up amount. Credit is added after operations verifies your payment.</p><div class="pay-presets">'+[100,500,1000].map(value=>'<label><input type="radio" name="preset" value="'+value+'" '+(amount===value?'checked':'')+'><span>'+usd(value)+'</span></label>').join('')+'<label><input type="radio" name="preset" value="other" '+(other?'checked':'')+'><span>Other</span></label></div><label class="form-label">Other amount · USD<input class="field" type="number" name="custom" min="1" max="100000" step="0.01" value="'+(other?esc(amount):'')+'" placeholder="Enter amount"></label><div class="modal-footer"><button class="btn secondary" type="button" data-act="close-modal">Cancel</button><button class="btn" type="submit">Process</button></div></form>'};
    }
    if(type==='payment-method'){
      const draft=c.S.paymentDraft;if(!draft)return {title:'Select an amount',body:'<p>Start a new credit top-up.</p>'};
      return {title:'Choose payment method',body:'<div class="pay-summary"><span>Credit top-up</span><strong>'+usd(draft.amount)+'</strong></div><form data-form="payment-method"><div class="payment-methods">'+methods.map(([value,label],index)=>'<label class="payment-method"><input type="radio" name="method" value="'+value+'" '+((draft.method?draft.method===value:index===0)?'checked':'')+' required><span><strong>'+label+'</strong></span></label>').join('')+'</div><p class="form-note">Submit your top-up request for payment verification. Credit is added only after operations approves the received funds. Promotional credit cannot be withdrawn.</p><div class="payment-error form-note" role="alert" hidden></div><div class="modal-footer"><button class="btn secondary" type="button" data-act="payment-amount-back">Back</button><button class="btn" type="submit">Proceed to payment</button></div></form>'};
    }
    if(type==='payment-topup-status'){
      const request=requestFor(c,extra.id);
      if(!request)return {title:'Top-up status',body:'<p class="form-note">This top-up request is unavailable. Refresh your account or check your notifications.</p><div class="modal-footer"><button class="btn secondary" type="button" data-act="payment-refresh-status">Refresh</button><button class="btn" type="button" data-act="close-modal">Close</button></div>'};
      const approved=request.status==='Approved',rejected=request.status==='Rejected';
      const title=approved?'Credit added.':rejected?'Top-up not approved.':'Top-up in progress.';
      const message=approved?usd(request.amount)+' has been credited to your account.':rejected?'Your '+usd(request.amount)+' top-up was not approved. No credit was added.':'Your '+usd(request.amount)+' top-up request has been received and is awaiting payment verification. We will notify you when the review is complete.';
      return {title,body:'<div class="pay-summary"><span>Credit top-up</span><strong>'+usd(request.amount)+'</strong></div><p class="form-note" role="status">'+esc(message)+'</p>'+(rejected&&request.reason?'<p class="form-note">'+esc(request.reason)+'</p>':'')+'<div class="payment-error form-note" role="alert" hidden></div><div class="modal-footer">'+(canReturn(c,request)?'<button class="btn secondary" type="button" data-act="payment-return-purchase" data-id="'+esc(request.id)+'">Back to purchase</button>':'')+'<button class="btn" type="button" data-act="close-modal">Done</button></div>'};
    }
    // Old secure provider links remain readable. New submissions never create a
    // provider session or treat a browser payment return as proof of payment.
    if(type==='payment-provider'){
      const draft=c.S.paymentDraft;let url;try{url=safeCheckoutUrl(draft?.checkoutUrl);}catch{return {title:'Payment setup required',body:'<p class="form-note">A secure payment link is not available. No credit has been added.</p>'};}
      return {title:'Complete your credit top-up',body:'<div class="pay-summary"><span>Credit top-up</span><strong>'+usd(draft.amount)+'</strong></div><p class="form-note">Continue in the payment provider\'s secure checkout. Your balance changes only after confirmed payment.</p><div class="modal-footer"><button class="btn secondary" type="button" data-act="payment-method-back">Back</button><a class="btn" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Open secure checkout</a></div>'};
    }
    return null;
  }
  function safeToRender(c){return !c.S.modal||['payment-topup-status','spot-credit-confirm','spot-payment-choice'].includes(c.S.modal.type);}
  async function refreshAccount(c,{render=false}={}){
    const owner=identity(c);if(!owner)throw Error('Sign in to refresh your available Credit.');
    if(typeof root.OpenNEXTExchange?.refreshBillingAccount!=='function')throw Error('Credit account updates are unavailable. Please try again later.');
    const result=await root.OpenNEXTExchange.refreshBillingAccount(c.S);
    if(identity(c)!==owner)return null;
    if(result?.confirmed!==true||result.accountId!==c.S.user?.id||result.currency!=='USD')throw Error('Your available Credit was not confirmed.');
    if(render&&safeToRender(c))c.render?.();
    bind(c);return result;
  }
  function hasPending(c){return ownRequests(c).some(request=>request.status==='Pending');}
  function refreshQuietly(){
    const c=currentContext;if(!c||!identity(c)||root.document?.hidden||(!hasPending(c)&&c.S.modal?.type!=='payment-topup-status'))return;
    refreshAccount(c,{render:true}).catch(()=>{});
  }
  function bind(c){
    currentContext=c;
    if(!listenersBound){listenersBound=true;root.addEventListener?.('focus',refreshQuietly);root.document?.addEventListener?.('visibilitychange',refreshQuietly);}
    if(identity(c)&&hasPending(c)){
      if(!pollTimer&&typeof root.setInterval==='function'){pollTimer=root.setInterval(refreshQuietly,10000);pollTimer?.unref?.();}
    }else if(pollTimer){root.clearInterval?.(pollTimer);pollTimer=null;}
  }
  async function returnToPurchase(c,id){
    const owner=identity(c),request=requestFor(c,id),reference=purchaseReference(c);
    if(!owner||!canReturn(c,request)){c.toast('This top-up is not linked to an approved purchase return.');return;}
    try{
      const account=await refreshAccount(c);
      if(!account||identity(c)!==owner||purchaseReference(c)!==reference)return;
      if(!canReturn(c,requestFor(c,id)))throw Error('This top-up has not been confirmed for the current purchase.');
      root.OpenNEXTSpotMarket.resumeCheckout(c);
    }catch(error){c.toast(error.message);}
  }
  function action(c,act,b){
    if(act==='pay-start'){c.open('pay-start',{orderId:b?.dataset?.orderId});return true;}
    if(act==='payment-amount-back'){
      if(c.S.paymentDraft?.submitted){c.toast('This request may already be recorded. Retry the same details or check your notifications.');return true;}
      c.open('pay-start',{purchaseReference:c.S.paymentDraft?.purchaseReference||'',orderId:c.S.paymentDraft?.orderId});return true;
    }
    if(act==='payment-method-back'){c.open('payment-method');return true;}
    if(act==='payment-return-purchase'){returnToPurchase(c,b?.dataset?.id);return true;}
    if(act==='payment-refresh-status'){refreshAccount(c,{render:true}).catch(error=>c.toast(error.message));return true;}
    if(act==='payment-topup-status'){c.open('payment-topup-status',{id:b?.dataset?.id});bind(c);return true;}
    if(['pay-confirm','pay-fail','pay-cancel','cashout-settle'].includes(act)){c.toast('Payment status is confirmed by operations, not from this page.');return true;}
    return false;
  }
  function validRequest(request,c,draft){
    return request&&typeof request.id==='string'&&/^TOPUP-[a-f0-9-]{36}$/.test(request.id)&&request.accountId===c.S.user?.id&&request.amount===draft.amount&&request.amountCents===Math.round(draft.amount*100)&&request.method===draft.method&&['Pending','Approved','Rejected'].includes(request.status)&&(request.purchaseReference||'')===(draft.purchaseReference||'');
  }
  function submit(c,form,data){
    if(form.dataset.form==='payment-amount'){
      const amount=Number(data.preset==='other'?data.custom:data.preset);
      if(!Number.isFinite(amount)||amount<1||amount>100000||Math.abs(amount*100-Math.round(amount*100))>0.000001){c.toast('Enter an amount from $1.00 to $100,000.00 with no more than two decimal places.');return true;}
      const reference=form.dataset.purchaseReference||'';
      c.S.paymentDraft={amount:Math.round(amount*100)/100,orderId:form.dataset.orderId||null,purchaseReference:reference&&reference===purchaseReference(c)?reference:'',owner:identity(c),idempotencyKey:root.crypto.randomUUID()};
      c.open('payment-method');return true;
    }
    if(form.dataset.form!=='payment-method')return false;
    const button=form.querySelector('button[type="submit"],button:not([type])'),error=form.querySelector('.payment-error'),draft=c.S.paymentDraft,owner=identity(c);
    if(!draft||!owner||draft.owner!==owner||!methods.some(([method])=>method===data.method)){c.toast('Choose an amount and payment method in your signed-in account.');return true;}
    if(draft.busy)return true;
    if(draft.submitted&&draft.method!==data.method){c.toast('This request may already be recorded. Retry the same payment method or check your notifications.');return true;}
    draft.busy=true;button.disabled=true;error.hidden=true;draft.method=data.method;
    const stillCurrent=()=>identity(c)===owner&&c.S.paymentDraft===draft&&form.isConnected;
    Promise.resolve().then(()=>{
      if(!stillCurrent())return null;
      if(!root.OpenNEXTAuth?.request)throw Error('Top-up requests are not connected yet. No credit has been added.');
      draft.submitted=true;
      return root.OpenNEXTAuth.request('/api/billing/topups',{method:'POST',body:JSON.stringify({amount:draft.amount,method:draft.method,idempotencyKey:draft.idempotencyKey,...(draft.purchaseReference?{purchaseReference:draft.purchaseReference}:{})})});
    }).then(result=>{
      if(!result||!stillCurrent())return;
      if(!validRequest(result.request,c,draft))throw Error('The top-up request was not confirmed. Check your notifications before trying again.');
      const request=result.request;
      c.S.topupRequests=[request,...ownRequests(c).filter(row=>row.id!==request.id)];draft.requestId=request.id;
      c.open('payment-topup-status',{id:request.id});bind(c);
      refreshAccount(c,{render:true}).catch(()=>{});
    }).catch(failure=>{if(stillCurrent()){error.textContent=failure.message;error.hidden=false;}}).finally(()=>{draft.busy=false;if(button.isConnected)button.disabled=false;});
    return true;
  }
  root.OpenNEXTPayments={modal,action,submit,bind,refreshAccount};
})(typeof window!=='undefined'?window:globalThis);
