'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Billing=require('../OpenNEXT-billing.js');
const policy='opennext-explicit-5pct-v1';
const feeFields={feePolicyVersion:policy,feePercent:5,subtotal:100,buyerFee:5,sellerFee:5,buyerTotal:105,sellerNet:95,total:105};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fixture(role='Buyer'){
  const events={},calls=[];
  const window={OpenNEXTAuth:{getUser:()=>({id:'account-1',role:role.toLowerCase()})},OpenNEXTCountries:{options:()=>'<option>Singapore</option>'}};
  const sandbox={window,document:{addEventListener(name,fn){events[name]=fn;}}};
  for(const file of ['OpenNEXT-exchange.js','OpenNEXT-procurement.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),sandbox,{filename:file});
  const S=window.OpenNEXTExchange.init({role,identity:{name:'Verified user',company:'',email:'test@example.test'},model:'H100',region:'All regions',count:8,term:'Spot',auth:true,review:{status:'Approved'},orders:[],rfqs:[],responses:[],listings:[],notifications:[],ledger:[],payouts:[],balance:0});
  const c={S,esc,money:value=>'$'+Number(value).toFixed(2),persist(){},render(){},toast(message){calls.push(message);},open(){}};
  return {P:window.OpenNEXTProcurement,X:window.OpenNEXTExchange,S,c,events,calls};
}
function requirement(extra={}){return {id:'RFQ-1',kind:'gpu_rental',model:'H100',region:'Singapore',count:2,hours:10,budget:5,title:'Training',status:'Quoted',reviewStatus:'Approved',quotes:[],audit:[],...extra};}
function quote(extra={}){return {id:'QUOTE-1',provider:'Supplier',price:5,status:'Pending',delivery:30,validUntil:'2099-01-01T00:00:00Z',...feeFields,...extra};}
function order(extra={}){return {id:'ORDER-1',kind:'gpu_rental',title:'Training',model:'H100',count:2,hours:10,unitPrice:5,status:'Awaiting payment',paymentStatus:'Unpaid',side:'buy',...feeFields,...extra};}

test('buyer acceptance presents base plus OpenNEXT fee and payable total before confirm',()=>{
  const f=fixture(),q=quote();f.S.rfqs=[requirement({quotes:[q]})];
  const html=f.P.modal(f.c,'proc-accept-review',{id:'RFQ-1',quoteId:q.id}).body;
  assert.match(html,/<small>Base order amount<\/small><strong>\$100\.00/);
  assert.match(html,/<small>OpenNEXT Fee 5%<\/small><strong>\+\$5\.00/);
  assert.match(html,/<small>Total payable<\/small><strong>\$105\.00/);
  assert.ok(html.indexOf('Total payable')<html.indexOf('Confirm acceptance'));
  assert.doesNotMatch(html,/platform markup|proc-accept-confirm[^>]*disabled/);
  const detail=f.P.modal(f.c,'proc-quote-details',{id:'RFQ-1',quoteId:q.id}).body;
  assert.match(detail,/<small>Base unit price<\/small><strong>\$5\.00 \/ GPU-hour/);
  assert.match(detail,/Total payable/);
});

test('legacy pending quote cannot be accepted without a refreshed fee breakdown',()=>{
  const f=fixture(),q=quote({feePolicyVersion:undefined,total:100});f.S.rfqs=[requirement({quotes:[q]})];
  const html=f.P.modal(f.c,'proc-accept-review',{id:'RFQ-1',quoteId:q.id}).body;
  assert.match(html,/Recorded order amount<\/small><strong>\$100\.00/);
  assert.match(html,/proc-accept-confirm[^>]*disabled/);
  assert.match(html,/Request an updated quote/);
  assert.doesNotMatch(html,/<small>OpenNEXT Fee 5%/);
});

test('buyer and seller payment summaries use their respective fee and net/gross amount',()=>{
  for(const [role,side,label,amount,sign] of [['Buyer','buy','Total payable','105.00','+'],['Seller','sell','Net proceeds','95.00','−']]){
    const f=fixture(role),o=order({side});f.S.orders=[o];const before=JSON.stringify(o);
    const html=f.P.modal(f.c,'proc-payment',{id:o.id}).body;
    assert.ok(html.includes('<small>'+label+'</small><strong>$'+amount));
    assert.ok(html.includes('<small>OpenNEXT Fee 5%</small><strong>'+sign+'$5.00'));
    assert.match(html,/disabled title="Order payment integration is pending"/);
    assert.match(html,/No funds have been charged/);assert.equal(JSON.stringify(o),before);
  }
});

test('seller quote and supply forms show base-rate settlement estimates with no embedded uplift',()=>{
  const f=fixture('Seller'),req=requirement();f.S.listings=[{id:'SUP-1',status:'Published',model:'H100',region:'Singapore',netPrice:5,buyerPrice:5,count:2,hours:10}];
  for(const html of [f.P.modal(f.c,'respond',{requirement:req}).body,f.P.modal(f.c,'supply-form',{}).body]){
    assert.match(html,/data-proc-fee-estimate/);assert.match(html,/Estimated net proceeds/);assert.match(html,/OpenNEXT Fee 5%/);
    assert.doesNotMatch(html,/Buyer price \(\+5%\)|platform markup|data-proc-buyer-price/);
  }
  const page=f.P.supplyPage(f.c);assert.match(page,/<th>Base unit price<\/th>/);assert.doesNotMatch(page,/\$5\.25/);
});

test('seller estimate rounds on base order amount and never changes input rate or financial state',()=>{
  const f=fixture('Seller'),values={base:{},fee:{},net:{}},rate={value:'1.01'},count={value:'3'},hours={value:'7'};
  const estimate={dataset:{count:'3',hours:'7'},querySelector(selector){return values[selector.match(/estimate-(base|fee|net)/)[1]];}};
  const form={querySelector(selector){return selector==='[data-proc-fee-estimate]'?estimate:selector==='[data-proc-net-price]'?rate:selector==='[name="count"]'?count:hours;}};
  const before=JSON.stringify(f.S);f.events.input({target:{matches(selector){return selector.includes('data-proc-net-price');},closest(){return form;}}});
  assert.equal(values.base.textContent,'$21.21');assert.equal(values.fee.textContent,'−$1.06');assert.equal(values.net.textContent,'$20.15');
  assert.equal(rate.value,'1.01');assert.equal(JSON.stringify(f.S),before);
  rate.value='';f.events.input({target:{matches(selector){return selector.includes('data-proc-net-price');},closest(){return form;}}});assert.equal(values.net.textContent,'—');
});

test('seller response record shows quoted base minus independent seller fee',()=>{
  const f=fixture('Seller');f.S.responses=[{...quote(),id:'RESPONSE-1',rfqId:'RFQ-1',rate:5,netPrice:5,buyerPrice:5}];
  const html=f.P.modal(f.c,'proc-response',{id:'RESPONSE-1'}).body;
  assert.match(html,/Base unit price<\/small><strong>\$5\.00/);assert.match(html,/OpenNEXT Fee 5%<\/small><strong>−\$5\.00/);assert.match(html,/Net proceeds<\/small><strong>\$95\.00/);
});

test('billing order details use buyer total or seller net without reapplying fee',()=>{
  for(const [role,side,label,total,sign] of [['Buyer','buy','Total payable · USD','105.00','+'],['Seller','sell','Net proceeds · USD','95.00','−']]){
    const f=fixture(role);f.S.orders=[order({side})];const before=JSON.stringify(f.S.orders);
    const html=Billing.modal(f.c,'bill-order',{id:'ORDER-1'}).body;
    assert.ok(html.includes('<small>'+label+'</small><strong>$'+total));
    assert.ok(html.includes('<small>OpenNEXT Fee 5%</small><strong>'+sign+'$5.00'));
    assert.doesNotMatch(html,/<small>Platform fee|Commission paid/);assert.equal(JSON.stringify(f.S.orders),before);
  }
});

test('legacy paid and unpaid order totals are displayed unchanged without new fee assumptions',()=>{
  for(const paymentStatus of ['Paid','Unpaid']){
    const f=fixture();f.S.orders=[order({paymentStatus,feePolicyVersion:undefined,total:83,subtotal:80,fees:2,tax:1,buyerTotal:undefined,sellerNet:undefined})];
    const html=Billing.modal(f.c,'bill-order',{id:'ORDER-1'}).body;
    assert.match(html,/Recorded order total · USD<\/small><strong>\$83\.00/);assert.match(html,/Recorded fee<\/small><strong>\$2\.00/);
    assert.doesNotMatch(html,/OpenNEXT Fee 5%/);assert.match(html,/No new fee has been applied/);
  }
});

test('seller billing activity uses net and settled fee summary does not charge it twice',()=>{
  const f=fixture('Seller'),at=new Date().toISOString();
  f.S.orders=[order({side:'sell',createdAt:at}),order({id:'SETTLED-1',side:'sell',status:'Completed',paymentStatus:'Paid',settledAt:at})];
  f.S.ledger=[{id:'NET-1',orderId:'SETTLED-1',type:'Sale settlement',amount:95,status:'Posted',createdAt:at}];
  Billing.init(f.S);const html=Billing.page(f.c);
  assert.match(html,/<span>OpenNEXT Fee 5%<\/span><strong>-\$5\.00/);
  assert.match(html,/already deducted from net proceeds/);assert.match(html,/\+\$95\.00/);
  assert.equal(Billing.analytics(f.S).sums.revenue,95);assert.equal(Billing.analytics(f.S).sums.commission,0);
});

test('top-ups stay outside the order fee policy and do not create funds',()=>{
  const f=fixture();f.S.balance=100;const html=Billing.modal(f.c,'pay-start',{}).body;
  assert.doesNotMatch(html,/OpenNEXT Fee 5%/);assert.match(html,/No payment has been taken/);
  assert.equal(Billing.completePayment(f.c,{amount:100}),false);assert.equal(f.S.balance,100);
});
