'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const future=(hours=48)=>new Date(Date.now()+hours*3600000).toISOString();
const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
function form(type,id=''){
  const button={disabled:false,isConnected:true};
  return {dataset:{form:type,id},button,querySelector:()=>button};
}
function fixture(overrides={}){
  const win={OpenNEXTCountries:{options:()=>'<option>Singapore</option>'}};
  const sandbox={window:win};
  for(const file of ['OpenNEXT-exchange.js','OpenNEXT-procurement.js']){
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),sandbox,{filename:file});
  }
  const X=win.OpenNEXTExchange,P=win.OpenNEXTProcurement;
  const S=X.init({auth:true,role:'Buyer',identity:{name:'Verified User',email:'user@example.test',company:''},review:{status:'Not started'},balance:0,earningsBalance:0,rfqs:[],listings:[],cart:[],saved:[],model:'H100 SXM',region:'All regions',count:8,term:'Spot',...overrides});
  const messages=[],effects={persist:0,render:0,refresh:0};
  const c={S,esc:escape,money:value=>'$'+Number(value).toFixed(2),persist(){effects.persist++;X.init(S);},render(){effects.render++;},go(route){S.route=route;},open(type,extra={}){S.modal={type,...extra};},toast(message){messages.push(message);}};
  X.refresh=async()=>{effects.refresh++;};
  return {win,X,P,S,c,messages,effects};
}
function rfqInput(overrides={}){
  return {kind:'gpu_rental',title:'Production training',project:'Training',model:'H100 SXM',region:'Singapore',count:8,hours:72,budget:2.5,term:'Spot',notes:'Exact model and delivery required',start:future(48).slice(0,16),quoteDeadline:future(24).slice(0,16),shareClosingPrice:'on',...overrides};
}
function supplyInput(overrides={}){
  return {kind:'gpu_rental',title:'Dedicated Singapore capacity',model:'H100 SXM',region:'Singapore',count:8,hours:72,netPrice:2.5,term:'On-demand',notes:'Dedicated verified capacity',serviceStart:future(48).slice(0,16),serviceEnd:future(144).slice(0,16),sshHost:'gpu.example.test',sshUser:'operations',sshPort:22,...overrides};
}
function receipt(overrides={}){
  return {receiptId:'RCPT-SERVER-001',source:'terminal',status:'Received',receivedAt:'2026-10-18T10:00:00.000Z',updatedAt:'2026-10-18T10:00:00.000Z',revision:1,...overrides};
}
function savedRfq(overrides={}){
  return {...rfqInput(),id:'RFQ-SERVER-001',status:'Open',quotes:[],audit:[],serverRecord:true,submission:receipt(),...overrides};
}
function submissionHtml(f){return f.P.modal(f.c,f.S.modal.type,f.S.modal).body;}

test('a saved RFQ displays the server-issued operations receipt without inserting a browser record',async()=>{
  const f=fixture(),calls=[],el=form('proc-rfq');
  f.X.api=async(...args)=>{calls.push(args);return {rfq:savedRfq()};};
  assert.equal(f.P.submit(f.c,el,rfqInput()),true);
  assert.equal(el.button.disabled,true);
  await flush();
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'/api/marketplace/rfqs');
  assert.equal(calls[0][1],'POST');
  assert.match(calls[0][2].clientSubmissionId,/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
  assert.match(calls[0][2].start,/Z$/);
  assert.equal(calls[0][2].shareClosingPrice,true);
  assert.equal(f.S.modal.type,'proc-submission');
  assert.equal(f.S.modal.id,'RFQ-SERVER-001');
  assert.equal(f.S.modal.receipt.receiptId,'RCPT-SERVER-001');
  assert.equal(f.S.route,'rfqs');
  assert.equal(f.S.rfqs.length,0);
  assert.equal(f.effects.refresh,1);
  assert.equal(f.effects.persist,1);
  assert.equal(el.button.disabled,false);
  assert.match(submissionHtml(f),/available in the OpenNEXT operations inbox/);
  assert.match(submissionHtml(f),/does not confirm a supplier match or place an order/);
});

test('repeated submit clicks on one pending form create only one request',async()=>{
  const f=fixture(),el=form('proc-rfq'),calls=[];
  let resolve;
  f.X.api=(...args)=>{calls.push(args);return new Promise(done=>{resolve=done;});};
  f.P.submit(f.c,el,rfqInput());
  f.P.submit(f.c,el,rfqInput());
  assert.equal(calls.length,1);
  assert.equal(el.button.disabled,true);
  resolve({rfq:savedRfq()});
  await flush();
  assert.equal(calls.length,1);
  assert.equal(f.effects.refresh,1);
  assert.equal(el.button.disabled,false);
});

test('retrying a failed request reuses its client submission identifier',async()=>{
  const f=fixture(),el=form('proc-rfq'),calls=[];
  f.S.modal={type:'rfq-form'};
  f.X.api=async(...args)=>{calls.push(args);if(calls.length===1)throw Error('Connection interrupted.');return {rfq:savedRfq()};};
  const input=rfqInput();
  f.P.submit(f.c,el,input);
  await flush();
  assert.equal(f.S.modal.type,'rfq-form');
  assert.equal(el.button.disabled,false);
  f.P.submit(f.c,el,input);
  await flush();
  assert.equal(calls.length,2);
  assert.equal(calls[0][2].clientSubmissionId,calls[1][2].clientSubmissionId);
  assert.equal(f.S.modal.id,'RFQ-SERVER-001');
  assert.equal(f.S.rfqs.length,0);
});

test('a 401 response preserves the form and never claims Console receipt',async()=>{
  const f=fixture(),el=form('proc-rfq'),original={type:'rfq-form',prefill:{title:'Unsaved requirement'}};
  f.S.modal=original;
  f.X.api=async()=>{const error=Error('Verified account required.');error.status=401;throw error;};
  f.P.submit(f.c,el,rfqInput());
  await flush();
  assert.equal(f.S.modal,original);
  assert.equal(f.S.rfqs.length,0);
  assert.equal(f.effects.refresh,0);
  assert.equal(f.effects.persist,0);
  assert.equal(el.button.disabled,false);
  assert.match(f.messages.at(-1),/Verified account required/);
  assert.doesNotMatch(f.messages.join(' '),/Submission received|operations inbox/);
});

test('a successful write keeps its receipt when refreshing the workspace fails',async()=>{
  const f=fixture(),el=form('proc-rfq'),calls=[];
  f.X.api=async(...args)=>{calls.push(args);return {rfq:savedRfq()};};
  f.X.refresh=async()=>{f.effects.refresh++;throw Error('Workspace temporarily unavailable.');};
  f.P.submit(f.c,el,rfqInput());
  await flush();
  assert.equal(calls.length,1);
  assert.equal(f.S.modal.type,'proc-submission');
  assert.equal(f.S.modal.receipt.receiptId,'RCPT-SERVER-001');
  assert.match(f.S.modal.warnings.join(' '),/saved.*workspace could not refresh/i);
  assert.match(submissionHtml(f),/Do not submit it again/);
  assert.equal(f.effects.persist,1);
  assert.equal(f.effects.render,1);
  assert.equal(el.button.disabled,false);
});

test('saved supply remains received when its separate agent request fails and still refreshes records',async()=>{
  const f=fixture({role:'Seller',review:{status:'Approved'}}),el=form('proc-supply'),calls=[];
  f.X.api=async(...args)=>{calls.push(args);if(args[0].endsWith('/agent')){const error=Error('Installer unavailable.');error.status=503;throw error;}return {supply:{id:'SUP-SERVER-001',status:'Awaiting agent',submission:receipt()}};};
  f.P.submit(f.c,el,supplyInput());
  await flush();
  assert.equal(calls.length,2);
  assert.equal(calls[0][0],'/api/marketplace/supplies');
  assert.equal(calls[1][0],'/api/marketplace/supplies/SUP-SERVER-001/agent');
  assert.equal(calls[0][1],'POST');
  assert.equal(calls[1][1],'POST');
  assert.equal(f.S.modal.type,'proc-submission');
  assert.equal(f.S.modal.id,'SUP-SERVER-001');
  assert.equal(f.S.modal.recordStatus,'Awaiting agent');
  assert.equal(f.S.route,'supply');
  assert.equal(f.effects.refresh,1);
  assert.equal(f.S.listings.length,0);
  assert.match(submissionHtml(f),/agent setup request is pending/);
  assert.match(submissionHtml(f),/Receipt does not publish capacity/);
  assert.match(submissionHtml(f),/KYB approval and verified agent installation are still required/);
});

test('a record without a confirmed receipt does not claim Console synchronization',async()=>{
  const f=fixture();
  f.X.api=async()=>({rfq:savedRfq({submission:undefined})});
  f.P.submit(f.c,form('proc-rfq'),rfqInput());
  await flush();
  assert.equal(f.S.modal.type,'proc-submission');
  assert.equal(f.S.modal.receipt,null);
  assert.match(submissionHtml(f),/Console receipt has not been confirmed/);
  assert.doesNotMatch(submissionHtml(f),/available in the OpenNEXT operations inbox/);
  assert.match(f.messages.at(-1),/Operations receipt has not been confirmed/);
});

test('malformed or unreceived receipt metadata never counts as a Console acknowledgment',async()=>{
  for(const submission of [receipt({status:'Pending'}),receipt({receivedAt:'not-a-date'}),receipt({receiptId:123}),receipt({receiptId:''}),receipt({receiptId:'   '})]){
    const f=fixture();
    f.X.api=async()=>({rfq:savedRfq({submission})});
    f.P.submit(f.c,form('proc-rfq'),rfqInput());
    await flush();
    assert.equal(f.S.modal.receipt,null);
    assert.match(submissionHtml(f),/Console receipt has not been confirmed/);
  }
});

test('editing an existing RFQ uses PATCH and does not send a new-submission identifier',async()=>{
  const f=fixture(),calls=[],updated=savedRfq({submission:receipt({revision:2})});
  f.X.api=async(...args)=>{calls.push(args);return {rfq:updated};};
  f.P.submit(f.c,form('proc-rfq',updated.id),rfqInput({budget:2.7}));
  await flush();
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'/api/marketplace/rfqs/RFQ-SERVER-001');
  assert.equal(calls[0][1],'PATCH');
  assert.equal(Object.hasOwn(calls[0][2],'clientSubmissionId'),false);
  assert.equal(f.S.modal.receipt.revision,2);
});

test('saved RFQ and supply details retain the server receipt and its approval disclaimer',()=>{
  const f=fixture(),rfq=savedRfq({submission:receipt({receiptId:'RCPT-<test>',revision:3})});
  f.S.rfqs.push(rfq);
  const detail=f.P.modal(f.c,'rfq',{id:rfq.id});
  let html=detail.body;
  assert.match(html,/Received by OpenNEXT operations/);
  assert.match(html,/RCPT-&lt;test&gt;/);
  assert.match(html,/Revision 3/);
  assert.match(html,/not approval, publication or payment/);
  assert.equal(detail.title,'Production training');
  f.S.listings.push({...supplyInput(),id:'SUP-SERVER-001',status:'Awaiting agent',agentStatus:'Pending',buyerPrice:2.625,submission:receipt()});
  html=f.P.modal(f.c,'proc-supply-status',{id:'SUP-SERVER-001'}).body;
  assert.match(html,/RCPT-SERVER-001/);
  assert.match(html,/Agent installation must be completed/);
});

test('Demo receipt confirmation explicitly remains inside the isolated test workspace',async()=>{
  const f=fixture();
  f.win.OpenNEXTDemo={active:true};
  f.X.api=async()=>({rfq:savedRfq()});
  f.P.submit(f.c,form('proc-rfq'),rfqInput());
  await flush();
  assert.equal(f.S.modal.demo,true);
  assert.match(submissionHtml(f),/only to your isolated test workspace/);
  assert.match(submissionHtml(f),/not a production submission/);
  assert.match(submissionHtml(f),/Console under Demo submissions/);
  assert.doesNotMatch(submissionHtml(f),/available in the OpenNEXT operations inbox/);
  assert.match(f.messages.at(-1),/isolated Demo workspace/);
  f.S.rfqs.push(savedRfq());
  const detail=f.P.modal(f.c,'rfq',{id:'RFQ-SERVER-001'}).body;
  assert.match(detail,/Demo submission received/);
  assert.doesNotMatch(detail,/Received by OpenNEXT operations/);
});

test('receipt navigation opens the matching records page without creating another submission',async()=>{
  for(const [recordKind,role,route] of [['rfq','Buyer','rfqs'],['supply','Seller','supply']]){
    const f=fixture({role}),calls=[];
    f.X.api=async(...args)=>{calls.push(args);return {};};
    f.S.modal={type:'proc-submission',id:'SERVER-001',recordKind,receipt:receipt()};
    assert.equal(f.P.action(f.c,'proc-submission-view',{dataset:{id:recordKind},disabled:false,isConnected:true}),true);
    assert.equal(f.S.modal,null);
    assert.equal(f.S.route,route);
    assert.equal(calls.length,0);
  }
});
