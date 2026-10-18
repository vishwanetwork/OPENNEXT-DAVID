'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const future=(hours=48)=>new Date(Date.now()+hours*3600000).toISOString();
const form=(type,id='')=>({dataset:{form:type,id},querySelector:()=>({disabled:false,isConnected:true})});
const button=(id,quote)=>({dataset:{id,quote},disabled:false,isConnected:true});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(overrides={}){
 const win={OpenNEXTCountries:{options:()=>'<option value="">Select a country</option><option>Singapore</option><option>United States</option>'}};
 const sandbox={window:win};
 for(const file of ['OpenNEXT-exchange.js','OpenNEXT-procurement.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),sandbox,{filename:file});
 const X=win.OpenNEXTExchange,P=win.OpenNEXTProcurement;
 const S=X.init({auth:true,role:'Buyer',identity:{name:'Verified User',email:'user@example.test',company:''},review:{status:'Not started'},balance:0,earningsBalance:0,rfqs:[],listings:[],cart:[],saved:[],model:'H100 SXM',region:'All regions',count:8,term:'Spot',...overrides});
 const messages=[];
 const c={S,esc:v=>String(v??'').replace(/[&<>"']/g,v=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[v])),money:v=>'$'+Number(v).toFixed(2),persist(){X.init(S);},render(){},go(route){S.route=route;},open(type,extra={}){S.modal={type,...extra};},toast(message){messages.push(message);}};
 return {win,X,P,S,c,messages};
}
function requirement(overrides={}){return {id:'RFQ-TEST',kind:'gpu_rental',title:'Production project',project:'Production',model:'H100 SXM',region:'Singapore',count:8,hours:72,budget:2.5,term:'Spot',notes:'Exact model and delivery required',status:'Open',quotes:[],audit:[],start:future(48),quoteDeadline:future(24),shareClosingPrice:true,...overrides};}
function install(f,r){f.S.rfqs.push(r);f.X.init(f.S);r.quotes=f.X.sampleQuotes(r);r.status='Quoted';return r;}

test('GPU rental arithmetic retains GPU count multiplied by service hours',()=>{
 const f=fixture(),r=requirement();
 assert.equal(f.X.totalFor(r,2.3),1324.8);
 assert.equal(f.X.totalFor({...r,count:4,hours:12},2.5),120);
 assert.equal(f.X.unitLabel(r),'GPU-hour');
});
test('physical cards and model tokens do not inherit rental-hour pricing',()=>{
 const f=fixture(),physical=requirement({kind:'physical_gpu',count:4,hours:720}),model=requirement({kind:'model_capacity',inputMillion:10,outputMillion:2});
 assert.equal(f.X.totalFor(physical,20000),80000);
 assert.equal(f.X.tokenTotal(model,.51,3.06),11.22);
 assert.equal(f.X.totalFor(model,11.22),11.22);
 assert.equal(f.X.unitLabel(physical),'GPU');
 assert.equal(f.X.unitLabel(model),'total');
});
test('legacy pure quote validation rejects altered totals, expired dates and repeat awards',()=>{
 const f=fixture(),r=install(f,requirement()),q=r.quotes[0];
 q.total++;assert.throws(()=>f.X.accept(f.S,r,q),/total does not match/);
 q.total=f.X.totalFor(r,q.price);q.validUntil='invalid';assert.throws(()=>f.X.accept(f.S,r,q),/expired/);
 q.validUntil=future(24);const order=f.X.accept(f.S,r,q);assert.equal(order.paymentStatus,'Unpaid');
 assert.throws(()=>f.X.accept(f.S,r,q),/selected quote/);
});
test('rejection preserves decision history without treating rejected quotes as pending',()=>{
 const f=fixture(),r=install(f,requirement()),q=r.quotes[0];f.X.reject(f.S,r,q);
 assert.equal(q.status,'Rejected');assert.ok(r.audit.length);
 assert.throws(()=>f.X.reject(f.S,r,q),/cannot be rejected/);
});
test('real UI cannot fabricate payment, delivery, instance activation or seller settlement',()=>{
 const f=fixture(),r=install(f,requirement()),order=f.X.accept(f.S,r,r.quotes[0]);const before=JSON.stringify(f.S);
 for(const action of ['proc-pay-confirm','proc-seller-progress','proc-response-test','proc-response-accept','proc-sample-quotes','proc-complete'])assert.equal(f.P.action(f.c,action,button(order.id)),true);
 f.P.submit(f.c,form('proc-delivery',order.id),{access:'ssh-ed25519 AAAAAAAAAAAAAAAAAAAAAAAAAAAA'});
 f.P.submit(f.c,form('proc-verify',order.id),{check0:'on',check1:'on',check2:'on',check3:'on'});
 assert.equal(JSON.stringify(f.S),before);assert.equal(f.S.instances.length,0);assert.equal(f.S.ledger.length,0);
 assert.match(f.messages.at(-1),/backend provisioning/);
});
test('new RFQ has country selector and blank customer specifications',()=>{
 const f=fixture(),html=f.P.modal(f.c,'rfq-form',{}).body;
 assert.match(html,/select[^>]+name="region"/);assert.match(html,/United States/);
 for(const field of ['title','project','network','storage','image','sla'])assert.match(html,new RegExp('name="'+field+'"[^>]*value=""'));
 assert.doesNotMatch(html,/Nova|vishwalab|400 Gb\/s|1 TB NVMe|Ubuntu 24/);
});
test('budget slider uses the selected GPU observed range and preserves manual entry',()=>{
 const f=fixture();f.win.OpenNEXTHistory={priceRange:()=>({model:'H100 SXM',min:1.2,max:4.5})};
 const html=f.P.modal(f.c,'rfq-form',{prefill:{budget:8}}).body;
 assert.match(html,/data-proc-budget-range min="1.2" max="4.5"/);
 assert.match(html,/name="budget"[^>]+value="8"/);assert.match(html,/higher maximum for urgent/);
 f.win.OpenNEXTHistory.priceRange=()=>null;
 assert.doesNotMatch(f.P.modal(f.c,'rfq-form',{}).body,/data-proc-budget-range/);
 assert.match(f.P.modal(f.c,'rfq-form',{}).body,/No current reference range/);
});
test('RFQ submissions go to the authenticated server instead of adding browser records',async()=>{
 const f=fixture(),calls=[];f.X.api=async(...args)=>{calls.push(args);return {rfq:{id:'RFQ-SERVER'}};};f.X.refresh=async()=>{};
 const req=requirement();assert.equal(f.P.submit(f.c,form('proc-rfq'),{...req,start:req.start.slice(0,16),quoteDeadline:req.quoteDeadline.slice(0,16)}),true);
 await flush();assert.equal(calls[0][0],'/api/marketplace/rfqs');assert.equal(calls[0][1],'POST');assert.equal(f.S.rfqs.length,0);assert.equal(f.S.modal.id,'RFQ-SERVER');
});
test('KYB submission remains reviewing and cannot be approved from the browser',async()=>{
 const f=fixture({role:'Seller'}),calls=[];f.X.api=async(...args)=>{calls.push(args);return {review:{status:'Reviewing'}};};f.X.refresh=async S=>{S.review={status:'Reviewing',company:'Submitted business'};};
 f.P.submit(f.c,form('proc-kyb'),{company:'Submitted business',registration:'AB123',country:'Singapore',eligibility:'on',rightsConfirmed:'on',evidence:'Verified evidence',rights:'Authorized supplier'});
 await flush();assert.equal(calls[0][0],'/api/marketplace/kyb');assert.equal(calls[0][2].eligibility,true);assert.equal(f.S.review.status,'Reviewing');
 assert.match(f.P.supplyPage(f.c),/KYB · Reviewing/);assert.doesNotMatch(f.P.modal(f.c,'supply-form',{}).body,/data-form="proc-supply"/);
 f.S.review.status='Approved';const body=f.P.modal(f.c,'supply-form',{}).body;assert.match(body,/data-form="proc-supply"/);assert.match(body,/agent installation/i);
});
test('server errors retain the unsent form and do not add local RFQ records',async()=>{
 const f=fixture();f.S.modal={type:'rfq-form'};f.X.api=async()=>{throw Error('Verified account required.');};
 const req=requirement();f.P.submit(f.c,form('proc-rfq'),{...req,start:req.start.slice(0,16),quoteDeadline:req.quoteDeadline.slice(0,16)});
 await flush();assert.equal(f.S.rfqs.length,0);assert.equal(f.S.modal.type,'rfq-form');assert.match(f.messages.at(-1),/Verified account/);
});
test('supply and demand have separate role-correct actions and real bidding counts',()=>{
 const f=fixture(),row={id:'SUP-TEST',side:'supply',provider:'Provider <test>',model:'H100 SXM',region:'Singapore',price:2.1,count:8,hours:72,term:'Spot',biddingParties:7};
 f.X.matches=(_filters,side)=>[{...row,id:side==='supply'?'SUP-TEST':'RFQ-TEST',side}];
 let html=f.P.listingTable(f.c);assert.match(html,/H100 SXM Supply &amp; Demand/);assert.match(html,/<h3>RFQs<\/h3>/);assert.match(html,/<h3>Supply<\/h3>/);assert.match(html,/Bidding Parties/);assert.match(html,/>7<\/td>/);assert.match(html,/Buy capacity/);assert.doesNotMatch(html,/Offer capacity/);assert.match(html,/Provider &lt;test&gt;/);
 f.S.role='Seller';html=f.P.listingTable(f.c);assert.match(html,/Offer capacity/);assert.doesNotMatch(html,/Buy capacity/);
});
test('best matches and recent settlements do not synthesize records and offer gated older history',()=>{
 const f=fixture();f.X.status=()=>({matchReason:'Submit an RFQ to receive best matches.'});
 const html=f.P.matches(f.c,'best');assert.match(html,/Submit an RFQ/);assert.match(html,/Post RFQ/);assert.doesNotMatch(html,/data-resource/);
 const recent=f.P.matches(f.c,'recent');assert.match(recent,/No matches\./);assert.match(recent,/data-proc-days/);for(const label of ['1D','3D','1W','1M','3M','6M','1Y','ALL'])assert.ok(recent.includes('>'+label+'</option>'));
 const upgrade=f.P.modal(f.c,'proc-history-upgrade',{});assert.match(upgrade.body,/Historical data for up to 3 months is free\./);assert.match(upgrade.body,/6M, 1Y or all available history/);assert.match(upgrade.body,/data-act="proc-contact-sales"/);
 assert.equal(f.X.listPublic('rental','supply').length,0);assert.equal(f.X.matches(f.S,'supply').length,0);
});
test('physical and model edit forms keep their unit-specific fields',()=>{
 const f=fixture(),physical=install(f,requirement({kind:'physical_gpu',shippingAddress:'Singapore',count:4,budget:20000}));const physicalHtml=f.P.modal(f.c,'proc-edit',{id:physical.id}).body;
 assert.match(physicalHtml,/USD \/ GPU/);assert.match(physicalHtml,/shippingAddress/);assert.doesNotMatch(physicalHtml,/Duration \(hours\)|CUDA/);
 const r=install(f,requirement({id:'RFQ-MODEL',kind:'model_capacity',count:0,hours:0,days:30,inputMillion:10,outputMillion:2,budget:12,priceSnapshot:{input:.51,output:3.06}}));const modelHtml=f.P.modal(f.c,'proc-edit',{id:r.id}).body;
 assert.match(modelHtml,/Input volume \(million tokens\)/);assert.match(modelHtml,/Maximum total budget/);assert.doesNotMatch(modelHtml,/GPU quantity|Duration \(hours\)|SSH/);
});
