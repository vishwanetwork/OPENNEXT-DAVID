'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const future=(hours=48)=>new Date(Date.now()+hours*3600000).toISOString();
const form=(type,id='')=>({dataset:{form:type,id}});
const button=(id,quote)=>({dataset:{id,quote}});
function fixture(overrides={}){
 const win={OpenNEXTModelQuotes:{list:()=>[{sku:'MODEL-ONE',name:'Model One',input:0.51,output:3.06}]}};
 const sandbox={window:win};
 for(const file of ['OpenNEXT-exchange.js','OpenNEXT-procurement.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),sandbox,{filename:file});
 const X=win.OpenNEXTExchange,P=win.OpenNEXTProcurement;
 const S=X.init({auth:true,role:'Buyer',identity:{name:'Nova',email:'nova@vishwalab.com',company:'Vishwa'},review:{status:'Approved',company:'Vishwa supply'},balance:1000000,earningsBalance:0,rfqs:[],listings:[],cart:[],saved:[],model:'H100 SXM',region:'All regions',count:8,term:'Spot',...overrides});
 const messages=[];
 const c={S,esc:v=>String(v??'').replace(/[&<>"']/g,v=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[v])),money:v=>'$'+Number(v).toFixed(2),persist(){X.init(S);},render(){},go(route){S.route=route;},open(type,extra={}){S.modal={type,...extra};},toast(message){messages.push(message);}};
 return {X,P,S,c,messages};
}
function requirement(overrides={}){
 return {id:'RFQ-TEST',kind:'gpu_rental',title:'Production project',project:'Production',model:'H100 SXM',region:'Singapore',count:8,hours:72,budget:2.5,term:'Spot',notes:'Exact model and delivery required',status:'Open',quotes:[],audit:[],start:future(48),quoteDeadline:future(24),shareClosingPrice:true,...overrides};
}
function install(f,r){f.S.rfqs.push(r);f.X.init(f.S);r.quotes=f.X.sampleQuotes(r);r.status='Quoted';return r;}
function completeBuyer(f,r,delivery){
 const o=f.X.accept(f.S,r,r.quotes[0]);f.X.pay(f.S,o);
 f.P.submit(f.c,form('proc-delivery',o.id),delivery);
 assert.equal(o.status,'Provisioning',f.messages.join('\n'));
 f.P.submit(f.c,form('proc-verify',o.id),{check0:'on',check1:'on',check2:'on',check3:'on'});
 return o;
}

test('rental total retains GPU count × hours and creates exactly one cloud instance',()=>{
 const f=fixture(),r=install(f,requirement());
 assert.equal(r.quotes[0].price,2.3);assert.equal(r.quotes[0].total,1324.8);
 const o=completeBuyer(f,r,{access:'ssh-ed25519 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'});
 assert.equal(o.status,'Active');assert.equal(f.S.instances.length,1);
 f.P.submit(f.c,form('proc-verify',o.id),{check0:'on',check1:'on',check2:'on',check3:'on'});
 assert.equal(f.S.instances.length,1);
});

test('an extension changes the original instance only after payment and acceptance, and only once',()=>{
 const end=Date.now()+72*3600000,instance={id:'ins-existing',model:'H100 SXM',count:8,region:'Singapore',status:'Running',hours:72,end,nextReservation:end+24*3600000};
 const f=fixture({instances:[instance]}),r=install(f,requirement({extensionOf:instance.id,start:new Date(end).toISOString(),hours:8,selectedSupplier:'Original supplier'}));
 const o=f.X.accept(f.S,r,r.quotes[0]);assert.equal(instance.end,end);f.X.pay(f.S,o);assert.equal(instance.end,end);
 f.P.submit(f.c,form('proc-delivery',o.id),{access:'ssh-ed25519 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'});assert.equal(instance.end,end);
 f.P.submit(f.c,form('proc-verify',o.id),{check0:'on',check1:'on',check2:'on',check3:'on'});
 assert.equal(f.S.instances.length,1);assert.equal(instance.end,end+8*3600000);assert.equal(o.instanceId,instance.id);assert.equal(o.extensionOf,instance.id);assert.equal(instance.hours,80);
 f.P.submit(f.c,form('proc-verify',o.id),{check0:'on',check1:'on',check2:'on',check3:'on'});assert.equal(instance.hours,80);
});

test('a changed reservation blocks extension acceptance without mutating the instance or order',()=>{
 const end=Date.now()+72*3600000,instance={id:'ins-existing',model:'H100 SXM',count:8,region:'Singapore',status:'Running',hours:72,end,nextReservation:end+4*3600000};
 const f=fixture({instances:[instance]}),r=install(f,requirement({extensionOf:instance.id,start:new Date(end).toISOString(),hours:8}));
 const o=f.X.accept(f.S,r,r.quotes[0]);f.X.pay(f.S,o);f.P.submit(f.c,form('proc-delivery',o.id),{access:'ssh-ed25519 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'});
 f.P.submit(f.c,form('proc-verify',o.id),{check0:'on',check1:'on',check2:'on',check3:'on'});
 assert.match(f.messages.at(-1),/reservation/);assert.equal(o.status,'Provisioning');assert.equal(instance.end,end);assert.equal(instance.hours,72);
});

test('physical GPU quotes charge per GPU, collect shipping and inspect hardware without cloud instances',()=>{
 const f=fixture(),r=install(f,requirement({kind:'physical_gpu',budget:24500,count:4,hours:720,shippingAddress:'123 Example Road, Singapore',condition:'Brand new'}));
 assert.equal(r.hours,0);assert.equal(r.quotes[0].total,90160);
 const rfqForm=f.P.modal(f.c,'proc-edit',{id:r.id}).body;
 assert.match(rfqForm,/USD \/ GPU/);assert.match(rfqForm,/shippingAddress/);assert.doesNotMatch(rfqForm,/Duration \(hours\)|SSH \/ dedicated instance|CUDA/);
 const o=completeBuyer(f,r,{consignee:'Nova',contactEmail:'nova@vishwalab.com',contactPhone:'+65 60000000',shippingAddress:r.shippingAddress});
 assert.equal(o.status,'Completed');assert.equal(o.priceUnit,'GPU');assert.equal(o.serviceEnd,null);assert.equal(o.shippingAddress,r.shippingAddress);assert.equal(f.S.instances.length,0);
 assert.match(f.P.modal(f.c,'proc-verify',{id:o.id}).body,/serial numbers verified/);
});

test('model quotes preserve separate token rates and quote a total allocation, not GPU hours',()=>{
 const f=fixture(),r=install(f,requirement({kind:'model_capacity',model:'Model One',count:0,hours:0,days:30,inputMillion:10,outputMillion:2,budget:12,priceSnapshot:{input:.51,output:3.06}}));
 assert.equal(r.quotes[0].input,.4692);assert.equal(r.quotes[0].output,2.8152);assert.equal(r.quotes[0].price,10.32);assert.equal(r.quotes[0].total,10.32);
 const o=completeBuyer(f,r,{access:'nova@vishwalab.com'});
 assert.equal(o.inputRate,.4692);assert.equal(o.outputRate,2.8152);assert.equal(o.status,'Active');assert.equal(o.priceUnit,'total');assert.equal(f.S.instances.length,0);
 assert.equal(+new Date(o.serviceEnd)-+new Date(o.serviceStart),30*86400000);
 assert.match(f.P.modal(f.c,'model-rfq',{id:r.id}).body,/10M input \/ 2M output/);
 assert.doesNotMatch(f.P.modal(f.c,'proc-edit',{id:r.id}).body,/SSH|CUDA|GPU quantity|Duration \(hours\)/);
});

test('selected model offer stays private, preserves supplier and does not change Broker role',()=>{
 const f=fixture({role:'Broker'}),id='EX-model-supply-MODEL-ONE';
 f.P.opportunity(f.c,id,'buy');
 assert.equal(f.S.role,'Broker');assert.equal(f.S.modal.type,'rfq-form');
 const pre=f.S.modal.prefill;assert.equal(pre.originSupply,id);assert.equal(pre.visibility,'Private RFQ');assert.equal(pre.budget,11.22);
 const data={...pre,project:'Client project',client:'Example Client',mandateConfirmed:'on',title:'Client model request',notes:'Authorized model access',start:future(48).slice(0,16),quoteDeadline:future(24).slice(0,16),shareClosingPrice:'on'};
 f.P.submit(f.c,form('proc-rfq'),data);
 assert.equal(f.S.rfqs.length,1,f.messages.join('\n'));
 const r=f.S.rfqs[0];assert.equal(r.visibility,'Private RFQ');assert.equal(r.quotes.length,1);assert.equal(r.quotes[0].provider,'Capacity partner');assert.equal(r.quotes[0].total,11.22);
 assert.equal(f.X.listPublic('model','demand').some(row=>row.id===r.id),false);
 const o=f.X.accept(f.S,r,r.quotes[0]);assert.equal(o.originSupply,id);assert.equal(o.tradeMethod,'Listed offer');assert.equal(o.buyer.company,'Example Client');assert.equal(o.broker.name,'Nova');
});

test('payment is once-only, links ledger and order IDs and carries agreed contract terms',()=>{
 const f=fixture(),r=install(f,requirement()),q=r.quotes[0];
 q.sla='99.95%';q.cancellation='Refund before provisioning';
 const o=f.X.accept(f.S,r,q),balance=f.S.balance;
 assert.equal(o.sla,q.sla);assert.equal(o.cancellationTerms,q.cancellation);
 assert.equal(f.X.pay(f.S,o),true);assert.equal(f.S.balance,balance-o.total);assert.equal(o.paymentId,f.S.ledger[0].id);assert.equal(o.paymentReference,o.paymentId);
 assert.equal(f.X.pay(f.S,o),false);assert.equal(f.S.ledger.length,1);assert.equal(f.S.balance,balance-o.total);
 assert.throws(()=>f.X.accept(f.S,r,q),/selected quote/);
});

test('reject preserves audit but removes pending quote; accept rejects invalid totals and dates without mutation',()=>{
 const f=fixture(),r=install(f,requirement()),q=r.quotes[0];
 f.X.reject(f.S,r,q);assert.equal(q.status,'Rejected');assert.ok(r.audit.length);assert.throws(()=>f.X.reject(f.S,r,q),/cannot be rejected/);
 const second=r.quotes[1];second.total++;
 assert.throws(()=>f.X.accept(f.S,r,second),/total does not match/);assert.equal(r.status,'Quoted');assert.equal(f.S.orders.length,0);
 second.total=f.X.totalFor(r,second.price);second.validUntil='not-a-date';
 assert.throws(()=>f.X.accept(f.S,r,second),/expired/);assert.equal(second.status,'Pending');
});

test('legacy model RFQs enter new quote review and normalize model access defaults',()=>{
 const f=fixture(),r=install(f,requirement({kind:'model_capacity',inputMillion:1,outputMillion:1,days:30,count:undefined,hours:undefined,priceSnapshot:{input:.51,output:3.06},deliveryMethod:undefined}));
 assert.equal(r.deliveryMethod,'Authorized API access');
 const body=f.P.modal(f.c,'model-rfq',{id:r.id}).body;
 assert.match(body,/proc-accept-review/);assert.match(body,/proc-reject/);assert.match(body,/per 1M tokens|\/ 1M tokens/);
 assert.equal(f.X.accept(f.S,r,r.quotes[0]).total,3.28);
});

test('supplier model response uses input/output rates and settles only once',()=>{
 const f=fixture({role:'Seller'}),r=install(f,requirement({kind:'model_capacity',inputMillion:10,outputMillion:2,days:30,count:0,hours:0}));
 f.S.activeRequirement=r;
 f.P.submit(f.c,form('proc-response',r.id),{inputRate:'0.51',outputRate:'3.06',delivery:'30',validUntil:future(24).slice(0,16),evidence:'Authorization record',specification:'100 TPS; 99.9% SLA',notes:'Refund before access activation'});
 assert.equal(f.S.responses.length,1,f.messages.join('\n'));const res=f.S.responses[0];assert.equal(res.rate,11.22);
 f.P.action(f.c,'proc-response-test',button(res.id));assert.equal(res.status,'Submitted');
 f.P.action(f.c,'proc-response-test',button(res.id));assert.equal(r.quotes.filter(q=>q.id===res.id).length,1);
 f.P.action(f.c,'proc-response-accept',button(res.id));const o=f.S.orders[0];assert.equal(o.total,11.22);assert.equal(o.inputRate,.51);assert.equal(o.outputRate,3.06);
 f.P.action(f.c,'proc-response-accept',button(res.id));assert.equal(f.S.orders.length,1);
 for(let i=0;i<4;i++)f.P.action(f.c,'proc-seller-progress',button(o.id));
 assert.equal(o.status,'Completed');assert.equal(f.S.earningsBalance,11.22);assert.equal(f.S.ledger.length,1);
 f.P.action(f.c,'proc-seller-progress',button(o.id));assert.equal(f.S.earningsBalance,11.22);assert.equal(f.S.ledger.length,1);
});

test('physical supplier response total is price × cards and shipping lead is expressed in days',()=>{
 const f=fixture({role:'Seller'}),r=install(f,requirement({kind:'physical_gpu',count:4,budget:20000,shippingAddress:'Singapore'}));f.S.activeRequirement=r;
 f.P.submit(f.c,form('proc-response',r.id),{rate:'20000',deliveryDays:'7',validUntil:future(24).slice(0,16),evidence:'Serial manifest',specification:'New H100, one-year warranty',notes:'DAP, insured shipment'});
 const res=f.S.responses[0];assert.equal(res.delivery,10080);assert.equal(res.hours,0);
 assert.match(f.P.modal(f.c,'proc-response',{id:res.id}).body,/7 days/);
 f.P.action(f.c,'proc-response-test',button(res.id));f.P.action(f.c,'proc-response-accept',button(res.id));
 assert.equal(f.S.orders[0].total,80000);assert.equal(f.S.orders[0].serviceEnd,null);assert.equal(f.S.orders[0].priceUnit,'GPU');
});

test('accept/reject synchronizes supplier responses and a buyer award cannot generate a second seller order',()=>{
 const f=fixture(),r=install(f,requirement()),accepted=r.quotes[0],rejected=r.quotes[1],losing=r.quotes[2];
 f.S.responses.push(...r.quotes.map(q=>({id:q.id,status:'Submitted',rfqId:r.id,validUntil:q.validUntil})));
 f.X.reject(f.S,r,rejected);assert.equal(f.S.responses.find(x=>x.id===rejected.id).status,'Rejected');
 const o=f.X.accept(f.S,r,accepted),res=f.S.responses.find(x=>x.id===accepted.id);
 assert.equal(res.status,'Accepted');assert.equal(res.orderId,o.id);assert.equal(f.S.responses.find(x=>x.id===losing.id).status,'Not selected');
 f.S.role='Seller';f.P.action(f.c,'proc-response-accept',button(res.id));
 assert.equal(f.S.orders.length,1);assert.equal(f.S.modal.type,'bill-order');assert.equal(f.S.modal.id,o.id);
 res.status='Submitted';res.orderId=null;f.P.action(f.c,'proc-response-accept',button(res.id));
 assert.equal(f.S.orders.length,1);assert.equal(res.orderId,o.id);
});

test('matches retain refresh lane and rotate, while comparison saves only supply and highlights differing metrics',()=>{
 const f=fixture(),initial=f.P.matches(f.c,'best');assert.match(initial,/data-scroll="best"/);assert.match(f.P.matches(f.c,'recent'),/data-scroll="recent"/);
 f.S.matchOffset=1;assert.notEqual(f.P.matches(f.c,'best').match(/data-resource="([^"]+)"/)[1],initial.match(/data-resource="([^"]+)"/)[1]);
 const table=f.P.listingTable(f.c),supplies=f.X.matches(f.S,'supply').slice(0,5);
 assert.equal((table.match(/data-act="save"/g)||[]).length,supplies.length);assert.equal((table.match(/data-act="cart"/g)||[]).length,supplies.length);assert.match(table,/aria-label="Save /);assert.match(table,/class="best"/);
});

test('saved generated offers survive reload, but arbitrary records cannot become marketplace listings',()=>{
 const f=fixture(),row=f.X.matches({...f.S,region:'Singapore'},'supply').find(r=>r.id.startsWith('MATCH-'));
 assert.ok(row);const reloaded=fixture({cart:[row,{id:'bad',kind:'rental',price:1}],saved:[]});
 assert.equal(reloaded.X.get(row.id).id,row.id);assert.equal(reloaded.X.get('bad'),null);
 reloaded.P.opportunity(reloaded.c,row.id,'buy');assert.equal(reloaded.S.modal.prefill.originSupply,row.id);
});
