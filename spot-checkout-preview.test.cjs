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
  const sandbox={crypto:crypto.webcrypto,Uint8Array,URL,URLSearchParams,Date,atob,btoa,OpenNEXTSpotCheckout:service,sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},localStorage:{getItem:()=>null},document:{querySelector:()=>null,querySelectorAll:()=>[]}};
  const machine=vm.createContext(sandbox);vm.runInContext(accountSource,machine);vm.runInContext(source,machine);vm.runInContext(paymentsSource,machine);
  const api=sandbox.OpenNEXTSpotMarket;api.setInventory(rows);
  const ctx={S:{auth:true,user:{id:'buyer-one',demo},identity:{},role:'Buyer',balance:100,orders:[],instances:[],modal:null},messages:[],opened:[],esc,render(){},toast(message){this.messages.push(message);},open(type,data){this.S.modal={type,...data};this.opened.push(this.S.modal);},go(route){this.route=route;}};
  const row=api.testHelpers.inventoryState().rows[0];if(begin)api.testHelpers.beginCheckout(ctx,row);
  return {api,ctx,h:api.testHelpers,row,sandbox,storage,payments:sandbox.OpenNEXTPayments};
}
function form(type='spot-checkout-review'){
  const button={disabled:false,isConnected:true},error={textContent:'',hidden:true};
  return {dataset:{form:type},isConnected:true,button,error,querySelector:selector=>selector.includes('button')||selector==='[type="submit"]'?button:error};
}
async function toPayment(env,key=''){await env.h.reviewPurchase(env.ctx,form(),{sshPublicKey:key});assert.equal(env.ctx.S.modal.type,'spot-payment-choice');}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
const wallet=()=>({confirmed:true,accountId:'buyer-one',currency:'USD',availableCredit:100});

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
  await t.test('review has exact hourly fee/total, no fabricated duration or preview controls',()=>{
    const {api,ctx,h,row}=setup(),html=api.modal(ctx,'spot-review').body;
    assert.equal(h.checkoutTotals(row).baseCents,1440);assert.equal(h.checkoutTotals(row).feeCents,72);assert.equal(h.checkoutTotals(row).totalCents,1512);
    assert.match(html,/\$15\.12 <small>\/ hour/);assert.match(html,/Starts immediately after payment confirmation/);
    assert.match(html,/SSH Public Key/);assert.match(html,/Proceed to payment/);
    assert.doesNotMatch(html,/Estimated usage|PREVIEW ONLY|Node \/ hour|Estimated total|Confirm preview|<select/);
    assert.doesNotMatch(api.render(ctx),/onx-spot-checkout-overlay/);
  });
  await t.test('optional SSH accepts blank and payment options are enabled',async()=>{
    const env=setup();await toPayment(env);
    const html=env.api.modal(env.ctx,'spot-payment-choice').body;
    assert.match(html,/Available: \$100\.00/);assert.match(html,/Direct Pay/);assert.doesNotMatch(html,/data-act="spot-checkout-credit" disabled/);
    assert.equal(env.h.pending(env.ctx).sshPublicKey,'');assert.equal(env.ctx.S.balance,100);
  });
  await t.test('invalid/private SSH stays on review; valid public key persists across modal navigation',async()=>{
    const env=setup(),f=form();await env.h.reviewPurchase(env.ctx,f,{sshPublicKey:'-----BEGIN OPENSSH PRIVATE KEY-----'});
    assert.equal(env.ctx.S.modal.type,'spot-review');assert.match(f.error.textContent,/public key|private key/i);
    await toPayment(env,publicKey);env.api.action(env.ctx,'spot-checkout-review');
    assert.match(env.api.modal(env.ctx,'spot-review').body,new RegExp(publicKey.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  });
  await t.test('Direct Pay is visible but never calls a gateway or creates an order',async()=>{
    const env=setup();await toPayment(env);env.api.action(env.ctx,'spot-checkout-direct');
    assert.match(env.ctx.messages.at(-1),/not connected/);assert.equal(env.ctx.S.balance,100);assert.equal(env.ctx.S.orders.length,0);
  });
  await t.test('insufficient credit opens top-up and preserves validated SSH with no auto-charge',async()=>{
    const env=setup();env.ctx.S.balance=0;await toPayment(env,publicKey);await env.h.chooseCredit(env.ctx);
    assert.equal(env.ctx.S.modal.type,'pay-start');assert.equal(env.ctx.S.balance,0);assert.equal(env.storage.size,1);
    assert.match(env.payments.modal(env.ctx,'pay-start').body,/Back to purchase/);
    env.api.resumeCheckout(env.ctx);assert.equal(env.ctx.S.modal.type,'spot-payment-choice');assert.equal(env.h.pending(env.ctx).sshPublicKey,publicKey);
    await env.h.chooseCredit(env.ctx);assert.equal(env.ctx.S.modal.type,'spot-payment-choice');assert.match(env.ctx.messages.at(-1),/Credit confirmation is not connected/);
    assert.equal(env.ctx.S.balance,0);assert.equal(env.ctx.S.orders.length,0);
  });
  await t.test('top-up return updates balance only from authoritative account response, never auto-buys',async()=>{
    let purchaseCalls=0;const env=setup({service:{getCreditBalance:async()=>wallet(),beginMeteredPurchase:async()=>{purchaseCalls++;}}});env.ctx.S.balance=0;
    await toPayment(env);await env.h.chooseCredit(env.ctx);env.api.resumeCheckout(env.ctx);
    assert.equal(env.ctx.S.balance,0);assert.equal(purchaseCalls,0);
    await env.h.chooseCredit(env.ctx);assert.equal(env.ctx.S.balance,100);assert.equal(env.ctx.S.modal.type,'spot-credit-confirm');assert.equal(purchaseCalls,0);
  });
  await t.test('wrong-account and unconfirmed balances fail closed',async()=>{
    for(const response of [{...wallet(),confirmed:false},{...wallet(),accountId:'someone-else'},{...wallet(),availableCredit:null}]){
      const env=setup({service:{getCreditBalance:async()=>response}});env.ctx.S.balance=0;await toPayment(env);await env.h.chooseCredit(env.ctx);env.api.resumeCheckout(env.ctx);await env.h.chooseCredit(env.ctx);
      assert.equal(env.ctx.S.balance,0);assert.equal(env.ctx.S.modal.type,'spot-payment-choice');assert.match(env.ctx.messages.at(-1),/did not confirm/);
    }
  });
  await t.test('Demo and fixture rows never invoke purchase adapter even with sufficient Credit',async()=>{
    for(const variant of [{rows:[agent],demo:true},{rows:[fixture],demo:false}]){
      let calls=0;const env=setup({...variant,service:{getCreditBalance:async()=>wallet(),beginMeteredPurchase:async()=>{calls++;}}});
      await toPayment(env);await env.h.chooseCredit(env.ctx);await env.h.authorizeCredit(env.ctx);
      assert.equal(calls,0);assert.equal(env.ctx.S.balance,100);assert.equal(env.ctx.S.orders.length,0);assert.match(env.ctx.messages.at(-1),/testing only/);
    }
  });
  await t.test('real confirmed flow requires last confirmation and never mutates client ledger or assumes duration',async()=>{
    let calls=0,payload;const env=setup({rows:[agent],demo:false,service:{getCreditBalance:async()=>wallet(),beginMeteredPurchase:async input=>{calls++;payload=input;return {confirmed:true,offerId:agent.id,orderId:'ORDER-BACKEND-1'};}}});
    await toPayment(env);await env.h.authorizeCredit(env.ctx);assert.equal(calls,0);
    await env.h.chooseCredit(env.ctx);assert.equal(calls,0);await env.h.authorizeCredit(env.ctx);
    assert.equal(calls,1);assert.equal(payload.expectedHourly.totalCents,1512);assert.equal(payload.sshPublicKey,null);
    assert.equal(payload.hours,undefined);assert.equal(payload.duration,undefined);assert.equal(env.ctx.S.balance,100);assert.equal(env.ctx.S.orders.length,0);
    assert.equal(env.ctx.S.modal.type,'spot-purchase-complete');assert.equal(env.api.hasPending(env.ctx),false);
    await env.h.authorizeCredit(env.ctx);assert.equal(calls,1);
  });
  await t.test('unconfigured and unconfirmed real purchases never claim success',async()=>{
    for(const result of [null,{confirmed:false}]){
      const service={getCreditBalance:async()=>wallet()};if(result)service.beginMeteredPurchase=async()=>result;
      const env=setup({rows:[agent],demo:false,service});await toPayment(env);await env.h.chooseCredit(env.ctx);await env.h.authorizeCredit(env.ctx);
      assert.equal(env.ctx.S.modal.type,'spot-credit-confirm');assert.equal(env.ctx.S.orders.length,0);assert.equal(env.ctx.S.balance,100);
      assert.match(env.ctx.messages.at(-1),/not connected|not been confirmed/);
    }
  });
  await t.test('quote changes during SSH validation require review again',async()=>{
    const env=setup(),gate=deferred();env.sandbox.OpenNEXTAccountProfile.fingerprint=()=>gate.promise;
    const promise=env.h.reviewPurchase(env.ctx,form(),{sshPublicKey:publicKey});
    env.api.setInventory([{...fixture,perGpuHourly:3}]);gate.resolve('SHA256:test');await promise;
    assert.equal(env.ctx.S.modal.type,'spot-review');assert.equal(env.h.pending(env.ctx).reviewRequired,true);assert.match(env.ctx.messages.at(-1),/offer has changed/);
  });
  await t.test('quote changes during balance refresh prevent any purchase call',async()=>{
    const gate=deferred();let calls=0;const env=setup({rows:[agent],demo:false,service:{getCreditBalance:()=>gate.promise,beginMeteredPurchase:async()=>{calls++;}}});
    await toPayment(env);await env.h.chooseCredit(env.ctx);const promise=env.h.authorizeCredit(env.ctx);
    env.api.setInventory([{...agent,perGpuHourly:3}]);gate.resolve(wallet());await promise;
    assert.equal(calls,0);assert.equal(env.ctx.S.modal.type,'spot-review');assert.equal(env.h.pending(env.ctx).reviewRequired,true);
  });
  await t.test('quote changes during final SSH validation prevent any purchase call',async()=>{
    let calls=0;const env=setup({rows:[agent],demo:false,service:{getCreditBalance:async()=>wallet(),beginMeteredPurchase:async()=>{calls++;}}});
    await toPayment(env,publicKey);await env.h.chooseCredit(env.ctx);
    const gate=deferred(),started=deferred();env.sandbox.OpenNEXTAccountProfile.fingerprint=()=>{started.resolve();return gate.promise;};
    const promise=env.h.authorizeCredit(env.ctx);await started.promise;env.api.setInventory([{...agent,perGpuHourly:3}]);gate.resolve('SHA256:test');await promise;
    assert.equal(calls,0);assert.equal(env.ctx.S.modal.type,'spot-review');
  });
  await t.test('stored top-up draft restores only for its account and never creates an auto-pay action',async()=>{
    const first=setup();first.ctx.S.balance=0;await toPayment(first,publicKey);await first.h.chooseCredit(first.ctx);
    const second=setup({storage:first.storage,begin:false});
    assert.equal(second.api.hasPending(second.ctx),true);assert.equal(second.h.pending(second.ctx).balanceNeedsRefresh,true);assert.equal(second.h.pending(second.ctx).sshPublicKey,publicKey);
    second.ctx.S.user.id='different-account';assert.equal(second.api.hasPending(second.ctx),false);
  });
  await t.test('all top-up steps retain Back to purchase and provider link does not auto-redirect',async()=>{
    const env=setup();await toPayment(env);env.h.openTopup(env.ctx);env.ctx.S.paymentDraft={amount:100,checkoutUrl:'https://checkout.example.test/session',idempotencyKey:'topup'};
    for(const type of ['pay-start','payment-method','payment-provider'])assert.match(env.payments.modal(env.ctx,type).body,/Back to purchase/);
    const provider=env.payments.modal(env.ctx,'payment-provider').body;assert.match(provider,/target="_blank" rel="noopener noreferrer"/);assert.equal(env.ctx.S.balance,100);
  });
  await t.test('normal Credit authorization retains the same idempotency key through uncertain result and reload',async()=>{
    let savedKey;const env=setup({rows:[agent],demo:false,service:{getCreditBalance:async()=>wallet(),beginMeteredPurchase:async payload=>{savedKey=payload.idempotencyKey;return {confirmed:false};}}});
    await toPayment(env,publicKey);await env.h.chooseCredit(env.ctx);await env.h.authorizeCredit(env.ctx);assert.equal(env.storage.size,1);
    const restored=setup({rows:[agent],demo:false,storage:env.storage,begin:false});assert.equal(restored.h.pending(restored.ctx).idempotencyKey,savedKey);assert.equal(restored.h.pending(restored.ctx).sshPublicKey,publicKey);
  });
  await t.test('top-up does not dispatch a stale account or replaced form draft',async()=>{
    for(const mode of ['identity','draft','form']){
      const env=setup();let calls=0;env.sandbox.OpenNEXTAuth={request:async()=>{calls++;return {checkoutUrl:'https://checkout.example.test'};}};
      env.ctx.S.paymentDraft={amount:100,idempotencyKey:'topup'};const f=form('payment-method');env.payments.submit(env.ctx,f,{method:'credit_card'});
      if(mode==='identity')env.ctx.S.user.id='changed';if(mode==='draft')env.ctx.S.paymentDraft={amount:500,idempotencyKey:'new'};if(mode==='form')f.isConnected=false;
      await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
    }
  });
});
