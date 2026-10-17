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
  if(rows)context.window.OpenNEXTExchange={listPublic:(kind,side)=>rows.filter(row=>row.kind===kind&&row.side===side),get:id=>rows.find(row=>row.id===id)};
  context.window.openNEXTPreviewTicker=()=>'<section class="ticker">Market ticker</section>';
  for(const file of ['OpenNEXT-model-quotes.js','OpenNEXT-home-listings.js','OpenNEXT-original-homepage.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
  return context.window;
}
const copy={rental:'GPU rental',models:'Model capacity',physical:'Physical GPUs'};
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
  for(const card of html.matchAll(/<article\b[\s\S]*?<\/article>/g)){
    assert.equal((card[0].match(/data-public-action="open-workspace"/g)||[]).length,1);
    assert.match(card[0],/<span>Buy capacity<\/span>/);
    assert.doesNotMatch(card[0],/<span>Offer capacity<\/span>/);
  }
  assert.match(html,/\$0\.51/);
  assert.match(html,/\$3\.06/);
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

test('an empty exchange never silently substitutes externally observed inventory',()=>{
  const api=setup([]).OpenNEXTListings,html=api.render(copy);
  assert.equal((html.match(/<article /g)||[]).length,0);
  assert.match(html,/No published offers in this market yet/);
  assert.match(html,/No listings/);
  assert.doesNotMatch(html,/data-listing-id="rental-|data-listing-id="hardware-/);
});

test('fallback source targets stay demand, with no duplicate buy button',()=>{
  const api=setup().OpenNEXTListings;
  api.selectSide('demand');
  const html=api.render(copy);
  assert.match(html,/Buyer target price/);
  assert.doesNotMatch(html,/data-listing-intent="buy"/);
  assert.equal((html.match(/data-listing-intent="offer"/g)||[]).length,14);
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
  const html=api.render(copy),card=html.match(/<article\b[\s\S]*?<\/article>/)[0];
  assert.match(card,/Supplier offer/);
  assert.doesNotMatch(card,/on-listing-sample|>Preview<|on-listing-urgency/);
  assert.match(html,/Preview marketplace · /);
  assert.equal(api.get('SUP-100').sample,true);
});

test('buyer RFQs only show a normalized High Urgency badge for high-priority requirements',()=>{
  const priorities=['High urgency','HIGH URGENCY','High','Urgent','Medium urgency','Standard','Ordinary','Low urgency','',null];
  const api=setup(priorities.map((urgency,index)=>({...sourceRows[1],id:'RFQ-LABEL-'+index,urgency}))).OpenNEXTListings;
  api.selectSide('demand');
  const html=api.render(copy),cards=[...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(match=>match[0]);
  assert.equal(cards.length,priorities.length);
  cards.forEach((card,index)=>{
    assert.match(card,/Buyer RFQ/);
    if(index<4)assert.match(card,/<span class="on-listing-urgency">High Urgency<\/span>/);
    else assert.doesNotMatch(card,/on-listing-urgency|on-listing-sample|>Preview</);
  });
  assert.match(html,/Preview marketplace · /);
});

test('fallback medium-urgency buyer targets have no urgency badge and retain reference metadata',()=>{
  const api=setup().OpenNEXTListings;api.selectSide('demand');
  const html=api.render(copy);
  assert.match(html,/Buyer target price/);
  assert.doesNotMatch(html,/on-listing-urgency/);
  assert.match(api.groups[0][0].sourceUrl,/packet\.ai\/demand/);
  assert.equal(api.groups[0][0].urgency,'Medium urgency');
});
