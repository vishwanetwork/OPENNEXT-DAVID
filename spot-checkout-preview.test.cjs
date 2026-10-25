'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'OpenNEXT-spot-market-preview.js'),'utf8');
const accountSource=fs.readFileSync(path.join(__dirname,'OpenNEXT-account-profile-preview.js'),'utf8');
const paymentsSource=fs.readFileSync(path.join(__dirname,'OpenNEXT-payments.js'),'utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fixture={id:'offer-one',model:'H100 SXM',country:'Singapore',gpuCount:8,vcpu:192,memory:80,perGpuHourly:1.8,term:'Spot'};
const agent={...fixture,agentStatus:'Succeeded',serverRecord:true,status:'Published',executable:true};
const wireField=value=>{const buf=Buffer.from(value),header=Buffer.alloc(4);header.writeUInt32BE(buf.length);return Buffer.concat([header,buf]);};
const publicKey='ssh-ed25519 '+Buffer.concat([wireField('ssh-ed25519'),wireField(crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).subarray(-32))]).toString('base64');
function setup({rows=[fixture],demo=true,storage=new Map(),service,begin=true}={}){
  const listeners=new Map();
  const sandbox={crypto:crypto.webcrypto,Uint8Array,URL,URLSearchParams,Date,atob,btoa,OpenNEXTSpotCheckout:service,sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},localStorage:{getItem:()=>null},document:{querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(type,handler)=>listeners.set(type,[...(listeners.get(type)||[]),handler])}};
  const machine=vm.createContext(sandbox);vm.runInContext(accountSource,machine);vm.runInContext(source,machine);vm.runInContext(paymentsSource,machine);
  const api=sandbox.OpenNEXTSpotMarket;api.setInventory(rows);
  const ctx={S:{auth:true,user:{id:'buyer-one',demo},identity:{},role:'Buyer',balance:100,orders:[],instances:[],modal:null},messages:[],opened:[],esc,render(){},toast(message){this.messages.push(message);},open(type,data){this.S.modal={type,...data};this.opened.push(this.S.modal);},go(route){this.route=route;}};
  const row=api.testHelpers.inventoryState().rows[0];if(begin)api.testHelpers.beginCheckout(ctx,row);
  return {api,ctx,h:api.testHelpers,row,sandbox,storage,listeners,payments:sandbox.OpenNEXTPayments};
}
function form(type='spot-checkout-review'){
  const button={disabled:false,isConnected:true},error={textContent:'',hidden:true};
  return {dataset:{form:type},isConnected:true,button,error,querySelector:selector=>selector.includes('button')||selector==='[type="submit"]'?button:error};
}
async function toPayment(env,key='',hours='1'){await env.h.reviewPurchase(env.ctx,form(),{sshPublicKey:key,durationHours:hours});assert.equal(env.ctx.S.modal.type,'spot-payment-choice');}
function deposit(env){assert.equal(env.ctx.S.modal.type,'spot-credit-confirm');env.api.action(env.ctx,'spot-checkout-deposit');assert.equal(env.ctx.S.modal.type,'pay-start');}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
const wallet=()=>({confirmed:true,accountId:'buyer-one',currency:'USD',availableCredit:100});
const confirmation=input=>({confirmed:true,offerId:input.offerId,orderId:'ORDER-BACKEND-1',currency:'USD',durationHours:input.durationHours,totalCents:input.expectedPricing.totalCents});

test('Spot listing and safe checkout',async t=>{
  await t.test('fallback inventory is exclusive to an active Demo session',()=>{
    const env=setup({begin:false});env.api.setInventory(null);
    assert.equal(env.h.inventoryState().rows.length,0);
    env.sandbox.OpenNEXTDemo={active:true};
    assert.equal(env.h.inventoryState().rows.length,54);
    env.sandbox.OpenNEXTDemo.active=false;
    assert.equal(env.h.inventoryState().rows.length,0);
  });
  await t.test('table order, Capacity only GPU count, distinct Memory and rightmost action',()=>{
    const {api,ctx,h,row}=setup();
    const html=h.tableView(ctx,[row]);
    assert.match(html,/<th>Model<\/th><th>Capacity<\/th><th>Price<\/th><th>Country<\/th><th[^>]*>vCPU<\/th><th>Memory<\/th>/);
    assert.match(html,/<td class="onx-spot-number">8 GPUs<\/td>/);
    assert.match(html,/<td class="onx-spot-number" aria-label="Memory per GPU">80 GB<\/td><td><button[^>]*data-spot-buy/);
    assert.doesNotMatch(api.render(ctx),/<summary>GPU memory/);
    assert.match(h.cardView(ctx,[row]),/onx-spot-card-model[\s\S]*H100 SXM[\s\S]*8 GPUs/);
    assert.match(h.cardView(ctx,[row]),/<small>Memory<\/small><strong>80 GB/);
  });
  await t.test('review shows editable duration, aggregate computation and a flat 5% fee',()=>{
    const {api,ctx,h,row}=setup(),html=api.modal(ctx,'spot-review').body;
    assert.equal(h.checkoutTotals(row).baseCents,1440);assert.equal(h.checkoutTotals(row).feeCents,72);assert.equal(h.checkoutTotals(row).totalCents,1512);
    assert.match(html,/name="durationHours"[^>]*value="1"/);assert.match(html,/Compute \/ hour/);
    assert.match(html,/data-spot-compute>\$14\.40/);assert.match(html,/data-spot-fee>\$0\.72<\/strong>/);assert.match(html,/data-spot-total>\$15\.12<\/strong>/);
    assert.match(html,/SSH Public Key/);assert.match(html,/Proceed to payment/);
    assert.doesNotMatch(html,/Starts immediately after payment confirmation|Estimated usage|PREVIEW ONLY|Node \/ hour|Estimated total|Confirm preview|<select/);
    assert.doesNotMatch(api.render(ctx),/onx-spot-checkout-overlay/);
  });
  await t.test('duration multiplication rounds the aggregate fee rather than each hourly fee',()=>{
    const {h}=setup();
    const total=h.checkoutTotals({instanceHourly:0.1},3);
    assert.deepEqual(JSON.parse(JSON.stringify(total)),{currency:'USD',durationHours:3,hourlyCents:10,baseCents:30,feeCents:2,totalCents:32});
    const fractional=h.checkoutTotals({instanceHourly:1.11},2.5);
    assert.equal(fractional.baseCents,278);assert.equal(fractional.feeCents,14);assert.equal(fractional.totalCents,292);
    const halfCent=h.checkoutTotals({instanceHourly:0.25},0.58);
    assert.equal(halfCent.baseCents,15);assert.equal(halfCent.feeCents,1);assert.equal(halfCent.totalCents,16);
  });
  await t.test('invalid, zero, overprecise and unsafe duration totals cannot advance checkout',async()=>{
    for(const hours of ['',null,undefined,'0','-1','abc','NaN','Infinity','1e3','1.001','90071992547409910']){
      const env=setup(),f=form();await env.h.reviewPurchase(env.ctx,f,{durationHours:hours,sshPublicKey:''});
      assert.equal(env.ctx.S.modal.type,'spot-review',String(hours));assert.match(f.error.textContent,/duration|total/,String(hours));assert.equal(env.ctx.S.balance,100);
    }
    const env=setup();assert.throws(()=>env.h.checkoutTotals({instanceHourly:0.01},0.01),/payable total/);
  });
  await t.test('duration input updates the subtotal, flat fee and total in place',()=>{
    const env=setup(),summary={innerHTML:''},error={textContent:'Previous error'};
    env.api.bind(env.ctx);
    const input={value:'4',matches:selector=>selector==='[data-spot-hours]',closest:()=>({querySelector:selector=>selector==='[data-spot-checkout-totals]'?summary:error})};
    for(const listener of env.listeners.get('input')||[])listener({target:input});
    assert.equal(env.h.pending(env.ctx).hoursRaw,'4');assert.match(summary.innerHTML,/data-spot-compute>\$57\.60/);assert.match(summary.innerHTML,/data-spot-fee>\$2\.88/);assert.match(summary.innerHTML,/data-spot-total>\$60\.48/);assert.equal(error.textContent,'');
  });
  await t.test('optional SSH accepts blank and payment options are enabled',async()=>{
    const env=setup();await toPayment(env);
    const html=env.api.modal(env.ctx,'spot-payment-choice').body;
    assert.match(html,/Available Credit: \$100\.00/);assert.match(html,/Direct Pay/);assert.doesNotMatch(html,/data-act="spot-checkout-credit" disabled/);
    assert.doesNotMatch(html,/hourly rate, not a prepaid duration|actual metered usage/);
    assert.equal(env.h.pending(env.ctx).sshPublicKey,'');assert.equal(env.ctx.S.balance,100);
  });
  await t.test('invalid/private SSH stays on review; valid public key persists across modal navigation',async()=>{
    const env=setup(),f=form();await env.h.reviewPurchase(env.ctx,f,{durationHours:'1',sshPublicKey:'-----BEGIN OPENSSH PRIVATE KEY-----'});
    assert.equal(env.ctx.S.modal.type,'spot-review');assert.match(f.error.textContent,/public key|private key/i);
    await toPayment(env,publicKey);env.api.action(env.ctx,'spot-checkout-review');
    assert.match(env.api.modal(env.ctx,'spot-review').body,new RegExp(publicKey.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  });
  await t.test('Direct Pay is visible but never calls a gateway or creates an order',async()=>{
    const env=setup();await toPayment(env);env.api.action(env.ctx,'spot-checkout-direct');
    assert.match(env.ctx.messages.at(-1),/not connected/);assert.equal(env.ctx.S.balance,100);assert.equal(env.ctx.S.orders.length,0);
  });
  await t.test('insufficient credit shows Deposit Credit and opens top-up only after selection',async()=>{
    const env=setup();env.ctx.S.balance=0;await toPayment(env,publicKey,'12.5');await env.h.chooseCredit(env.ctx);
    const html=env.api.modal(env.ctx,'spot-credit-confirm').body;
    assert.match(html,/onx-spot-credit-balance is-insufficient/);assert.match(html,/data-act="spot-checkout-deposit"[^>]*>Deposit Credit/);
    assert.doesNotMatch(html,/data-act="spot-checkout-authorize"|Authorize metered Spot usage|No fixed rental duration|Provisioning and billing begin/);
    assert.equal(env.storage.size,0);deposit(env);
    assert.equal(env.ctx.S.modal.type,'pay-start');assert.equal(env.ctx.S.balance,0);assert.equal(env.storage.size,1);
    assert.doesNotMatch(env.payments.modal(env.ctx,'pay-start').body,/Back to purchase/);
    env.api.resumeCheckout(env.ctx);assert.equal(env.ctx.S.modal.type,'spot-payment-choice');assert.equal(env.h.pending(env.ctx).sshPublicKey,publicKey);assert.equal(env.h.pending(env.ctx).durationHours,12.5);
    await env.h.chooseCredit(env.ctx);assert.equal(env.ctx.S.modal.type,'spot-credit-confirm');assert.match(env.api.modal(env.ctx,'spot-credit-confirm').body,/Deposit Credit/);
    assert.doesNotMatch(env.api.modal(env.ctx,'spot-credit-confirm').body,/Return to your purchase|Credit confirmation is not connected/);
    assert.equal(env.ctx.S.balance,0);assert.equal(env.ctx.S.orders.length,0);
  });
  await t.test('top-up return updates balance only from authoritative account response, never auto-buys',async()=>{
    let purchaseCalls=0;const env=setup({service:{getCreditBalance:async()=>wallet(),beginPurchase:async()=>{purchaseCalls++;}}});env.ctx.S.balance=0;
    await toPayment(env);await env.h.chooseCredit(env.ctx);deposit(env);env.api.resumeCheckout(env.ctx);
    assert.equal(env.ctx.S.balance,0);assert.equal(purchaseCalls,0);
    await env.h.chooseCredit(env.ctx);assert.equal(env.ctx.S.balance,100);assert.equal(env.ctx.S.modal.type,'spot-credit-confirm');assert.equal(purchaseCalls,0);
  });
  await t.test('wrong-account and unconfirmed balances fail closed',async()=>{
    for(const response of [{...wallet(),confirmed:false},{...wallet(),accountId:'someone-else'},{...wallet(),availableCredit:null}]){
      const env=setup({service:{getCreditBalance:async()=>response}});env.ctx.S.balance=0;await toPayment(env);await env.h.chooseCredit(env.ctx);deposit(env);env.api.resumeCheckout(env.ctx);await env.h.chooseCredit(env.ctx);
      assert.equal(env.ctx.S.balance,0);assert.equal(env.ctx.S.modal.type,'spot-payment-choice');assert.match(env.ctx.messages.at(-1),/did not confirm/);
    }
  });
  await t.test('Demo and fixture rows never invoke purchase adapter even with sufficient Credit',async()=>{
    for(const variant of [{rows:[agent],demo:true},{rows:[fixture],demo:false}]){
      let calls=0;const env=setup({...variant,service:{getCreditBalance:async()=>wallet(),beginPurchase:async()=>{calls++;}}});
      await toPayment(env);await env.h.chooseCredit(env.ctx);await env.h.authorizeCredit(env.ctx);
      assert.equal(calls,0);assert.equal(env.ctx.S.balance,100);assert.equal(env.ctx.S.orders.length,0);assert.match(env.ctx.messages.at(-1),/testing only/);
    }
  });
  await t.test('real confirmed flow submits explicit duration and aggregate fee without mutating client ledger',async()=>{
    let calls=0,payload;const env=setup({rows:[agent],demo:false,service:{getCreditBalance:async()=>wallet(),beginPurchase:async input=>{calls++;payload=input;return confirmation(input);}}});
    await toPayment(env,'','2.5');await env.h.authorizeCredit(env.ctx);assert.equal(calls,0);
    await env.h.chooseCredit(env.ctx);assert.equal(calls,0);await env.h.authorizeCredit(env.ctx);
    assert.equal(calls,1);assert.equal(payload.pricingVersion,'duration-v1');assert.equal(payload.durationHours,2.5);assert.equal(payload.sshPublicKey,null);
    assert.deepEqual(JSON.parse(JSON.stringify(payload.expectedPricing)),{currency:'USD',durationHours:2.5,hourlyCents:1440,baseCents:3600,feeCents:180,totalCents:3780});
    assert.equal(payload.expectedHourly,undefined);assert.equal(env.ctx.S.balance,100);assert.equal(env.ctx.S.orders.length,0);
    assert.equal(env.ctx.S.modal.type,'spot-purchase-complete');assert.equal(env.api.hasPending(env.ctx),false);
    await env.h.authorizeCredit(env.ctx);assert.equal(calls,1);
  });
  await t.test('exact available credit is sufficient but an authoritative shortfall prevents a purchase',async()=>{
    let calls=0;const env=setup({rows:[agent],demo:false,service:{getCreditBalance:async()=>({...wallet(),availableCredit:30.24}),beginPurchase:async input=>{calls++;return confirmation(input);}}});
    env.ctx.S.balance=30.24;await toPayment(env,'','2');await env.h.chooseCredit(env.ctx);
    const html=env.api.modal(env.ctx,'spot-credit-confirm').body;assert.doesNotMatch(html,/is-insufficient|Deposit Credit/);assert.match(html,/data-act="spot-checkout-authorize"/);
    await env.h.authorizeCredit(env.ctx);assert.equal(calls,1);
    const short=setup({rows:[agent],demo:false,service:{getCreditBalance:async()=>({...wallet(),availableCredit:30.23}),beginPurchase:async()=>{calls++;}}});
    await toPayment(short,'','2');await short.h.chooseCredit(short.ctx);await short.h.authorizeCredit(short.ctx);
    assert.equal(calls,1);assert.equal(short.ctx.S.modal.type,'spot-credit-confirm');assert.match(short.api.modal(short.ctx,'spot-credit-confirm').body,/is-insufficient[\s\S]*Deposit Credit/);
  });
  await t.test('a legacy metered adapter never receives a duration-based purchase',async()=>{
    let calls=0;const env=setup({rows:[agent],demo:false,service:{getCreditBalance:async()=>wallet(),beginMeteredPurchase:async()=>{calls++;}}});
    await toPayment(env,'','2');await env.h.chooseCredit(env.ctx);await env.h.authorizeCredit(env.ctx);
    assert.equal(calls,0);assert.match(env.ctx.messages.at(-1),/not connected/);assert.equal(env.ctx.S.modal.type,'spot-credit-confirm');
  });
  await t.test('confirmation must match the offer, currency, full total and duration',async()=>{
    for(const mismatch of [{confirmed:false},{offerId:'another-offer'},{currency:'EUR'},{durationHours:1},{totalCents:1},{orderId:''}]){
      const env=setup({rows:[agent],demo:false,service:{getCreditBalance:async()=>wallet(),beginPurchase:async input=>({...confirmation(input),...mismatch})}});
      await toPayment(env,'','2');await env.h.chooseCredit(env.ctx);await env.h.authorizeCredit(env.ctx);
      assert.notEqual(env.ctx.S.modal.type,'spot-purchase-complete');assert.match(env.ctx.messages.at(-1),/not been confirmed/);assert.equal(env.ctx.S.orders.length,0);assert.equal(env.ctx.S.balance,100);
    }
  });
  await t.test('unconfigured and unconfirmed real purchases never claim success',async()=>{
    for(const result of [null,{confirmed:false}]){
      const service={getCreditBalance:async()=>wallet()};if(result)service.beginPurchase=async()=>result;
      const env=setup({rows:[agent],demo:false,service});await toPayment(env);await env.h.chooseCredit(env.ctx);await env.h.authorizeCredit(env.ctx);
      assert.equal(env.ctx.S.modal.type,'spot-credit-confirm');assert.equal(env.ctx.S.orders.length,0);assert.equal(env.ctx.S.balance,100);
      assert.match(env.ctx.messages.at(-1),/not connected|not been confirmed/);
    }
  });
  await t.test('quote changes during SSH validation require review again',async()=>{
    const env=setup(),gate=deferred();env.sandbox.OpenNEXTAccountProfile.fingerprint=()=>gate.promise;
    const promise=env.h.reviewPurchase(env.ctx,form(),{durationHours:'1',sshPublicKey:publicKey});
    env.api.setInventory([{...fixture,perGpuHourly:3}]);gate.resolve('SHA256:test');await promise;
    assert.equal(env.ctx.S.modal.type,'spot-review');assert.equal(env.h.pending(env.ctx).reviewRequired,true);assert.match(env.ctx.messages.at(-1),/offer has changed/);
  });
  await t.test('duration changes during review SSH validation cannot advance to payment',async()=>{
    const env=setup(),gate=deferred(),f=form();env.sandbox.OpenNEXTAccountProfile.fingerprint=()=>gate.promise;
    const promise=env.h.reviewPurchase(env.ctx,f,{durationHours:'2',sshPublicKey:publicKey});
    env.h.pending(env.ctx).hoursRaw='3';gate.resolve('SHA256:test');await promise;
    assert.equal(env.ctx.S.modal.type,'spot-review');assert.match(f.error.textContent,/duration changed/);
  });
  await t.test('quote changes during balance refresh prevent any purchase call',async()=>{
    const gate=deferred();let calls=0;const env=setup({rows:[agent],demo:false,service:{getCreditBalance:()=>gate.promise,beginPurchase:async()=>{calls++;}}});
    await toPayment(env);await env.h.chooseCredit(env.ctx);const promise=env.h.authorizeCredit(env.ctx);
    env.api.setInventory([{...agent,perGpuHourly:3}]);gate.resolve(wallet());await promise;
    assert.equal(calls,0);assert.equal(env.ctx.S.modal.type,'spot-review');assert.equal(env.h.pending(env.ctx).reviewRequired,true);
  });
  await t.test('quote changes during final SSH validation prevent any purchase call',async()=>{
    let calls=0;const env=setup({rows:[agent],demo:false,service:{getCreditBalance:async()=>wallet(),beginPurchase:async()=>{calls++;}}});
    await toPayment(env,publicKey);await env.h.chooseCredit(env.ctx);
    const gate=deferred(),started=deferred();env.sandbox.OpenNEXTAccountProfile.fingerprint=()=>{started.resolve();return gate.promise;};
    const promise=env.h.authorizeCredit(env.ctx);await started.promise;env.api.setInventory([{...agent,perGpuHourly:3}]);gate.resolve('SHA256:test');await promise;
    assert.equal(calls,0);assert.equal(env.ctx.S.modal.type,'spot-review');
  });
  await t.test('duration changes during final balance or SSH validation prevent purchase dispatch',async()=>{
    for(const phase of ['balance','ssh']){
      const gate=deferred(),started=deferred();let calls=0;
      const env=setup({rows:[agent],demo:false,service:{getCreditBalance:()=>phase==='balance'?(started.resolve(),gate.promise):Promise.resolve(wallet()),beginPurchase:async()=>{calls++;return {confirmed:false};}}});
      await toPayment(env,publicKey,'2');await env.h.chooseCredit(env.ctx);
      if(phase==='ssh')env.sandbox.OpenNEXTAccountProfile.fingerprint=()=>{started.resolve();return gate.promise;};
      const promise=env.h.authorizeCredit(env.ctx);await started.promise;env.h.pending(env.ctx).hoursRaw='3';gate.resolve(phase==='balance'?wallet():'SHA256:test');await promise;
      assert.equal(calls,0,phase);assert.match(env.ctx.messages.at(-1),/changed|review|duration/i,phase);
    }
  });
  await t.test('stored top-up draft restores only for its account and never creates an auto-pay action',async()=>{
    const first=setup();first.ctx.S.balance=0;await toPayment(first,publicKey,'3.25');await first.h.chooseCredit(first.ctx);deposit(first);
    const second=setup({storage:first.storage,begin:false});
    assert.equal(second.api.hasPending(second.ctx),true);assert.equal(second.h.pending(second.ctx).balanceNeedsRefresh,true);assert.equal(second.h.pending(second.ctx).sshPublicKey,publicKey);assert.equal(second.h.pending(second.ctx).durationHours,3.25);assert.equal(second.h.pending(second.ctx).hoursRaw,'3.25');
    second.ctx.S.user.id='different-account';assert.equal(second.api.hasPending(second.ctx),false);
  });
  await t.test('stored legacy or invalid-duration purchases are not silently authorized',async()=>{
    const first=setup();first.ctx.S.balance=0;await toPayment(first);await first.h.chooseCredit(first.ctx);deposit(first);
    const [key,value]=[...first.storage][0],saved=JSON.parse(value);
    for(const override of [{version:1},{durationHours:0},{durationHours:-1},{durationHours:'NaN'},{durationHours:'90071992547409910'}]){
      const env=setup({storage:new Map([[key,JSON.stringify({...saved,...override})]]),begin:false});
      assert.equal(env.api.hasPending(env.ctx),false);assert.equal(env.ctx.S.orders.length,0);
    }
  });
  await t.test('top-up steps never show Back to purchase before an approved purchase-linked request',async()=>{
    const env=setup();await toPayment(env);env.h.openTopup(env.ctx);env.ctx.S.paymentDraft={amount:100,checkoutUrl:'https://checkout.example.test/session',idempotencyKey:'topup'};
    for(const type of ['pay-start','payment-method','payment-provider'])assert.doesNotMatch(env.payments.modal(env.ctx,type).body,/Back to purchase/);
    const provider=env.payments.modal(env.ctx,'payment-provider').body;assert.match(provider,/target="_blank" rel="noopener noreferrer"/);assert.equal(env.ctx.S.balance,100);
    const purchaseReference=env.api.purchaseReference(env.ctx);
    const request={id:'TOPUP-12345678-1234-1234-1234-123456789012',accountId:'buyer-one',amount:100,status:'Pending',purchaseReference};
    env.ctx.S.topupRequests=[request];
    assert.doesNotMatch(env.payments.modal(env.ctx,'payment-topup-status',{id:request.id}).body,/Back to purchase/);
    request.status='Approved';assert.match(env.payments.modal(env.ctx,'payment-topup-status',{id:request.id}).body,/Back to purchase/);
    request.purchaseReference='another-purchase';assert.doesNotMatch(env.payments.modal(env.ctx,'payment-topup-status',{id:request.id}).body,/Back to purchase/);
    delete request.purchaseReference;assert.doesNotMatch(env.payments.modal(env.ctx,'payment-topup-status',{id:request.id}).body,/Back to purchase/);
  });
  await t.test('top-up return can refresh from the verified billing account service',async()=>{
    const env=setup();env.ctx.S.balance=0;await toPayment(env,publicKey,'2');await env.h.chooseCredit(env.ctx);deposit(env);env.api.resumeCheckout(env.ctx);
    let refreshes=0;env.sandbox.OpenNEXTExchange={refreshBillingAccount:async()=>{refreshes++;return wallet();}};
    await env.h.chooseCredit(env.ctx);assert.equal(refreshes,1);assert.equal(env.ctx.S.balance,100);assert.equal(env.ctx.S.modal.type,'spot-credit-confirm');assert.equal(env.ctx.S.orders.length,0);
  });
  await t.test('normal Credit authorization retains the same idempotency key through uncertain result and reload',async()=>{
    let savedKey;const env=setup({rows:[agent],demo:false,service:{getCreditBalance:async()=>wallet(),beginPurchase:async payload=>{savedKey=payload.idempotencyKey;return {confirmed:false};}}});
    await toPayment(env,publicKey);await env.h.chooseCredit(env.ctx);await env.h.authorizeCredit(env.ctx);assert.equal(env.storage.size,1);
    const restored=setup({rows:[agent],demo:false,storage:env.storage,begin:false});assert.equal(restored.h.pending(restored.ctx).idempotencyKey,savedKey);assert.equal(restored.h.pending(restored.ctx).sshPublicKey,publicKey);
  });
  await t.test('uncertain payment freezes cancellation, edits and replacement purchases',async()=>{
    for(const outcome of ['unconfirmed','network']){
      let calls=0;const env=setup({rows:[agent],demo:false,service:{getCreditBalance:async()=>wallet(),beginPurchase:async()=>{calls++;if(outcome==='network')throw new Error('Connection closed before confirmation.');return {confirmed:false};}}});
      await toPayment(env,publicKey,'2');await env.h.chooseCredit(env.ctx);await env.h.authorizeCredit(env.ctx);
      const draft=env.h.pending(env.ctx),key=draft.idempotencyKey,stored=[...env.storage.values()][0];assert.equal(draft.paymentSubmitted,true);
      for(const action of ['spot-checkout-review','spot-checkout-cancel']){
        env.api.action(env.ctx,action);assert.equal(env.h.pending(env.ctx),draft);assert.equal(env.ctx.S.modal.type,'spot-credit-confirm');assert.match(env.ctx.messages.at(-1),/confirmation is pending/);
      }
      env.h.beginCheckout(env.ctx,env.row);assert.equal(env.h.pending(env.ctx),draft);assert.match(env.ctx.messages.at(-1),/awaiting confirmation/);
      const f=form();await env.h.reviewPurchase(env.ctx,f,{durationHours:'4',sshPublicKey:''});assert.match(f.error.textContent,/confirmation is pending/);
      assert.equal(draft.durationHours,2);assert.equal(draft.sshPublicKey,publicKey);assert.equal(draft.idempotencyKey,key);assert.equal([...env.storage.values()][0],stored);assert.equal(calls,1);
    }
  });
  await t.test('uncertain retry after reload uses the identical purchase payload and idempotency key',async()=>{
    const payloads=[],service={getCreditBalance:async()=>wallet(),beginPurchase:async input=>{payloads.push(JSON.parse(JSON.stringify(input)));return {confirmed:false};}};
    const first=setup({rows:[agent],demo:false,service});await toPayment(first,publicKey,'2.5');await first.h.chooseCredit(first.ctx);await first.h.authorizeCredit(first.ctx);await first.h.authorizeCredit(first.ctx);
    assert.equal(payloads.length,2);assert.deepEqual(payloads[1],payloads[0]);
    const restored=setup({rows:[agent],demo:false,storage:first.storage,service,begin:false});assert.equal(restored.h.pending(restored.ctx).paymentSubmitted,true);
    await restored.h.chooseCredit(restored.ctx);await restored.h.authorizeCredit(restored.ctx);
    assert.equal(payloads.length,3);assert.deepEqual(payloads[2],payloads[0]);assert.equal(restored.ctx.S.balance,100);assert.equal(restored.ctx.S.orders.length,0);
  });
  await t.test('changed inventory cannot reuse an uncertain purchase against a new price',async()=>{
    let calls=0;const service={getCreditBalance:async()=>wallet(),beginPurchase:async()=>{calls++;return {confirmed:false};}};
    const first=setup({rows:[agent],demo:false,service});await toPayment(first,'','2');await first.h.chooseCredit(first.ctx);await first.h.authorizeCredit(first.ctx);
    first.api.setInventory([{...agent,perGpuHourly:2.5}]);await first.h.authorizeCredit(first.ctx);assert.equal(calls,1);assert.match(first.ctx.messages.at(-1),/offer changed while payment confirmation is pending/);
    const restored=setup({rows:[{...agent,perGpuHourly:2.5}],demo:false,storage:first.storage,service,begin:false});
    await restored.h.chooseCredit(restored.ctx);assert.equal(calls,1);assert.match(restored.ctx.messages.at(-1),/offer changed while payment confirmation is pending/);assert.equal(restored.h.pending(restored.ctx).paymentSubmitted,true);
  });
  await t.test('editing a purchase before submission creates a fresh idempotency key',async()=>{
    const env=setup(),firstKey=env.h.pending(env.ctx).idempotencyKey;
    await toPayment(env,'','2');const secondKey=env.h.pending(env.ctx).idempotencyKey;assert.notEqual(secondKey,firstKey);
    env.api.action(env.ctx,'spot-checkout-review');await toPayment(env,'','3');assert.notEqual(env.h.pending(env.ctx).idempotencyKey,secondKey);
    assert.equal(env.h.pending(env.ctx).durationHours,3);assert.equal(env.h.pending(env.ctx).paymentSubmitted,undefined);
  });
  await t.test('top-up does not dispatch a stale account or replaced form draft',async()=>{
    for(const mode of ['identity','draft','form']){
      const env=setup();let calls=0;env.sandbox.OpenNEXTAuth={request:async()=>{calls++;return {checkoutUrl:'https://checkout.example.test'};}};
      const amountForm=form('payment-amount');env.payments.submit(env.ctx,amountForm,{preset:'100'});
      const f=form('payment-method');env.payments.submit(env.ctx,f,{method:'credit_card'});
      if(mode==='identity')env.ctx.S.user.id='changed';if(mode==='draft')env.ctx.S.paymentDraft={amount:500,idempotencyKey:'new'};if(mode==='form')f.isConnected=false;
      await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
    }
  });
});
