'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../OpenNEXT-console-topups.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const fixture=(extra={})=>({id:'TOPUP-12345678',accountId:'ACCOUNT-1234',email:'buyer@example.test',amount:250,amountCents:25000,method:'bank_transfer',createdAt:'2026-10-25T02:03:04.000Z',status:'Pending',solved:false,...extra});
const decode=value=>String(value).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
class Element{
  constructor(){this.listeners=new Map();this.children=new Map();this.dataset={};this.isConnected=true;this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.html='';const classes=new Set();this.classList={toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)};}
  addEventListener(type,handler,options={}){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);options.signal?.addEventListener('abort',()=>this.removeEventListener(type,handler),{once:true});}
  removeEventListener(type,handler){this.listeners.get(type)?.delete(handler);}
  async emit(type,target=this){const event={target,preventDefault(){},stopPropagation(){}};for(const handler of this.listeners.get(type)||[])await handler(event);}
  querySelector(selector){return this.children.get(selector)||null;}
  set innerHTML(value){this.html=value;}get innerHTML(){return this.html;}
  closest(){return this;}setAttribute(){}focus(){this.focused=true;}
  remove(){this.isConnected=false;for(const child of this.children.values())if(child)child.isConnected=false;}
}
class Dialog extends Element{
  set innerHTML(value){this.html=value;const match=value.match(/<form\b([^>]+)>/);if(!match)return;const form=new Element();for(const attr of match[1].matchAll(/data-([\w-]+)="([^"]*)"/g)){const key=attr[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());form.dataset[key]=decode(attr[2]);}form.fields={fundsVerified:undefined,reason:'',token:''};for(const selector of ['button[type="submit"]','[data-topup-error]','[data-topup-stale]','[name="token"]'])form.children.set(selector,new Element());form.querySelector('[data-topup-error]').hidden=true;form.querySelector('[data-topup-stale]').hidden=true;this.form=form;this.children.set('[data-topup-form="review"]',form.dataset.topupForm==='review'?form:null);}
  get innerHTML(){return this.html;}showModal(){this.open=true;}close(){this.open=false;void this.emit('close');}remove(){super.remove();this.form?.remove();}
}
function panel(){const root=new Element();for(const selector of ['.on-topups-message','.on-topups-test-notice','.on-topups-count','.on-topups-table','[data-topup-search]','[data-topup-filter]','[data-topup-scope]'])root.children.set(selector,new Element());root.querySelector('[data-topup-scope]').value='production';root.querySelector('[data-topup-filter]').value='All';return root;}
function harness(){
  const document=new Element(),window=new Element(),dialogs=[],calls=[],timers=new Map();let root=panel(),handler,list=[],nextTimer=0;
  document.hidden=false;document.querySelector=selector=>selector==='.on-topups'?root:null;document.createElement=()=>new Dialog();document.body={append:item=>dialogs.push(item)};document.activeElement=new Element();
  const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
  const fetch=async(url,options)=>{const call={url,options,body:options.body?JSON.parse(options.body):undefined};calls.push(call);return handler?handler(call):response({requests:JSON.parse(JSON.stringify(list))});};
  vm.runInNewContext(source,{document,window,fetch,AbortController,Date,FormData:class{constructor(form){this.form=form;}get(name){return this.form.fields[name];}},setInterval:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,delay});return id;},clearInterval:id=>timers.delete(id)});
  return {api:window.OpenNEXTConsoleTopups,document,window,dialogs,calls,timers,response,get root(){return root;},setList:value=>{list=value;},setHandler:value=>{handler=value;},get table(){return root.querySelector('.on-topups-table').innerHTML;},get message(){return root.querySelector('.on-topups-message');},get dialog(){return dialogs.filter(item=>item.isConnected).at(-1);},newRoot(){root.isConnected=false;root=panel();return root;},async mount(){window.OpenNEXTConsoleTopups.mount();await tick();},async action(action,id=fixture().id,workspace=''){const button=new Element();button.dataset={topupAction:action,id,workspace};await root.emit('click',button);},async scope(value){const input=root.querySelector('[data-topup-scope]');input.value=value;await input.emit('change');await tick();}};
}

test('Top-up Requests defaults to live accounts and preserves authenticated, no-store access',async()=>{
  const h=harness();assert.match(h.api.render(),/<option value="production">Live accounts/);assert.match(h.api.render(),/<option value="demo">Test accounts/);h.setList([fixture()]);await h.mount();
  assert.equal(h.calls[0].url,'/api/admin/topups');assert.equal(h.calls[0].options.credentials,'same-origin');assert.equal(h.calls[0].options.cache,'no-store');
  for(const text of ['Email','Amount','Method','Submitted time','Status','Review','buyer@example.test','$250.00','Bank transfer','Pending','Approve','Reject'])assert(h.table.includes(text),text);
  assert.equal(h.root.querySelector('.on-topups-test-notice').hidden,true);assert.match(h.root.querySelector('.on-topups-count').textContent,/Live accounts/);h.api.destroy();
});

test('all untrusted record fields are escaped in both table and confirmation dialog',async()=>{
  const h=harness();const row=fixture({id:'TOPUP-<"bad>',email:'<script>alert(1)</script>',method:'<img src=x onerror=alert(1)>',reason:'<b>unsafe</b>'});h.setList([row]);await h.mount();assert.doesNotMatch(h.table,/<script>|<img|<b>unsafe/);assert.match(h.table,/&lt;script&gt;/);assert.match(h.table,/&lt;img/);assert.match(h.table,/&lt;b&gt;unsafe/);
  await h.action('approve',row.id);assert.doesNotMatch(h.dialog.innerHTML,/<script>|<img/);assert.match(h.dialog.innerHTML,/TOPUP-&lt;&quot;bad&gt;/);h.api.destroy();
});

test('approval requires explicit verified receipt and never posts an unchecked form',async()=>{
  const h=harness();h.setList([fixture()]);await h.mount();await h.action('approve');const dialog=h.dialog,form=dialog.form;
  assert.match(dialog.innerHTML,/I have verified that the payment has been received\./);assert.match(dialog.innerHTML,/name="fundsVerified" required/);
  await dialog.emit('submit',form);assert.equal(h.calls.filter(call=>call.options.method==='POST').length,0);assert.match(form.querySelector('[data-topup-error]').textContent,/Confirm that the payment/);assert.equal(form.querySelector('button[type="submit"]').disabled,false);h.api.destroy();
});

test('confirmed approval sends server-owned decision once and displays Solved only after acknowledgement',async()=>{
  const h=harness();let row=fixture();h.setHandler(call=>{if(call.options.method==='POST'){row={...row,status:'Approved',solved:true,reviewedAt:'2026-10-25T03:00:00.000Z'};return h.response({request:row});}return h.response({requests:[row]});});await h.mount();await h.action('approve');const dialog=h.dialog;dialog.form.fields.fundsVerified='on';dialog.form.fields.reason='Bank receipt verified.';await dialog.emit('submit',dialog.form);
  const posts=h.calls.filter(call=>call.options.method==='POST');assert.equal(posts.length,1);assert.equal(posts[0].url,'/api/admin/topups/'+row.id+'/review');assert.deepEqual(posts[0].body,{decision:'Approve',reason:'Bank receipt verified.',fundsVerified:true});assert.equal(h.dialog,undefined);assert.match(h.table,/>Solved</);assert.match(h.table,/Credit added/);assert.doesNotMatch(h.table,/>Approve<|>Reject</);h.api.destroy();
});

test('rejection allows an empty reason, never claims funds and sends no verified-receipt flag',async()=>{
  const h=harness();let row=fixture();h.setHandler(call=>{if(call.options.method==='POST'){row={...row,status:'Rejected',solved:false};return h.response({request:row});}return h.response({requests:[row]});});await h.mount();await h.action('reject');assert.doesNotMatch(h.dialog.innerHTML,/name="fundsVerified"/);assert.match(h.dialog.innerHTML,/Rejection reason.*optional/);const dialog=h.dialog;await dialog.emit('submit',dialog.form);
  assert.deepEqual(h.calls.find(call=>call.options.method==='POST').body,{decision:'Reject',reason:''});assert.match(h.table,/>Rejected</);assert.match(h.table,/No Credit added/);assert.doesNotMatch(h.table,/>Solved</);h.api.destroy();
});

test('pending review locks duplicate actions and account scope until the server responds',async()=>{
  const h=harness();let row=fixture(),resolve;h.setHandler(call=>call.options.method==='POST'?new Promise(done=>{resolve=done;}):h.response({requests:[row]}));await h.mount();await h.action('approve');const dialog=h.dialog,form=dialog.form;form.fields.fundsVerified='on';const first=dialog.emit('submit',form);await tick();await dialog.emit('submit',form);await h.action('reject');await h.scope('demo');
  assert.equal(h.calls.filter(call=>call.options.method==='POST').length,1);assert.equal(h.dialog,dialog);assert.equal(form.querySelector('button[type="submit"]').disabled,true);assert.equal(h.root.querySelector('[data-topup-scope]').disabled,true);assert.equal(h.calls.some(call=>call.url.includes('scope=demo')),false);
  row={...row,status:'Approved',solved:true};resolve(h.response({request:row}));await first;assert.equal(h.root.querySelector('[data-topup-scope]').disabled,false);h.api.destroy();
});

test('test accounts use a separate URL, require workspace routing and remain visibly isolated',async()=>{
  const h=harness();let testRow=fixture({email:'test@example.test',workspaceId:'DEMO-1234',demo:true});const live=fixture({email:'live@example.test'});h.setHandler(call=>{if(call.options.method==='POST'){testRow={...testRow,status:'Approved',solved:true};return h.response({request:testRow});}return h.response({requests:call.url.includes('scope=demo')?[testRow]:[live]});});await h.mount();assert.match(h.table,/live@example.test/);await h.scope('demo');assert.doesNotMatch(h.table,/live@example.test/);assert.match(h.table,/test@example.test|Test account/);assert.equal(h.root.querySelector('.on-topups-test-notice').hidden,false);
  await h.action('approve',testRow.id,testRow.workspaceId);assert.match(h.dialog.innerHTML,/No live Credit or real payment is affected/);h.dialog.form.fields.fundsVerified='on';const dialog=h.dialog;await dialog.emit('submit',dialog.form);const post=h.calls.find(call=>call.options.method==='POST');assert.equal(post.url,'/api/admin/topups/'+testRow.id+'/review?scope=demo');assert.equal(post.body.workspaceId,testRow.workspaceId);
  await h.scope('production');assert.match(h.table,/live@example.test/);assert.doesNotMatch(h.table,/test@example.test/);await h.action('reject',live.id);assert.match(h.dialog.innerHTML,/Reject top-up/);h.api.destroy();
});

test('wrong-scope lists fail closed without leaking test or live records',async()=>{
  const h=harness();h.setList([fixture({workspaceId:'DEMO-1',email:'secret-test@example.test'})]);await h.mount();assert.doesNotMatch(h.table,/secret-test@example.test/);assert.match(h.message.textContent,/different account scope/);
  h.setList([fixture({email:'secret-live@example.test'})]);await h.scope('demo');assert.doesNotMatch(h.table,/secret-live@example.test/);assert.match(h.message.textContent,/different account scope/);h.api.destroy();
});

test('late scope responses cannot overwrite the current scope and do not remove action listeners',async()=>{
  const h=harness(),resolvers=[];h.setHandler(()=>new Promise(resolve=>resolvers.push(resolve)));h.api.mount();await tick();const initialSignal=h.calls[0].options.signal;await h.scope('demo');assert.equal(initialSignal.aborted,true);assert.equal(h.calls.length,2);
  const row=fixture({workspaceId:'DEMO-current',email:'current-test@example.test'});resolvers[1](h.response({requests:[row]}));await tick();resolvers[0](h.response({requests:[fixture({email:'old-live@example.test'})]}));await tick();assert.match(h.table,/current-test@example.test/);assert.doesNotMatch(h.table,/old-live@example.test/);await h.action('reject',row.id,row.workspaceId);assert.match(h.dialog.innerHTML,/Reject top-up/);h.api.destroy();
});

test('freshly reviewed records disable a stale dialog without losing entered notes',async()=>{
  const h=harness();h.setList([fixture()]);await h.mount();await h.action('approve');const dialog=h.dialog,form=dialog.form;form.fields.reason='Keep this draft.';form.fields.fundsVerified='on';h.setList([fixture({status:'Rejected'})]);await h.api.refresh();assert.equal(h.dialog,dialog);assert.equal(form.fields.reason,'Keep this draft.');assert.equal(form.querySelector('[data-topup-stale]').hidden,false);assert.equal(form.querySelector('button[type="submit"]').disabled,true);await dialog.emit('submit',form);assert.equal(h.calls.filter(call=>call.options.method==='POST').length,0);h.api.destroy();
});

test('conflicting decisions refresh the authoritative state without claiming a successful credit',async()=>{
  const h=harness();let row=fixture();h.setHandler(call=>{if(call.options.method==='POST'){row={...row,status:'Rejected'};return h.response({error:'Already rejected.'},409);}return h.response({requests:[row]});});await h.mount();await h.action('approve');const dialog=h.dialog;dialog.form.fields.fundsVerified='on';await dialog.emit('submit',dialog.form);assert.match(h.table,/>Rejected</);assert.doesNotMatch(h.table,/>Solved</);assert.equal(dialog.form.querySelector('button[type="submit"]').disabled,true);assert.match(dialog.form.querySelector('[data-topup-error]').textContent,/reviewed elsewhere/);h.api.destroy();
});

test('an in-flight old snapshot cannot overwrite a newer approval',async()=>{
  const h=harness();let row=fixture(),oldResolve,reads=0;h.setHandler(call=>{if(call.options.method==='POST'){row={...row,status:'Approved',solved:true};return h.response({request:row});}if(++reads===2)return new Promise(resolve=>{oldResolve=resolve;});return h.response({requests:[row]});});await h.mount();await h.action('approve');const dialog=h.dialog;dialog.form.fields.fundsVerified='on';const pending=h.api.refresh();await tick();const submission=dialog.emit('submit',dialog.form);await tick();assert.match(h.table,/>Solved</);oldResolve(h.response({requests:[fixture()]}));await pending;await submission;assert.match(h.table,/>Solved</);assert.doesNotMatch(h.table,/>Approve</);assert.equal(reads,3);h.api.destroy();
});

test('failed or mismatched acknowledgements never mark the request solved and preserve operator notes',async()=>{
  const h=harness();h.setHandler(call=>call.options.method==='POST'?h.response({request:fixture({id:'TOPUP-WRONG',status:'Approved'})}):h.response({requests:[fixture()]}));await h.mount();await h.action('approve');const dialog=h.dialog,form=dialog.form;form.fields.fundsVerified='on';form.fields.reason='Independent receipt checked.';await dialog.emit('submit',form);assert.equal(h.dialog,dialog);assert.equal(form.fields.reason,'Independent receipt checked.');assert.match(form.querySelector('[data-topup-error]').textContent,/did not confirm/);assert.match(h.table,/>Pending</);assert.doesNotMatch(h.table,/>Solved</);assert.equal(form.querySelector('button[type="submit"]').disabled,false);h.api.destroy();
});

test('expired administrator access clears private rows and dialogs and pauses automatic reads',async()=>{
  const h=harness();h.setList([fixture()]);await h.mount();await h.action('approve');const previous=h.dialog;h.setHandler(()=>h.response({error:'Administrator session expired.'},401));await h.api.refresh();assert.equal(previous.isConnected,false);assert.equal(h.dialog,undefined);assert.doesNotMatch(h.table,/buyer@example.test/);assert.match(h.table,/Administrator access required/);const before=h.calls.length;await h.window.emit('focus');[...h.timers.values()][0].callback();await tick();assert.equal(h.calls.length,before);h.api.destroy();
});

test('administrator reconnect uses the existing secure session endpoint and clears the token',async()=>{
  const h=harness();let connected=false;h.setHandler(call=>{if(call.url==='/api/admin/pricing/session'){connected=true;return h.response({ok:true});}return connected?h.response({requests:[fixture()]}):h.response({error:'Administrator session required.'},401);});await h.mount();await h.action('login');const dialog=h.dialog,form=dialog.form;form.fields.token='test-admin-token';form.querySelector('[name="token"]').value=form.fields.token;await dialog.emit('submit',form);const post=h.calls.find(call=>call.options.method==='POST');assert.equal(post.url,'/api/admin/pricing/session');assert.deepEqual(post.body,{token:'test-admin-token'});assert.equal(form.querySelector('[name="token"]').value,'');assert.match(h.table,/buyer@example.test/);h.api.destroy();
});

test('polling preserves search and filters, coalesces reads, and tears down cleanly',async()=>{
  const h=harness();h.setList([fixture(),fixture({id:'TOPUP-OTHER',email:'other@example.test',status:'Approved',solved:true})]);await h.mount();const search=h.root.querySelector('[data-topup-search]'),filter=h.root.querySelector('[data-topup-filter]');search.value='buyer';await search.emit('input');filter.value='Pending';await filter.emit('change');const timer=[...h.timers.values()][0];assert.equal(timer.delay,15000);await timer.callback();assert.match(h.table,/buyer@example.test/);assert.doesNotMatch(h.table,/other@example.test/);assert.equal(search.value,'buyer');assert.equal(filter.value,'Pending');
  h.document.hidden=true;const before=h.calls.length;await timer.callback();await h.window.emit('focus');assert.equal(h.calls.length,before);h.document.hidden=false;await h.document.emit('visibilitychange');assert.equal(h.calls.length,before+1);
  let resolve;h.setHandler(()=>new Promise(done=>{resolve=done;}));const pending=h.api.refresh();await tick();const coalesced=h.api.refresh();assert.equal(pending,coalesced);h.api.destroy();assert.equal(h.timers.size,0);resolve(h.response({requests:[fixture({email:'late@example.test'})]}));await pending;const latest=h.calls.length;await h.window.emit('focus');await timer.callback();assert.equal(h.calls.length,latest);assert.doesNotMatch(h.table,/late@example.test/);
});

test('admin entrypoints include top-up assets before navigation and no Demo submissions page remains',()=>{
  for(const file of ['admin/index.html','OpenNEXT-admin-console.html']){const html=fs.readFileSync(path.join(__dirname,'..',file),'utf8');assert.match(html,/OpenNEXT-console-topups\.css/);assert.match(html,/OpenNEXT-console-topups\.js/);assert(html.indexOf('OpenNEXT-console-topups.js')<html.indexOf('OpenNEXT-admin.js'));}
  const admin=fs.readFileSync(path.join(__dirname,'../OpenNEXT-admin.js'),'utf8');assert.match(admin,/topups:'Top-up Requests'/);assert.match(admin,/OpenNEXTConsoleTopups\.mount\(\)/);assert.match(admin,/OpenNEXTConsoleTopups\?\.destroy\(\)/);assert.doesNotMatch(admin,/demoSubmissions|Demo submissions/);
});
