'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const terminal=fs.readFileSync(path.join(root,'OpenNEXT-terminal.js'),'utf8');
const insightSource=fs.readFileSync(path.join(root,'OpenNEXT-seller-activities-preview.js'),'utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function line(prefix){const result=terminal.split(/\r?\n/).find(value=>value.startsWith(prefix));assert.ok(result,'Missing source declaration: '+prefix);return result;}
function functionSource(name,next){const start=terminal.indexOf('  function '+name+'('),end=terminal.indexOf('  function '+next+'(',start);assert.ok(start>=0&&end>start);return terminal.slice(start,end);}
function nav(role,route){
  const context={S:{role,route,balance:100,userOpen:false,identity:{name:'Test User'}},esc,money:value=>'$'+value,brand:()=>'<span>OpenNEXT</span>',context:()=>({}),window:{OpenNEXTQuotePreview:{bell:()=>''}}};
  vm.runInNewContext(functionSource('header','userMenu')+'\nthis.markup=header();',context);
  const navigation=context.markup.match(/<nav class="preview-terminal-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
  return {markup:navigation,items:[...navigation.matchAll(/data-nav="([^"]+)"[^>]*>([^<]+)<\/button>/g)].map(match=>[match[1],match[2]])};
}
function routing({auth=true,onboarded=true,role='Buyer'}={}){
  const rendered=[],history=[];
  const context={S:{auth,user:auth?{onboardingCompleted:onboarded}:null,role,route:'market',view:auth?'terminal':'auth',marketRoute:'market'},onSite:false,history:{pushState:(_a,_b,url)=>history.push(url)},render:()=>rendered.push(true),resumeListingIntent(){},resumeMarketOpportunity(){}};
  vm.runInNewContext(line('  const routes=')+'\n'+line('  const routeTarget=')+'\n'+functionSource('go','resumeMarketOpportunity')+'\nthis.navigate=go;this.resolve=routeTarget;',context);
  return {context,rendered,history};
}
function terminalPage(role,route){
  const calls=[];
  const context={S:{role,route},header:()=>'<header></header>',context:()=>({S:{role,route}}),window:{OpenNEXTSellerActivities:{render:ctx=>{calls.push(['insight',ctx.S.role]);return '<div data-test-insight></div>';}},OpenNEXTSpotMarket:{render:()=>{calls.push(['market']);return '<div data-test-market></div>';}}},market:()=>'<div data-test-market-fallback></div>',collection:()=>'',instances:()=>'',models:()=>'',previewRfqs:()=>'',supply:()=>'',billing:()=>'',profile:()=>'',settings:()=>'',help:()=>''};
  context.marketInsight=()=>context.window.OpenNEXTSellerActivities.render(context.context());
  vm.runInNewContext(line('  function terminal(')+'\nthis.markup=terminal();',context);
  return {markup:context.markup,calls};
}
function insight(role){
  const sandbox={Date,Intl,console,OpenNEXTDemo:{active:true}};
  vm.runInNewContext(insightSource,sandbox);
  return sandbox.OpenNEXTSellerActivities.render({S:{role},esc,render(){}});
}

test('Buyer top navigation keeps GPU Market and adds a separate Market Insight destination',()=>{
  const result=nav('Buyer','insight');
  assert.deepEqual(result.items,[['market','GPU Market'],['insight','Market Insight'],['rfqs','RFQs & Quote'],['instances','Instances'],['billing','Billing']]);
  assert.match(result.markup,/data-nav="insight" aria-current="page"/);
  assert.doesNotMatch(result.markup,/data-nav="market" aria-current="page"/);
});

test('Seller top navigation preserves its existing Market Insight route and supply destination',()=>{
  const result=nav('Seller','market');
  assert.deepEqual(result.items,[['market','Market Insight'],['supply','Supply'],['instances','Instances'],['billing','Billing']]);
  assert.match(result.markup,/data-nav="market" aria-current="page"/);
});

test('Buyer insight renders the shared component without replacing its GPU purchase market',()=>{
  const buyerInsight=terminalPage('Buyer','insight'),buyerMarket=terminalPage('Buyer','market'),sellerMarket=terminalPage('Seller','market');
  assert.match(buyerInsight.markup,/data-test-insight/);assert.deepEqual(buyerInsight.calls,[['insight','Buyer']]);
  assert.match(buyerMarket.markup,/data-test-market/);assert.deepEqual(buyerMarket.calls,[['market']]);
  assert.match(sellerMarket.markup,/data-test-insight/);assert.deepEqual(sellerMarket.calls,[['insight','Seller']]);
});

test('Insight deep links are allowed and retain existing sign-in/onboarding guards',()=>{
  const active=routing();assert.equal(active.context.resolve('insight'),'insight');active.context.navigate('insight');
  assert.equal(active.context.S.route,'insight');assert.equal(active.context.S.view,'terminal');assert.deepEqual(active.history,['#terminal/insight']);
  assert.equal(active.context.S.marketRoute,'market');
  const signedOut=routing({auth:false});signedOut.context.navigate('insight');assert.equal(signedOut.context.S.pending,'insight');assert.equal(signedOut.context.S.view,'auth');assert.equal(signedOut.history.length,0);
  const onboarding=routing({onboarded:false});onboarding.context.navigate('insight');assert.equal(onboarding.context.S.pending,'insight');assert.equal(onboarding.context.S.view,'onboarding');assert.equal(onboarding.history.length,0);
  assert.match(terminal,/S\.pending=routeTarget\(requested\)/);
});

test('Buyer shared Insight retains all three panels and offers browse market, never supply publishing',()=>{
  const html=insight('Buyer');
  for(const panel of ['index','analytics','activities'])assert.match(html,new RegExp('data-sa-panel="'+panel+'" aria-pressed="true"'));
  assert.match(html,/data-visible-count="3"/);assert.match(html,/data-nav="market"[^>]*>[\s\S]*?Browse GPU Market/);
  assert.doesNotMatch(html,/data-act="new-supply"|List my supply/);
  assert.match(html,/aria-label="Market insight filters"/);
});

test('Seller shared Insight keeps List my supply and does not gain the Buyer browse action',()=>{
  const html=insight('Seller');
  assert.match(html,/data-act="new-supply"[^>]*>[\s\S]*?List my supply/);
  assert.doesNotMatch(html,/Browse GPU Market/);
});
