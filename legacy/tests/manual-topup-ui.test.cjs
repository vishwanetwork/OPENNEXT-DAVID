'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'../OpenNEXT-payments.js'),'utf8');
const id='TOPUP-11111111-2222-3333-4444-555555555555';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
  const listeners=new Map(),intervals=new Map(),calls=[],opened=[],messages=[],resumed=[];let timerId=0,purchase='purchase-one',refreshes=0;
  const c={S:{auth:true,user:{id:'buyer-one',role:'buyer'},role:'Buyer',balance:100,ledger:[],topupRequests:[],modal:null},renderCount:0,render(){this.renderCount++;},open(type,extra={}){this.S.modal={type,...extra};opened.push(this.S.modal);},toast(message){messages.push(message);}};
  const on=(name,handler)=>listeners.set(name,[...(listeners.get(name)||[]),handler]);
  const window={crypto:crypto.webcrypto,document:{hidden:false,addEventListener:on},addEventListener:on,setInterval:(fn,ms)=>{intervals.set(++timerId,{fn,ms});return timerId;},clearInterval:key=>intervals.delete(key),OpenNEXTSpotMarket:{hasPending:()=>!!purchase,purchaseReference:()=>purchase,resumeCheckout:()=>resumed.push(purchase)},OpenNEXTAuth:{getUser:()=>c.S.user,request:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {request:record(JSON.parse(options.body))};}}};
  vm.runInNewContext(source,{window,Intl,URL});
  const api=window.OpenNEXTPayments;
  const record=(data={},extra={})=>({id,accountId:'buyer-one',amount:data.amount??250,amountCents:Math.round((data.amount??250)*100),method:data.method||'paypal',status:'Pending',...(data.purchaseReference?{purchaseReference:data.purchaseReference}:{}),...extra});
  const account=requests=>({confirmed:true,accountId:c.S.user.id,currency:'USD',availableCredit:100+requests.filter(row=>row.status==='Approved').reduce((sum,row)=>sum+row.amount,0),paidCredit:requests.filter(row=>row.status==='Approved').reduce((sum,row)=>sum+row.amount,0),promotionalCredit:100,requests,notifications:[]});
  const setAccount=result=>{window.OpenNEXTExchange={refreshBillingAccount:async S=>{refreshes++;S.balance=result.availableCredit;S.topupRequests=result.requests;return result;}};};
  const form=(kind='payment-method',reference='')=>{const button={disabled:false,isConnected:true},error={hidden:true,textContent:''};return {dataset:{form:kind,purchaseReference:reference},isConnected:true,button,error,querySelector:selector=>selector==='.payment-error'?error:button};};
  const amount=(reference='')=>{api.submit(c,form('payment-amount',reference),{preset:'other',custom:'250'});return form();};
  return {window,api,c,calls,opened,messages,resumed,listeners,intervals,record,account,setAccount,form,amount,get refreshes(){return refreshes;},setPurchase:value=>purchase=value};
}

test('purchase context is explicit and pre-approval top-up screens never show Back to purchase',()=>{
  const f=fixture();
  assert.match(f.api.modal(f.c,'pay-start').body,/data-purchase-reference=""/);
  assert.match(f.api.modal(f.c,'pay-start',{spotCheckout:true}).body,/data-purchase-reference="purchase-one"/);
  f.amount('purchase-one');f.c.S.paymentDraft.checkoutUrl='https://payments.example.test/checkout';
  for(const type of ['pay-start','payment-method','payment-provider'])assert.doesNotMatch(f.api.modal(f.c,type,{spotCheckout:true}).body,/Back to purchase/);
  f.api.action(f.c,'payment-amount-back');assert.equal(f.c.S.modal.purchaseReference,'purchase-one');
  assert.match(f.api.modal(f.c,'pay-start',f.c.S.modal).body,/data-purchase-reference="purchase-one"/);
  f.setPurchase('different-purchase');assert.match(f.api.modal(f.c,'pay-start',f.c.S.modal).body,/data-purchase-reference=""/);
});

test('server-confirmed submission enters Pending without adding credit, a ledger event or an order',async()=>{
  const f=fixture(),form=f.amount('purchase-one');
  f.api.submit(f.c,form,{method:'paypal'});await tick();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/api/billing/topups');assert.equal(f.calls[0].body.purchaseReference,'purchase-one');assert.equal(f.calls[0].body.amount,250);
  assert.equal(f.c.S.modal.type,'payment-topup-status');assert.equal(f.api.modal(f.c,'payment-topup-status',{id}).title,'Top-up in progress.');
  assert.doesNotMatch(f.api.modal(f.c,'payment-topup-status',{id}).body,/Back to purchase/);
  assert.equal(f.c.S.balance,100);assert.equal(f.c.S.ledger.length,0);assert.equal(f.resumed.length,0);assert.equal(f.intervals.size,1);assert.equal([...f.intervals.values()][0].ms,10000);
});

test('failures and malformed or cross-account responses never show success',async()=>{
  for(const mode of ['network','wrong-owner','wrong-amount','wrong-reference']){
    const f=fixture(),form=f.amount('purchase-one');
    f.window.OpenNEXTAuth.request=async()=>{if(mode==='network')throw Error('Submission unavailable.');return {request:f.record({purchaseReference:'purchase-one'},mode==='wrong-owner'?{accountId:'other'}:mode==='wrong-amount'?{amount:1,amountCents:100}:{purchaseReference:'other'})};};
    f.api.submit(f.c,form,{method:'paypal'});await tick();
    assert.equal(f.c.S.modal.type,'payment-method');assert.equal(form.error.hidden,false);assert.equal(f.c.S.topupRequests.length,0);assert.equal(f.c.S.balance,100);assert.equal(form.button.disabled,false);
  }
});

test('double-click submissions share one request and uncertain retries keep the same immutable key',async()=>{
  const f=fixture(),form=f.amount(),gate=deferred();
  f.window.OpenNEXTAuth.request=async(url,options)=>{f.calls.push({url,body:JSON.parse(options.body)});return gate.promise;};
  f.api.submit(f.c,form,{method:'paypal'});f.api.submit(f.c,form,{method:'paypal'});await tick();assert.equal(f.calls.length,1);
  gate.reject(Error('Connection ended.'));await tick();const key=f.calls[0].body.idempotencyKey;
  f.api.submit(f.c,form,{method:'credit_card'});await tick();assert.equal(f.calls.length,1);assert.match(f.messages.at(-1),/same payment method/);
  f.window.OpenNEXTAuth.request=async(url,options)=>{f.calls.push({url,body:JSON.parse(options.body)});return {request:f.record()};};
  f.api.submit(f.c,form,{method:'paypal'});await tick();assert.equal(f.calls.length,2);assert.equal(f.calls[1].body.idempotencyKey,key);
});

test('identity, role, draft and detached form changes discard stale submissions and responses',async()=>{
  for(const afterDispatch of [false,true])for(const mode of ['identity','role','draft','form']){
    const f=fixture(),form=f.amount(),gate=deferred();
    f.window.OpenNEXTAuth.request=async()=>{f.calls.push({});return gate.promise;};
    f.api.submit(f.c,form,{method:'paypal'});if(afterDispatch)await tick();
    if(mode==='identity')f.c.S.user={id:'other',role:'buyer'};if(mode==='role')f.c.S.role='Seller';if(mode==='draft')f.c.S.paymentDraft={};if(mode==='form')form.isConnected=false;
    gate.resolve({request:f.record()});await tick();assert.equal(f.calls.length,afterDispatch?1:0);assert.equal(f.c.S.topupRequests.length,0);assert.equal(f.c.S.balance,100);assert.notEqual(f.c.S.modal.type,'payment-topup-status');
  }
});

test('approved exact-linked requests alone offer a verified return to the same purchase',async()=>{
  const f=fixture(),approved=f.record({purchaseReference:'purchase-one'},{status:'Approved'});f.c.S.topupRequests=[approved];
  assert.match(f.api.modal(f.c,'payment-topup-status',{id}).body,/\$250\.00 has been credited[\s\S]*Back to purchase/);
  f.setAccount(f.account([approved]));f.api.action(f.c,'payment-return-purchase',{dataset:{id}});await tick();assert.equal(f.refreshes,1);assert.deepEqual(f.resumed,['purchase-one']);assert.equal(f.c.S.balance,350);
  for(const request of [f.record({},{status:'Approved'}),f.record({purchaseReference:'other'},{status:'Approved'}),f.record({purchaseReference:'purchase-one'},{status:'Pending'}),f.record({purchaseReference:'purchase-one'},{status:'Rejected'})]){
    f.c.S.topupRequests=[request];assert.doesNotMatch(f.api.modal(f.c,'payment-topup-status',{id}).body,/Back to purchase/);
  }
});

test('purchase return fails closed after refresh errors, identity switches or changed purchase reference',async()=>{
  for(const mode of ['error','identity','reference','not-approved']){
    const f=fixture(),approved=f.record({purchaseReference:'purchase-one'},{status:'Approved'}),gate=deferred();f.c.S.topupRequests=[approved];
    f.window.OpenNEXTExchange={refreshBillingAccount:()=>gate.promise};f.api.action(f.c,'payment-return-purchase',{dataset:{id}});
    if(mode==='error')gate.reject(Error('Offline'));else{if(mode==='identity')f.c.S.user={id:'other',role:'buyer'};if(mode==='reference')f.setPurchase('changed');if(mode==='not-approved')f.c.S.topupRequests=[{...approved,status:'Pending'}];gate.resolve(f.account([approved]));}
    await tick();assert.equal(f.resumed.length,0);
  }
});

test('pending approval polling refreshes balances but preserves editable form layouts',async()=>{
  const f=fixture(),pending=f.record();f.c.S.topupRequests=[pending];f.setAccount(f.account([pending]));f.api.bind(f.c);
  for(const type of ['pay-start','payment-method','spot-review','rfq-new']){
    f.c.S.modal={type};await f.api.refreshAccount(f.c,{render:true});assert.equal(f.c.renderCount,0,type);
  }
  f.c.S.modal={type:'payment-topup-status',id};await f.api.refreshAccount(f.c,{render:true});assert.equal(f.c.renderCount,1);
  f.window.document.hidden=true;const before=f.refreshes;[...f.intervals.values()][0].fn();await tick();assert.equal(f.refreshes,before);
  f.window.document.hidden=false;for(const listener of f.listeners.get('focus')||[])listener();await tick();assert.equal(f.refreshes,before+1);
  f.setAccount(f.account([{...pending,status:'Approved'}]));await f.api.refreshAccount(f.c,{render:true});assert.equal(f.c.S.balance,350);assert.equal(f.intervals.size,0);
});

test('legacy provider URL validation remains strict without a purchase-return shortcut',()=>{
  const f=fixture();f.amount();
  for(const checkoutUrl of ['http://provider.example/','javascript:alert(1)','https://user:secret@provider.example/']){
    f.c.S.paymentDraft.checkoutUrl=checkoutUrl;const modal=f.api.modal(f.c,'payment-provider');assert.equal(modal.title,'Payment setup required');assert.doesNotMatch(modal.body,/href=|Back to purchase/);
  }
});
