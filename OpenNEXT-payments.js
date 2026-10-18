(function(root){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const usd=v=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(v);
  const methods=[['credit_card','Credit card','Pay securely on the payment provider\'s checkout.'],['paypal','PayPal','Continue to PayPal to authorize payment.']];
  function modal(c,type,extra={}){
    if(type==='pay-start'||type==='topup')return {title:'Add credit',body:`<form data-form="payment-amount" data-order-id="${esc(extra.orderId||'')}"><p class="form-note">Choose a top-up amount. Your balance changes only after the payment provider confirms payment.</p><div class="pay-presets">${[100,500,1000].map((v,i)=>`<label><input type="radio" name="preset" value="${v}" ${i===0?'checked':''}><span>${usd(v)}</span></label>`).join('')}<label><input type="radio" name="preset" value="other"><span>Other</span></label></div><label class="form-label">Other amount · USD<input class="field" type="number" name="custom" min="1" max="100000" step="0.01" placeholder="Enter amount"></label><div class="modal-footer"><button class="btn secondary" type="button" data-act="close-modal">Cancel</button><button class="btn">Process</button></div></form>`};
    if(type==='payment-method'){
      const draft=c.S.paymentDraft;if(!draft)return {title:'Select an amount',body:'<p>Start a new credit top-up.</p>'};
      return {title:'Choose payment method',body:`<div class="pay-summary"><span>Credit top-up</span><strong>${usd(draft.amount)}</strong></div><form data-form="payment-method"><div class="payment-methods">${methods.map(([value,label,note],i)=>`<label class="payment-method"><input type="radio" name="method" value="${value}" ${i===0?'checked':''} required><span><strong>${label}</strong><small>${note}</small></span></label>`).join('')}</div><p class="form-note">Payment details are entered with your selected payment provider, never on this page. Promotional credit cannot be withdrawn.</p><div class="payment-error form-note" role="alert" hidden></div><div class="modal-footer"><button class="btn secondary" type="button" data-act="pay-start">Back</button><button class="btn">Proceed to payment</button></div></form>`};
    }
    return null;
  }
  function action(c,act,b){if(act==='pay-start'){c.open('pay-start',{orderId:b?.dataset?.orderId});return true;}if(['pay-confirm','pay-fail','pay-cancel','cashout-settle'].includes(act)){c.toast('Payment status is confirmed by the payment service, not from this page.');return true;}return false;}
  function submit(c,form,data){
    if(form.dataset.form==='payment-amount'){
      const amount=Number(data.preset==='other'?data.custom:data.preset);
      if(!Number.isFinite(amount)||amount<1||amount>100000||Math.abs(amount*100-Math.round(amount*100))>0.000001){c.toast('Enter an amount from $1.00 to $100,000.00 with no more than two decimal places.');return true;}
      c.S.paymentDraft={amount,orderId:form.dataset.orderId||null,idempotencyKey:root.crypto.randomUUID()};c.open('payment-method');return true;
    }
    if(form.dataset.form!=='payment-method')return false;
    const b=form.querySelector('button[type="submit"],button:not([type])'),error=form.querySelector('.payment-error'),draft=c.S.paymentDraft;
    if(!draft||!methods.some(([m])=>m===data.method)){c.toast('Choose an amount and payment method.');return true;}
    b.disabled=true;error.hidden=true;
    root.OpenNEXTAuth.request('/api/billing/checkout',{method:'POST',body:JSON.stringify({...draft,method:data.method})}).then(result=>{const url=new URL(result.checkoutUrl);if(url.protocol!=='https:')throw Error('Invalid payment checkout URL.');root.location.assign(url.href);}).catch(e=>{error.textContent=e.message;error.hidden=false;}).finally(()=>{if(b.isConnected)b.disabled=false;});return true;
  }
  root.OpenNEXTPayments={modal,action,submit};
})(typeof window!=='undefined'?window:globalThis);
