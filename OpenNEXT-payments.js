(function(root){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const usd=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
  const methods=[['credit_card','Credit card','Pay securely on the payment provider\'s checkout.'],['paypal','PayPal','Continue to PayPal to authorize payment.']];
  const returnToPurchase=c=>Boolean(root.OpenNEXTSpotMarket?.hasPending?.(c));
  const purchaseBack=c=>returnToPurchase(c)?'<button class="btn secondary" type="button" data-act="spot-checkout-resume">Back to purchase</button>':'';
  function safeCheckoutUrl(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw Error('Invalid payment checkout URL.');return url.href;}
  function modal(c,type,extra={}){
    if(type==='pay-start'||type==='topup'){
      const amount=Number(c.S.paymentDraft?.amount)||100,other=![100,500,1000].includes(amount);
      return {title:'Add credit',body:`<form data-form="payment-amount" data-order-id="${esc(extra.orderId||'')}"><p class="form-note">Choose a top-up amount. Your balance changes only after the payment provider confirms payment.</p>${returnToPurchase(c)?'<p class="form-note">Adding credit will not automatically purchase capacity. Return to your purchase to confirm payment.</p>':''}<div class="pay-presets">${[100,500,1000].map(v=>`<label><input type="radio" name="preset" value="${v}" ${amount===v?'checked':''}><span>${usd(v)}</span></label>`).join('')}<label><input type="radio" name="preset" value="other" ${other?'checked':''}><span>Other</span></label></div><label class="form-label">Other amount · USD<input class="field" type="number" name="custom" min="1" max="100000" step="0.01" value="${other?esc(amount):''}" placeholder="Enter amount"></label><div class="modal-footer">${purchaseBack(c)}<button class="btn secondary" type="button" data-act="close-modal">Cancel</button><button class="btn" type="submit">Process</button></div></form>`};
    }
    if(type==='payment-method'){
      const draft=c.S.paymentDraft;if(!draft)return {title:'Select an amount',body:'<p>Start a new credit top-up.</p>'};
      return {title:'Choose payment method',body:`<div class="pay-summary"><span>Credit top-up</span><strong>${usd(draft.amount)}</strong></div><form data-form="payment-method"><div class="payment-methods">${methods.map(([value,label,note],i)=>`<label class="payment-method"><input type="radio" name="method" value="${value}" ${(draft.method?draft.method===value:i===0)?'checked':''} required><span><strong>${label}</strong><small>${note}</small></span></label>`).join('')}</div><p class="form-note">Payment details are entered with your selected payment provider, never on this page. Promotional credit cannot be withdrawn.</p><div class="payment-error form-note" role="alert" hidden></div><div class="modal-footer">${purchaseBack(c)}<button class="btn secondary" type="button" data-act="pay-start">Back</button><button class="btn" type="submit">Proceed to payment</button></div></form>`};
    }
    if(type==='payment-provider'){
      const draft=c.S.paymentDraft;let url;try{url=safeCheckoutUrl(draft?.checkoutUrl);}catch{return {title:'Payment setup required',body:'<p class="form-note">A secure payment link is not available. No credit has been added.</p><div class="modal-footer">'+purchaseBack(c)+'</div>'};}
      return {title:'Complete your credit top-up',body:`<div class="pay-summary"><span>Credit top-up</span><strong>${usd(draft.amount)}</strong></div><p class="form-note">Continue in the payment provider's secure checkout. Return here after paying or cancelling. Your balance changes only after confirmed payment; no capacity purchase is automatic.</p><div class="modal-footer">${purchaseBack(c)}<button class="btn secondary" type="button" data-act="payment-method-back">Back</button><a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open secure checkout</a></div>`};
    }
    return null;
  }
  function action(c,act,b){if(act==='pay-start'){c.open('pay-start',{orderId:b?.dataset?.orderId});return true;}if(act==='payment-method-back'){c.open('payment-method');return true;}if(['pay-confirm','pay-fail','pay-cancel','cashout-settle'].includes(act)){c.toast('Payment status is confirmed by the payment service, not from this page.');return true;}return false;}
  function submit(c,form,data){
    if(form.dataset.form==='payment-amount'){
      const amount=Number(data.preset==='other'?data.custom:data.preset);
      if(!Number.isFinite(amount)||amount<1||amount>100000||Math.abs(amount*100-Math.round(amount*100))>0.000001){c.toast('Enter an amount from $1.00 to $100,000.00 with no more than two decimal places.');return true;}
      c.S.paymentDraft={amount,orderId:form.dataset.orderId||null,idempotencyKey:root.crypto.randomUUID()};c.open('payment-method');return true;
    }
    if(form.dataset.form!=='payment-method')return false;
    const b=form.querySelector('button[type="submit"],button:not([type])'),error=form.querySelector('.payment-error'),draft=c.S.paymentDraft;
    if(!draft||!methods.some(([m])=>m===data.method)){c.toast('Choose an amount and payment method.');return true;}
    b.disabled=true;error.hidden=true;draft.method=data.method;const accountId=c.S.user?.id;
    Promise.resolve().then(()=>{if(c.S.user?.id!==accountId||c.S.paymentDraft!==draft||!form.isConnected)return null;if(!root.OpenNEXTAuth?.request)throw Error('Secure top-up is not connected yet. No credit has been added.');return root.OpenNEXTAuth.request('/api/billing/checkout',{method:'POST',body:JSON.stringify({amount:draft.amount,orderId:draft.orderId,idempotencyKey:draft.idempotencyKey,method:data.method})});}).then(result=>{if(!result)return;const url=safeCheckoutUrl(result.checkoutUrl);if(c.S.user?.id!==accountId||c.S.paymentDraft!==draft||!form.isConnected)return;draft.checkoutUrl=url;c.open('payment-provider');}).catch(e=>{if(form.isConnected){error.textContent=e.message;error.hidden=false;}}).finally(()=>{if(b.isConnected)b.disabled=false;});return true;
  }
  root.OpenNEXTPayments={modal,action,submit};
})(typeof window!=='undefined'?window:globalThis);
