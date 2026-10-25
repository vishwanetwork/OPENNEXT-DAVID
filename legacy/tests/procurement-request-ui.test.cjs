'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const countries=require('../OpenNEXT-countries.js');
const {transactionAmounts}=require('../OpenNEXT-transaction-fees.cjs');
const procurement=fs.readFileSync(path.join(__dirname,'../OpenNEXT-procurement.js'),'utf8');
const details=fs.readFileSync(path.join(__dirname,'../OpenNEXT-rfq-details.js'),'utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(value));
const record={id:'RFQ-ABCD',ownerId:'buyer-one',kind:'gpu_rental',requestKind:'rfq',model:'H100',region:'Singapore',vcpu:128,count:8,memory:80,hours:24,term:'Spot',budget:2.15,start:'2026-12-01T12:00:00.000Z',quoteDeadline:'2026-11-30T12:00:00.000Z',network:'',storage:'',image:'',sla:'',notes:'',visibility:'Public requirements',deliveryMethod:'SSH / root access',urgency:'Standard',shareClosingPrice:false,status:'Reviewing',quotes:[]};
function harness(){
  const events={},requests=[],opened=[],routes=[],toasts=[];
  const user={id:'buyer-one',role:'buyer',email:'buyer@example.test',onboardingCompleted:true};
  const S={role:'Buyer',route:'market',model:'H100',region:'Singapore',term:'Spot',count:8,rfqs:[],orders:[],notifications:[],listings:[],responses:[],identity:{},review:{}};
  const receipt={receiptId:'RCPT-0123456789ABCDEF',status:'Received',receivedAt:'2026-11-01T00:00:00.000Z',revision:1};
  const X={kindOf:r=>r?.kind||'gpu_rental',get:()=>null,deliveryMethod:()=> 'SSH / root access',budgetRange:()=>({min:1,max:4,average:2}),uid:()=> 'submission-one',api:async(route,method,payload)=>{requests.push({route,method,payload});return {rfq:{...record,...payload,submission:receipt}};},refresh:async()=>{},matches:()=>[],status:()=>({})};
  const scope={OpenNEXTExchange:X,OpenNEXTCountries:countries,OpenNEXTAuth:{getUser:()=>user},crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'}};
  const sandbox={window:scope,document:{addEventListener:(name,handler)=>{events[name]=handler;}},Intl,Date,Map,Set,WeakMap,WeakSet};
  vm.runInNewContext(details,sandbox);vm.runInNewContext(procurement,sandbox);
  const c={S,esc,money,open:(...args)=>opened.push(args),go:route=>{routes.push(route);S.route=route;},toast:message=>toasts.push(message),render(){},persist(){}};
  return {api:scope.OpenNEXTProcurement,details:scope.OpenNEXTRfqDetails,c,S,X,events,requests,opened,routes,toasts,receipt};
}
const inputTag=(html,name)=>html.match(new RegExp('<(?:input|textarea|select)\\b[^>]*\\bname="'+name+'"[^>]*>'))?.[0];
const buttonLabels=html=>[...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(match=>match[1].replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').trim());
const renderedForm=(h,prefill={})=>h.api.modal(h.c,'rfq-form',{prefill:{...record,...prefill}});

test('GPU RFQ form drops requirement/project and orders hardware fields before duration',()=>{
  const h=harness(),view=renderedForm(h);
  assert.equal(view.title,'Post capacity RFQ');
  assert.equal(inputTag(view.body,'title'),undefined);assert.equal(inputTag(view.body,'project'),undefined);
  const ordered=['model','region','vcpu','count','memory','hours'];let previous=-1;
  for(const name of ordered){const tag=inputTag(view.body,name);assert.ok(tag,name+' control exists');const position=view.body.indexOf(tag);assert.ok(position>previous,name+' field order');previous=position;}
  assert.match(inputTag(view.body,'vcpu'),/\brequired\b/);assert.match(inputTag(view.body,'memory'),/\brequired\b/);
  assert.deepEqual(buttonLabels(view.body),['Cancel','Post RFQ']);
});

test('Network, storage, runtime, SLA and workload requirements are genuinely optional',()=>{
  const h=harness(),html=renderedForm(h).body;
  for(const name of ['network','storage','image','sla','notes']){const tag=inputTag(html,name);assert.ok(tag);assert.doesNotMatch(tag,/\brequired\b/);}
  for(const label of ['Network / interconnect','Storage capacity / type','Runtime / OS / image','SLA / support needs','Workload and acceptance requirements'])assert.ok(html.includes(label+' <span class="muted">(optional)</span>'));
});

test('Ask for quote carries the selected listing without creating requirement/project fields',()=>{
  const h=harness(),selectedOffer={id:'offer-one',model:'H100',country:'Singapore',term:'Reserved',gpuCount:8,vcpu:128,memory:80,perGpuHourly:2.15,instanceHourly:17.2};
  const view=renderedForm(h,{requestKind:'quote_request',term:'Reserved',selectedOffer});
  assert.equal(view.title,'Ask for quote');assert.deepEqual(buttonLabels(view.body),['Cancel','Submit request']);
  assert.match(inputTag(view.body,'requestKind'),/value="quote_request"/);assert.ok(inputTag(view.body,'selectedOffer').includes(esc(JSON.stringify(selectedOffer))));
  assert.equal(inputTag(view.body,'title'),undefined);assert.equal(inputTag(view.body,'project'),undefined);
  assert.doesNotMatch(view.body,/This local preview saves|no email is sent in this preview/);
});

test('Ask for quote offers only supported negotiated terms while a general RFQ also permits Spot',()=>{
  const h=harness(),terms=html=>[...html.match(/<select\b[^>]*name="term"[^>]*>([\s\S]*?)<\/select>/)[1].matchAll(/<option\b[^>]*>(.*?)<\/option>/g)].map(match=>match[1]);
  assert.deepEqual(terms(renderedForm(h).body),['Spot','On-demand','Reserved']);
  for(const term of ['On-demand','Reserved']){
    const html=renderedForm(h,{requestKind:'quote_request',term}).body;
    assert.deepEqual(terms(html),['On-demand','Reserved']);
    assert.match(html,new RegExp('<option selected>'+term+'<\\/option>'));
  }
});

test('Maximum Quote Price is the quantity-duration budget total and precedes footer actions',()=>{
  const h=harness(),html=renderedForm(h,{budget:2.15,count:8,hours:24}).body;
  assert.match(html,/Maximum Quote Price:/);assert.match(html,/data-proc-maximum-quote[^>]*>\$412\.80</);
  const totalPosition=html.indexOf('Maximum Quote Price:'),cancelPosition=html.indexOf('>Cancel</button>');assert.ok(totalPosition<cancelPosition);
  const empty=renderedForm(h,{budget:''}).body;assert.match(empty,/data-proc-maximum-quote[^>]*>—</);
});

test('Micro-rate prices agree across RFQ form, account table, submitted details and backend totals',()=>{
  const h=harness();
  for(const budget of [2.145,0.000001,1.005,2.123456,2.1234564]){
    const row={...record,budget},expected=transactionAmounts({kind:row.kind,rate:budget,count:row.count,hours:row.hours}).subtotal;
    const view=renderedForm(h,{budget});assert.ok(view.body.includes('>'+money(expected)+'</strong>'),'Form retains rate precision '+budget);
    h.S.rfqs=[row];assert.ok(h.api.page(h.c).includes('<strong>'+money(expected)+'</strong>'),'Table retains rate precision '+budget);
    assert.equal(h.details.maximum(row),expected,'Read-only details matches backend '+budget);
  }
  const budgetControl=inputTag(renderedForm(h).body,'budget');assert.match(budgetControl,/step="0\.000001"/);assert.match(budgetControl,/min="0\.000001"/);
});

test('Changing price, quantity, hours or the reference slider updates the displayed maximum',()=>{
  const h=harness(),fields={kind:{value:'gpu_rental'},budget:{value:'2.15'},count:{value:'8'},hours:{value:'24'}},output={textContent:''};
  const form={querySelector:selector=>selector==='[data-proc-maximum-quote]'?output:selector==='[data-proc-fee-estimate]'?null:fields[selector.match(/name="([^"]+)"/)?.[1]]||null};
  function input(name,value,slider=false){
    if(!slider)fields[name].value=String(value);
    const target={value:String(value),matches:selector=>selector.split(',').map(x=>x.trim()).includes(slider?'[data-proc-budget-range]':'[name="'+name+'"]'),closest:selector=>selector==='form'||selector==='form[data-form="proc-rfq"]'?form:null};
    h.events.input({target});return output.textContent;
  }
  assert.equal(input('budget','2.15'),'$412.80');
  assert.equal(input('count','4'),'$206.40');
  assert.equal(input('hours','10'),'$86.00');
  assert.equal(input('budget','1.25',true),'$50.00');assert.equal(fields.budget.value,'1.25');
  assert.equal(input('hours','2'),'$10.00');assert.equal(input('count','3'),'$7.50');
  assert.equal(input('budget','2.145',true),'$12.87');assert.equal(Number(fields.budget.value),2.145);
  assert.equal(input('budget','2.33'),'$13.98');
  for(const value of ['',0,-1,'not-a-price','Infinity'])assert.equal(input('budget',value),'—');
});

test('Fractional reference rates retain precision until the final subtotal',()=>{
  const h=harness(),details=require('../OpenNEXT-rfq-details.js');
  for(const [budget,count,hours,total] of [[2.145,8,24,411.84],[2.345678,8,72,1351.11]]){
    const value={...record,budget,count,hours},html=renderedForm(h,value).body;
    assert.equal(details.maximum(value),total);
    assert.ok(html.includes('>'+h.c.money(total)+'</strong>'));
  }
});

test('RFQ and quote submissions preserve the current page and provide server-backed success actions',async()=>{
  for(const requestKind of ['rfq','quote_request']){
    const h=harness(),submitButton={disabled:false,isConnected:true},form={dataset:{form:'proc-rfq',id:''},querySelector:()=>submitButton};
    const data={...record,requestKind,start:'2026-12-01T12:00',quoteDeadline:'2026-11-30T12:00',selectedOffer:requestKind==='quote_request'?JSON.stringify({id:'offer-one',model:'H100',term:'Reserved'}):undefined};delete data.id;
    assert.equal(h.api.submit(h.c,form,data),true);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(h.requests.length,1);assert.equal(h.requests[0].route,'/api/marketplace/rfqs');assert.equal(h.requests[0].method,'POST');assert.equal(h.requests[0].payload.requestKind,requestKind);assert.equal(h.requests[0].payload.notes,'');
    if(requestKind==='quote_request')assert.equal(h.requests[0].payload.selectedOffer.id,'offer-one');
    assert.equal(h.S.route,'market');assert.deepEqual(h.routes,[]);assert.equal(h.S.modal.type,'proc-submission');assert.equal(submitButton.disabled,false);
    const success=h.api.modal(h.c,h.S.modal.type,h.S.modal);
    assert.equal(success.title,'Request submitted successfully');
    assert.ok(success.body.includes('Our team will match suitable capacity as soon as possible and notify you of the latest progress. Our sales team may also contact you by email.'));
    assert.deepEqual(buttonLabels(success.body),['RFQs & Quote','OK']);assert.match(success.body,/data-act="close-modal"[^>]*>OK<\/button>/);
    assert.equal(h.api.action(h.c,'proc-submission-view',{dataset:{id:'rfq'}}),true);assert.equal(h.S.route,'rfqs');assert.equal(h.S.modal,null);
  }
});

test('A missing operations receipt does not falsely claim a successful operations submission',()=>{
  const h=harness(),view=h.api.modal(h.c,'proc-submission',{recordKind:'rfq',id:record.id,receipt:null,warnings:[]});
  assert.equal(view.title,'Request saved');assert.match(view.body,/Operations receipt is not yet confirmed/);assert.doesNotMatch(view.body,/has been submitted successfully/);assert.deepEqual(buttonLabels(view.body),['RFQs & Quote','OK']);
});

test('RFQs and Ask for quote records share one four-column table with details controls',()=>{
  const h=harness();h.S.rfqs=[record,{...record,id:'RFQ-EFAB',requestKind:'quote_request',term:'Reserved',model:'H200',vcpu:192,memory:141,budget:3.25}];
  const html=h.api.page(h.c),headings=[...html.matchAll(/<th>(.*?)<\/th>/g)].map(match=>match[1].replace(/&amp;/g,'&'));
  assert.deepEqual(headings,['Model','vCPU & Memory','Estimated Price','Details']);assert.equal((html.match(/<table\b/g)||[]).length,1);
  assert.ok(html.includes('H100'));assert.ok(html.includes('H200'));assert.ok(html.includes('192 vCPU'));assert.ok(html.includes('141 GB / GPU'));assert.equal((html.match(/data-act="proc-request-details"/g)||[]).length,2);
  assert.doesNotMatch(html,/Requirement\/ Project|BUDGET\/ SCHDULE|<th>Status<\/th>/i);
});

test('Submitted request details are read-only, escaped, complete and have only a Close action',()=>{
  const h=harness();
  for(const requestKind of ['rfq','quote_request']){
    h.S.rfqs=[{...record,requestKind,notes:'<script>alert(1)</script>\nDedicated access',network:'NVSwitch',storage:'15 TB NVMe',image:'Ubuntu',sla:'99.9%'}];
    const view=h.api.modal(h.c,'proc-request-details',{id:record.id});assert.equal(view.title,requestKind==='rfq'?'RFQ details':'Ask for quote details');
    for(const name of ['model','region','vcpu','count','memory','hours','term','budget','start','quoteDeadline','network','storage','image','sla','deliveryMethod','urgency','visibility','notes','shareClosingPrice'])assert.ok(view.body.includes('data-rfq-field="'+name+'"'));
    assert.doesNotMatch(view.body,/<form\b|<input\b|<textarea\b|<select\b|<a\b|data-nav=|data-form=|<script>/);assert.match(view.body,/&lt;script&gt;/);assert.deepEqual(buttonLabels(view.body),['Close']);assert.match(view.body,/\$412\.80/);
  }
});

test('Workspace notifications link to the complete Notification page without implementation disclaimers',()=>{
  const h=harness(),html=h.api.notifications(h.c);assert.match(html,/data-act="proc-notifications"/);assert.match(html,/View notifications/);assert.doesNotMatch(html,/Verified account notifications|configured notification service/);
  h.S.modal={type:'anything'};assert.equal(h.api.action(h.c,'proc-notifications',{dataset:{}}),true);assert.equal(h.S.route,'notifications');assert.equal(h.S.modal,null);
});
