'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const account=(id='buyer-one',overrides={})=>({confirmed:true,accountId:id,currency:'USD',availableCredit:350,paidCredit:250,promotionalCredit:100,requests:[{id:'TOPUP-ONE',accountId:id,status:'Approved',amount:250,currency:'USD'}],notifications:[{id:'TOPUP-NOTICE',ownerId:id,topupId:'TOPUP-ONE',subject:'Credit deposit approved',message:'Credit is now available.',created:'2026-11-01T00:00:00Z',read:false}],...overrides});
function harness(){
  let user={id:'buyer-one',role:'buyer',onboardingCompleted:true,promotionalCredit:100,fundedCredit:0};
  const S={user,role:'Buyer',route:'market',model:'H100',region:'Singapore',notifications:[],rfqs:[],orders:[],balance:100};
  const calls=[],events={},documentEvents={},opened=[];
  let fetcher=async url=>url==='/api/billing/account'?account(user.id):url==='/api/marketplace/me'?{rfqs:[],listings:[],review:{},responses:[],orders:[],instances:[],notifications:[{id:'RFQ-NOTICE',ownerId:user.id,subject:'RFQ update',created:'2026-10-31T00:00:00Z'}]}:url.startsWith('/api/marketplace/matches')?{rows:[],reason:'No matches.'}:url==='/api/marketplace/public'?{rfqs:[],supplies:[],featured:{rfqs:[],supplies:[]}}:{rows:[],rfqs:[],supplies:[],recent:[]};
  const document={hidden:false,activeElement:null,querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(name,handler)=>{documentEvents[name]=handler;}};
  const scope={OpenNEXTAuth:{getUser:()=>user},addEventListener:(name,handler)=>{(events[name]||=[]).push(handler);},dispatchEvent:event=>{for(const handler of events[event.type]||[])handler(event);}};
  const sandbox={window:scope,document,Date,Map,Set,WeakMap,Intl,URLSearchParams,setInterval:()=>0,localStorage:{getItem:()=>null,setItem(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},fetch:async(url,options)=>{calls.push({url,options});const data=await fetcher(url,options);return {ok:true,json:async()=>data};}};
  vm.runInNewContext(read('OpenNEXT-exchange.js'),sandbox);scope.OpenNEXTExchange.init(S);
  const c={S,open:(...args)=>opened.push(args),go:route=>{S.route=route;},toast(){}};
  return {S,c,scope,sandbox,X:scope.OpenNEXTExchange,calls,events,documentEvents,opened,setFetcher:value=>{fetcher=value;},setUser:(value,syncState=true)=>{user=value;if(syncState)S.user=value;},getUser:()=>user};
}

test('verified account refresh applies approved paid credit and merges account-owned notices',async()=>{
  const h=harness();h.S.notifications=[{id:'RFQ-NOTICE',ownerId:'buyer-one',subject:'RFQ update'}];
  await h.X.refreshBillingAccount(h.S);
  assert.equal(h.S.balance,350);assert.equal(h.S.paidCredit,250);assert.equal(h.S.promotionalCredit,100);assert.equal(h.X.hasVerifiedBillingAccount(h.S),true);
  assert.equal(h.S.topupRequests[0].accountId,'buyer-one');assert.deepEqual(Array.from(h.S.notifications,n=>n.id).sort(),['RFQ-NOTICE','TOPUP-NOTICE']);
  assert.equal(h.calls[0].url,'/api/billing/account');assert.equal(h.calls[0].options.credentials,'same-origin');
});

test('marketplace refresh and repeated account refresh preserve billing notifications without duplicates',async()=>{
  const h=harness();await h.X.refreshBillingAccount(h.S);await h.X.refresh(h.S);await h.X.refreshBillingAccount(h.S);
  assert.equal(h.S.balance,350);assert.deepEqual(Array.from(h.S.notifications,n=>n.id).sort(),['RFQ-NOTICE','TOPUP-NOTICE']);assert.equal(h.S.billingNotifications.length,1);
  assert.equal(h.S.marketplaceNotifications.length,1);
});

test('incomplete, foreign and unconfirmed account snapshots cannot replace a verified balance',()=>{
  const h=harness();h.X.applyBillingAccount(h.S,account());
  for(const change of [{confirmed:false},{accountId:'another-user'},{currency:'EUR'},{availableCredit:-1},{availableCredit:'999'},{paidCredit:Infinity},{promotionalCredit:null},{requests:null},{notifications:null}]){
    assert.throws(()=>h.X.applyBillingAccount(h.S,account('buyer-one',change)),/verified credit account response/);assert.equal(h.S.balance,350);assert.equal(h.S.topupRequests.length,1);
  }
});

test('a billing outage does not zero the last server-confirmed credit account',async()=>{
  const h=harness();h.X.applyBillingAccount(h.S,account());h.setFetcher(async()=>{throw Error('Billing temporarily unavailable.');});
  await assert.rejects(h.X.refreshBillingAccount(h.S),/temporarily unavailable/);assert.equal(h.S.balance,350);assert.equal(h.X.hasVerifiedBillingAccount(h.S),true);assert.equal(h.S.billingNotifications.length,1);
});

test('request and notification records with a foreign account identity are discarded',()=>{
  const h=harness(),data=account();data.requests.push({id:'FOREIGN',accountId:'another-user'},{id:'OWNERLESS'});data.notifications.push({id:'PRIVATE',ownerId:'another-user',topupId:'FOREIGN'},{id:'OWNERLESS-NOTICE'});
  h.X.applyBillingAccount(h.S,data);assert.deepEqual(Array.from(h.S.topupRequests,row=>row.id),['TOPUP-ONE']);assert.deepEqual(Array.from(h.S.notifications,row=>row.id),['TOPUP-NOTICE']);
});

test('concurrent account refreshes share one request and late previous-user results are discarded',async()=>{
  const h=harness(),pending=[];h.setFetcher(()=>new Promise(resolve=>pending.push(resolve)));
  const first=h.X.refreshBillingAccount(h.S),duplicate=h.X.refreshBillingAccount(h.S);assert.equal(h.calls.length,1);
  h.setUser({id:'buyer-two',role:'buyer',onboardingCompleted:true,promotionalCredit:0});const second=h.X.refreshBillingAccount(h.S);assert.equal(h.S.balance,0);assert.equal(h.calls.length,2);
  pending[1](account('buyer-two',{availableCredit:20,paidCredit:20,promotionalCredit:0}));await second;
  pending[0](account('buyer-one'));assert.equal(await first,null);assert.equal(await duplicate,null);
  assert.equal(h.S.balance,20);assert.equal(h.S.billingAccountId,'buyer-two');assert.equal(h.S.notifications.every(row=>row.ownerId==='buyer-two'),true);
});

test('signout clears account state and a mismatched Terminal context cannot load another account',async()=>{
  const h=harness();h.X.applyBillingAccount(h.S,account());h.setUser(null);await h.X.refreshBillingAccount(h.S);
  assert.equal(h.S.balance,0);assert.equal(h.S.topupRequests.length,0);assert.equal(h.S.notifications.length,0);assert.equal(h.X.hasVerifiedBillingAccount(h.S),false);assert.equal(h.calls.length,0);
  h.setUser({id:'buyer-two',role:'buyer',onboardingCompleted:true},false);assert.equal(await h.X.refreshBillingAccount(h.S),null);assert.equal(h.calls.length,0);
});

test('Terminal session updates preserve verified credit but identity and Demo scope changes clear it',()=>{
  const h=harness(),terminal=read('OpenNEXT-terminal.js');
  const begin=terminal.indexOf('  function applySession(user){'),end=terminal.indexOf('  async function refreshWorkspace()',begin);assert.ok(begin>=0&&end>begin);
  h.sandbox.S=h.S;vm.runInNewContext(terminal.slice(begin,end)+'\nwindow.applySessionForTest=applySession;',h.sandbox);
  h.X.applyBillingAccount(h.S,account());h.scope.applySessionForTest({...h.getUser(),name:'Updated name'});assert.equal(h.S.balance,350);assert.equal(h.S.topupRequests.length,1);
  const demo={...h.getUser(),demo:true};h.setUser(demo,false);h.scope.applySessionForTest(demo);assert.equal(h.S.balance,100);assert.equal(h.S.topupRequests.length,0);assert.equal(h.X.hasVerifiedBillingAccount(h.S),false);
  h.setUser(null,false);h.scope.applySessionForTest(null);assert.equal(h.S.balance,0);assert.equal(h.S.billingAccountId,null);
});

test('top-up notices survive notification refresh and open their own status dialog',async()=>{
  const h=harness();vm.runInNewContext(read('OpenNEXT-quote-preview.js'),h.sandbox);h.X.applyBillingAccount(h.S,account());
  const qp=h.scope.OpenNEXTQuotePreview;qp.bind(h.c);await qp.refresh(true);
  assert.ok(qp.history(h.c).includes('Credit deposit approved'));assert.equal(qp.testHelpers.notices().find(row=>row.id==='TOPUP-NOTICE').topupId,'TOPUP-ONE');
  const button={dataset:{qpAction:'notification',qpId:'TOPUP-NOTICE'}};h.documentEvents.click({target:{closest:selector=>selector==='[data-qp-action]'?button:null},preventDefault(){},stopPropagation(){}});
  assert.equal(h.opened[0][0],'payment-topup-status');assert.equal(h.opened[0][1].id,'TOPUP-ONE');
});

test('auth view removes the old sourcing footer while keeping the main story and brand',()=>{
  const scope={location:{search:'',pathname:'/'},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}}};vm.runInNewContext(read('OpenNEXT-auth.js'),{window:scope,URLSearchParams});
  const html=scope.OpenNEXTAuth.render('signin');assert.doesNotMatch(html,/Private sourcing|Transparent terms|onx-auth-story-foot/);assert.match(html,/A clearer market/);assert.match(html,/Back to OpenNEXT/);
});

test('desktop GPU Market action group uses symmetric columns without replacing mobile rules',()=>{
  const css=read('OpenNEXT-spot-market-preview.css');
  assert.match(css,/@media\(min-width:821px\)\{[\s\S]*?grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)/);
  assert.match(css,/@media\(min-width:821px\)\{[\s\S]*?\.onx-spot-market-actions\{[^}]*grid-column:2[^}]*justify-self:center/);
  assert.match(css,/@media \(max-width: 820px\)[\s\S]*?\.onx-spot-market-head \{ display: flex; flex-wrap: wrap/);
});
