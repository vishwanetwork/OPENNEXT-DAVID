'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(rows = null) {
  const context = {
    window: {}, document:{getElementById:()=>({})},
    matchMedia:()=>({matches:false,addEventListener(){}}),
    MutationObserver:class {observe(){}},
  };
  if(rows)context.window.OpenNEXTExchange={
    featured:()=>({rfqs:rows.filter(row=>row.kind==='rental'&&row.side==='demand'),supplies:rows.filter(row=>row.kind==='rental'&&row.side==='supply')}),
    listPublic:(kind,side)=>rows.filter(row=>row.kind===kind&&row.side===side),get:id=>rows.find(row=>row.id===id)
  };
  context.window.openNEXTPreviewTicker=()=>'<section class="ticker">Market ticker</section>';
  for(const file of ['OpenNEXT-model-quotes.js','OpenNEXT-home-listings.js','OpenNEXT-original-homepage.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  return context.window;
}
const copy={rental:'GPU rental',models:'Model capacity',physical:'Physical GPUs'};
function panel(html,index=0){
  const marker='<div class="public-listing-panel public-listing-panel-';
  const start=html.indexOf(marker+index+'"');
  assert.ok(start>=0,`market panel ${index} must exist`);
  const next=html.indexOf(marker,start+marker.length);
  return html.slice(start,next>=0?next:html.indexOf('<div class="on-listing-under">',start));
}
const cardsIn=html=>[...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(match=>match[0]);
const sourceRows=[
  {id:'SUP-100',kind:'rental',side:'supply',model:'H100 SXM',title:'H100 production cluster',region:'Singapore',price:1.8,count:8,hours:48,description:'InfiniBand available.',sample:true},
  {id:'RFQ-100',kind:'rental',side:'demand',model:'H100 SXM',title:'Urgent H100 capacity',region:'US East',price:3,count:16,hours:72,urgency:'Urgent',description:'Training starts tomorrow.',sample:true},
  {id:'SUP-MODEL',kind:'model',side:'supply',model:'GPT',title:'GPT capacity',region:'US',price:.51,outputPrice:3.06,count:1000000,term:'30 days'},
  {id:'SUP-GPU',kind:'hardware',side:'supply',model:'H200',title:'H200 NVL',region:'Singapore',price:34000,count:4,term:'Ships in 7 days'},
];

test('homepage keeps brand/artwork, moves audience band before listings and removes numbered chapter headers',()=>{
  const win=setup(sourceRows),html=win.renderOriginalLanding();
  assert.ok(html.indexOf('id="suppliers"')<html.indexOf('id="public-listings-title"'));
  assert.match(html,/OpenNEXT GCI Index Factory/);
  assert.match(html,/public-flow-drawing/);
  assert.doesNotMatch(html,/class="on-eyebrow">0[1-6] \/|public-posting-steps|public-preview-actions|public-row-number|public-process-number/);
  const header=html.match(/<header[\s\S]*?<\/header>/)[0];
  assert.equal((header.match(/<button /g)||[]).length,2);
  assert.match(header,/data-act="contact-us"/);
  assert.match(header,/data-target="gpus">Open Terminal/);
  assert.match(html,/Coming next/);
  assert.match(html,/<span class="public-capability-status">Live<\/span>/);
  assert.doesNotMatch(html,/>In the Terminal<\/span>/);
  assert.match(html,/Price outlooks and an Agent Wallet are planned/);
  assert.doesNotMatch(html,/[\u3400-\u9fff]/);
});

test('buyer lane displays only supply and routes the exact offer into the workspace',()=>{
  const api=setup(sourceRows).OpenNEXTListings,html=api.render(copy);
  assert.match(html,/id="public-listings-0" checked><label[^>]*>GPU rental<\/label>/);
  assert.match(html,/data-listing-side-filter="supply" aria-pressed="true"/);
  assert.match(html,/data-exchange-id="SUP-100" data-exchange-intent="buy"/);
  assert.doesNotMatch(html,/data-listing-id="RFQ-100"/);
  const rentalCards=cardsIn(panel(html));
  assert.equal(rentalCards.length,1);
  for(const card of rentalCards){
    assert.equal((card.match(/data-public-action="open-workspace"/g)||[]).length,1);
    assert.match(card,/<span>Buy capacity<\/span>/);
    assert.doesNotMatch(card,/<span>Offer capacity<\/span>/);
  }
  assert.equal(cardsIn(panel(html,1)).length,1,'published model offers supersede model references');
  assert.equal(cardsIn(panel(html,2)).length,1,'published hardware offers supersede hardware references');
  assert.match(panel(html,1),/\$0\.51/);
  assert.match(panel(html,1),/\$3\.06/);
  assert.doesNotMatch(panel(html,1),/data-listing-id="model-/);
  assert.doesNotMatch(panel(html,2),/data-listing-id="hardware-/);
  assert.match(html,/Preview marketplace/);
});

test('supplier lane displays buyer requirements only and retains the exact RFQ identity',()=>{
  const api=setup(sourceRows).OpenNEXTListings;
  api.selectSide('demand');
  const html=api.render(copy);
  assert.match(html,/data-exchange-id="RFQ-100" data-exchange-intent="offer"/);
  assert.match(html,/<span>Offer capacity<\/span>/);
  assert.doesNotMatch(html,/data-listing-id="SUP-100"|data-exchange-intent="buy"/);
  assert.match(html,/No open requirements in this market yet/);
  assert.equal(api.get('RFQ-100').model,'H100 SXM');
});

test('empty rental exchange stays empty while dated model and hardware catalogs remain available',()=>{
  const api=setup([]).OpenNEXTListings,html=api.render(copy);
  assert.equal(cardsIn(panel(html)).length,0);
  assert.match(panel(html),/No published offers in this market yet/);
  assert.match(html,/No listings/);
  assert.doesNotMatch(panel(html),/data-listing-id="rental-|Buyer target price|Supplier offer/);
  for(const index of [1,2]){
    const catalog=panel(html,index),cards=cardsIn(catalog);
    assert.ok(cards.length>=5,'each reference catalog has enough entries to rotate');
    assert.match(catalog,/Reference/);
    assert.doesNotMatch(catalog,/data-exchange-id|data-showcase-opportunity|Supplier asking price/);
    assert.equal(cards.length,api.groups[index].length);
    for(const item of api.groups[index]){
      assert.match(item.observedAt,/^\d{4}-\d{2}-\d{2}$/);
      assert.equal(item.kind,index===1?'model':'hardware');
      assert.notEqual(item.priceKind,'buyer_target');
      assert.notEqual(item.priceKind,'seller_ask');
    }
  }
});

test('missing marketplace service does not present external rental targets as live RFQs',()=>{
  const api=setup().OpenNEXTListings;
  api.selectSide('demand');
  const html=api.render(copy);
  assert.match(html,/No open requirements in this market yet/);
  assert.doesNotMatch(html,/data-listing-intent="buy"/);
  assert.equal((html.match(/data-listing-intent="offer"/g)||[]).length,0);
  assert.doesNotMatch(html,/Buyer target price|data-listing-id="rental-/);
  api.selectSide('supply');
  const supply=api.render(copy);
  assert.match(supply,/Official reference/);
  assert.doesNotMatch(supply,/data-listing-id="rental-/);
});

test('exchange strings are escaped before public rendering',()=>{
  const win=setup([{...sourceRows[0],id:'<bad>',title:'<img src=x onerror=alert(1)>',description:'<script>alert(1)</script>'}]);
  const html=win.OpenNEXTListings.render(copy);
  assert.match(html,/&lt;img/);
  assert.match(html,/data-exchange-id="&lt;bad&gt;"/);
  assert.doesNotMatch(html,/<script>|<img src=x/);
});

test('supplier offer cards omit the Preview badge but retain marketplace provenance',()=>{
  const api=setup([{...sourceRows[0],urgency:'High urgency',sample:true}]).OpenNEXTListings;
  const html=api.render(copy),card=cardsIn(panel(html))[0];
  assert.match(card,/Supplier offer/);
  assert.doesNotMatch(card,/on-listing-sample|>Preview<|on-listing-urgency/);
  assert.match(html,/Preview marketplace · /);
  assert.equal(api.get('SUP-100').sample,true);
});

test('buyer RFQs only show a normalized High Urgency badge for high-priority requirements',()=>{
  const priorities=['High urgency','HIGH URGENCY','High','Urgent','Medium urgency','Standard','Ordinary','Low urgency','',null];
  const api=setup(priorities.map((urgency,index)=>({...sourceRows[1],id:'RFQ-LABEL-'+index,urgency}))).OpenNEXTListings;
  api.selectSide('demand');
  const html=api.render(copy),cards=cardsIn(panel(html));
  assert.equal(cards.length,priorities.length);
  cards.forEach((card,index)=>{
    assert.match(card,/Buyer RFQ/);
    if(index<4)assert.match(card,/<span class="on-listing-urgency">High Urgency<\/span>/);
    else assert.doesNotMatch(card,/on-listing-urgency|on-listing-sample|>Preview</);
  });
  assert.match(html,/Preview marketplace · /);
});

test('unavailable exchange cannot promote archived external demand into homepage inventory',()=>{
  const api=setup().OpenNEXTListings;api.selectSide('demand');
  const html=api.render(copy);
  assert.match(html,/No listings/);
  assert.equal(cardsIn(panel(html)).length,0);
  assert.doesNotMatch(html,/Buyer target price|Buyer RFQ|data-listing-id="rental-/);
  assert.doesNotMatch(html,/on-listing-urgency/);
  assert.match(api.groups[0][0].sourceUrl,/packet\.ai\/demand/);
  assert.equal(api.groups[0][0].urgency,'Medium urgency');
});

test('rental homepage displays only the featured backend result, not every public listing',()=>{
  const win=setup(sourceRows),featuredSupply={...sourceRows[0],id:'SUP-LOWEST',price:1.89,sample:false},featuredRfq={...sourceRows[1],id:'RFQ-HIGHEST',price:4.50,sample:false};
  const rawSupply={...featuredSupply,id:'SUP-NOT-FEATURED',price:2.20};
  const rawRfq={...featuredRfq,id:'RFQ-NOT-FEATURED',price:3.20};
  win.OpenNEXTExchange.featured=()=>({supplies:[featuredSupply],rfqs:[featuredRfq]});
  win.OpenNEXTExchange.listPublic=(kind,side)=>kind==='rental'?(side==='supply'?[rawSupply]:[rawRfq]):[];
  const supply=win.OpenNEXTListings.render(copy);
  assert.match(supply,/data-exchange-id="SUP-LOWEST"/);
  assert.match(supply,/\$1\.89/);
  assert.doesNotMatch(supply,/SUP-NOT-FEATURED|RFQ-HIGHEST|Preview marketplace/);
  win.OpenNEXTListings.selectSide('demand');
  const demand=win.OpenNEXTListings.render(copy);
  assert.match(demand,/data-exchange-id="RFQ-HIGHEST"/);
  assert.match(demand,/\$4\.50/);
  assert.doesNotMatch(demand,/RFQ-NOT-FEATURED|SUP-LOWEST/);
});
