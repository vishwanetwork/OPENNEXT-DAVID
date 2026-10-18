'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const terminal=fs.readFileSync(path.join(root,'OpenNEXT-terminal.js'),'utf8');
const copy={rental:'GPU rental',models:'Model capacity',physical:'Physical GPUs'};

function catalog(rows=[]){
  const context={window:{},document:{getElementById:()=>({})},matchMedia:()=>({matches:false,addEventListener(){}}),MutationObserver:class{observe(){}}};
  context.window.OpenNEXTExchange={featured:()=>({rfqs:[],supplies:[]}),listPublic:(kind,side)=>rows.filter(row=>row.kind===kind&&row.side===side),get:id=>rows.find(row=>row.id===id)};
  for(const file of ['OpenNEXT-model-quotes.js','OpenNEXT-home-listings.js'])vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),context);
  return context.window;
}
function named(name,next){return terminal.slice(terminal.indexOf('  function '+name+'('),terminal.indexOf('  function '+next+'('));}
function routing(item,{authenticated=true,onSite=false}={}){
  const win=catalog();
  const opened=[],contacts=[],navigated=[];
  const state={auth:authenticated,view:authenticated?'terminal':'auth',role:'Buyer',pendingListing:null,review:{status:'Approved'}};
  const context={window:win,S:state,URL,URLSearchParams,onSite,TERMINAL_ORIGIN:'https://terminal.opennextlab.ai',routes:['market','models','rfqs','supply'],location:{href:'https://opennextlab.ai/'},persist(){},open:(type,extra)=>opened.push({type,...extra}),money:value=>'$'+Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}),tokenMoney:value=>'$'+Number(value).toFixed(6),clearListingIntent(){state.pendingListing=null;},findModelQuote:sku=>win.OpenNEXTModelQuotes.get(sku)};
  win.OpenNEXTListings.get=id=>id===item.id?item:undefined;
  win.OpenNEXTContact={open:options=>contacts.push(options)};
  context.go=route=>navigated.push(route);
  if(onSite)vm.runInNewContext(named('go','resumeMarketOpportunity'),context);
  vm.runInNewContext(named('queueListingIntent','clearListingIntent')+named('resumeListingIntent','currentOffers')+'\nthis.queue=queueListingIntent;this.resume=resumeListingIntent;',context);
  return {context,state,opened,contacts,navigated};
}

test('empty live model and hardware lanes retain existing catalog prices without fabricating RFQs',()=>{
  const win=catalog(),html=win.OpenNEXTListings.render(copy);
  const models=win.OpenNEXTListings.groups[1],hardware=win.OpenNEXTListings.groups[2];
  for(const item of [...models,...hardware]){
    assert.ok(html.includes('data-listing-id="'+item.id+'"'),item.id);
    assert.ok(html.includes('data-listing-selection="'+item.id+'"'),item.id);
    assert.equal(win.OpenNEXTListings.get(item.id).id,item.id);
  }
  assert.match(html,/\$1\.30/);
  assert.match(html,/\$39,500\.00/);
  assert.doesNotMatch(html,/https:\/\/www\.serversupply|https:\/\/gatewellusa|https:\/\/developers\.openai/);
  win.OpenNEXTListings.selectSide('demand');
  const demand=win.OpenNEXTListings.render(copy);
  assert.doesNotMatch(demand,/data-listing-id="model-|data-listing-id="hardware-/);
  assert.doesNotMatch(demand,/Supplier offer/);
});

test('published model supply takes precedence over the catalog fallback',()=>{
  const row={id:'SUP-MODEL-LIVE',kind:'model',side:'supply',model:'Quoted Model',title:'Quoted Model capacity',region:'Singapore',price:1,outputPrice:4,count:1000,term:'30 days'};
  const win=catalog([row]),html=win.OpenNEXTListings.render(copy);
  assert.match(html,/data-exchange-id="SUP-MODEL-LIVE"/);
  assert.doesNotMatch(html,/data-listing-id="model-quote-/);
  assert.match(html,/data-listing-id="hardware-h100"/);
});

test('catalog selection crosses the site-to-terminal URL before authentication',()=>{
  const item={id:'model-quote-gpt-5.6-sol-long',kind:'model',sku:'gpt-5.6-sol-long'};
  const h=routing(item,{authenticated:false,onSite:true});
  assert.equal(h.context.queue(item.id,'buy'),true);
  const target=new URL(h.context.location.href);
  assert.equal(target.origin,'https://terminal.opennextlab.ai');
  assert.equal(target.searchParams.get('listing'),item.id);
  assert.equal(target.searchParams.get('intent'),'buy');
  assert.equal(target.hash,'#terminal/models');
  assert.equal(h.opened.length,0);
  h.context.resume();
  assert.equal(h.opened.length,0,'authentication is still required');
  assert.equal(h.state.pendingListing.id,item.id);
});

test('a supplied model quote resumes its exact pricing tier instead of the first model',()=>{
  const item={id:'model-quote-gpt-5.6-sol-long',kind:'model',sku:'gpt-5.6-sol-long'};
  const h=routing(item);h.context.queue(item.id,'buy');h.context.resume();
  assert.equal(h.navigated[0],'models');
  assert.equal(h.opened[0].type,'model-rfq-form');
  assert.equal(h.opened[0].sku,'gpt-5.6-sol-long');
  assert.equal(h.contacts.length,0);
  assert.equal(h.state.pendingListing,null);
});

test('an unmatched public model reference asks sales about that exact model without substituting a supplier SKU',()=>{
  const item={id:'model-reference-unquoted',kind:'model',name:'Exact referenced model',input:2,output:10,observedAt:'2026-10-13',context:'Specified tier',note:'Confirm availability.'};
  const h=routing(item);h.context.queue(item.id,'buy');h.context.resume();
  assert.equal(h.opened.length,0);
  assert.equal(h.contacts.length,1);
  assert.match(h.contacts[0].message,/Exact referenced model/);
  assert.match(h.contacts[0].message,/2026-10-13/);
  assert.match(h.contacts[0].message,/not an executable offer/);
  assert.match(h.contacts[0].message,/1M tokens/);
});

test('per-GPU hardware catalog inquiries retain variant, minimum quantity and the per-GPU reference price',()=>{
  const item={id:'hardware-h200',kind:'hardware',name:'H200 NVL',model:'H200',memory:'141 GB HBM3e',form:'PCIe Gen 5',minimum:'20 GPUs',price:34500,unit:'GPU',observedAt:'2026-10-13',note:'20-49 GPU price tier; condition to be confirmed.'};
  const h=routing(item);h.context.queue(item.id,'buy');h.context.resume();
  const form=h.opened[0];
  assert.equal(form.type,'rfq-form');
  assert.equal(form.prefill.kind,'physical_gpu');
  assert.equal(form.prefill.model,'H200 NVL');
  assert.equal(form.prefill.count,20);
  assert.equal(form.prefill.budget,34500);
  assert.equal(form.prefill.hours,0);
  assert.equal(form.prefill.condition,'Confirm in supplier quote');
  assert.equal(form.prefill.originSupply,undefined,'reference catalog items are not executable supply records');
  assert.match(form.prefill.notes,/141 GB HBM3e/);
  assert.match(form.prefill.notes,/\$34,500\.00 \/ GPU/);
  assert.match(form.prefill.notes,/2026-10-13/);
});

test('complete system catalog inquiries never reinterpret a server price as a GPU price',()=>{
  const item={id:'hardware-hgx-h100',kind:'hardware',name:'8x HGX H100 server',model:'H100',price:319924,unit:'server',minimum:'1 server',memory:'8 x 80 GB',form:'8U / SXM5',observedAt:'2026-10-13',note:'NVSwitch and dual EPYC.'};
  const h=routing(item);h.context.queue(item.id,'buy');h.context.resume();
  assert.equal(h.opened.length,0);
  assert.equal(h.contacts.length,1);
  assert.match(h.contacts[0].message,/per server, not per GPU/);
  assert.match(h.contacts[0].message,/\$319,924\.00 \/ server/);
  assert.match(h.contacts[0].message,/NVSwitch and dual EPYC/);
  assert.doesNotMatch(h.contacts[0].message,/\$39,990/);
});

test('legacy rental requirements retain their supplier response flow',()=>{
  const item={id:'rental-existing',kind:'rental',model:'H200',count:'160+',region:'Singapore',months:12,price:1.4,note:'Annual cluster.'};
  const h=routing(item);h.context.queue(item.id,'offer');h.context.resume();
  assert.equal(h.navigated[0],'supply');
  assert.equal(h.state.role,'Seller');
  assert.equal(h.opened[0].type,'respond');
  assert.equal(h.opened[0].requirement.count,160);
  assert.equal(h.opened[0].requirement.budget,1.4);
  assert.equal(h.opened[0].requirement.originListingId,item.id);
});

test('catalog references cannot be offered as if they were buyer RFQs',()=>{
  const h=routing({id:'hardware-h100',kind:'hardware'});
  assert.equal(h.context.queue('hardware-h100','offer'),false);
  assert.equal(h.state.pendingListing,null);
});
