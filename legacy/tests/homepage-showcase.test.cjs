'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const copy={rental:'GPU rental',models:'Model capacity',physical:'Physical GPUs'};
const supply=Array.from({length:6},(_,i)=>({id:'SUP-DEMO-'+i,kind:'rental',model:['H100','H200','B200','A100 80GB','L40S','RTX 4090'][i],title:'GPU capacity '+i,region:'Singapore',price:2+i/10,count:8,hours:168,description:'Dedicated GPU capacity.'}));
const rfqs=supply.map((row,i)=>({...row,id:'RFQ-DEMO-'+i,price:3+i/10,title:'GPU requirement '+i,urgency:i===0?'High urgency':'Standard'}));
const payload={demo:true,rfqs,supplies:supply,featured:{rfqs,supplies:supply}};
function panel(html,index=0){
  const marker='<div class="public-listing-panel public-listing-panel-';
  const start=html.indexOf(marker+index+'"');
  assert.ok(start>=0,`market panel ${index} must exist`);
  const next=html.indexOf(marker,start+marker.length);
  return html.slice(start,next>=0?next:html.indexOf('<div class="on-listing-under">',start));
}
const cardsIn=html=>[...html.matchAll(/<article\b[\s\S]*?<\/article>/g)].map(match=>match[0]);

function setup({host='opennextlab.ai',real={rfqs:[],supplies:[]},response=payload,ok=true,reject=false}={}){
  const requests=[];
  const exchange={featured:()=>real,listPublic:()=>[],get:()=>null};
  const context={
    window:{location:{hostname:host},OpenNEXTExchange:exchange},
    document:{getElementById:()=>({})},
    matchMedia:()=>({matches:false,addEventListener(){}}),
    MutationObserver:class{observe(){}},
    fetch:async(url,options)=>{requests.push({url,options});if(reject)throw Error('Unavailable');return{ok,json:async()=>response};},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','OpenNEXT-home-listings.js'),'utf8'),context);
  return{api:context.window.OpenNEXTListings,exchange,requests,real};
}

test('homepage restores isolated supply and RFQ cards with exact demo deep links',async()=>{
  const {api,requests,real}=setup();
  assert.match(api.render(copy),/No published offers/);
  await api.loadShowcase();
  let html=api.render(copy);
  assert.equal(cardsIn(panel(html)).length,6);
  assert.match(html,/01 — 05 \/ 6/);
  assert.match(html,/GPU rental<\/label>/);
  assert.doesNotMatch(html,/Demo marketplace · Test data · No real transactions/);
  assert.match(html,/href="https:\/\/terminal\.opennextlab\.ai\/demo\/\?role=buyer&amp;opportunity=SUP-DEMO-0&amp;intent=buy#terminal\/market"/);
  const cards=cardsIn(panel(html));
  cards.forEach(card=>{assert.match(card,/Supplier offer/);assert.match(card,/<span>Buy capacity<\/span>/);assert.doesNotMatch(card,/data-public-action|data-exchange-id|on-listing-sample|Preview/);});
  assert.equal(api.get('SUP-DEMO-0').demo,true);
  assert.equal(api.get('SUP-DEMO-0').price,2);
  api.selectSide('demand');
  html=api.render(copy);
  assert.equal(cardsIn(panel(html)).length,6);
  assert.match(html,/role=seller&amp;opportunity=RFQ-DEMO-0&amp;intent=offer/);
  assert.match(html,/<span>Offer capacity<\/span>/);
  assert.equal((html.match(/class="on-listing-urgency"/g)||[]).length,1);
  assert.equal(api.get('RFQ-DEMO-0').price,3);
  assert.deepEqual(real,{rfqs:[],supplies:[]});
  await api.loadShowcase();
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'/api/demo/showcase');
  assert.equal(requests[0].options.credentials,'omit');
});

test('approved production rows supersede showcase lane without mixing data or changing real actions',async()=>{
  const real={rfqs:[],supplies:[]};
  const {api}=setup({real});
  await api.loadShowcase();
  real.supplies=[{...supply[0],id:'SUP-APPROVED',sample:false}];
  let html=api.render(copy);
  assert.match(html,/data-exchange-id="SUP-APPROVED"/);
  assert.match(html,/data-public-action="open-workspace"/);
  assert.doesNotMatch(html,/SUP-DEMO-|Demo marketplace/);
  api.selectSide('demand');
  html=api.render(copy);
  assert.match(html,/RFQ-DEMO-0/);
  assert.doesNotMatch(html,/Demo marketplace/);
});

test('fully populated approved lanes need no showcase fetch',async()=>{
  const {api,requests}=setup({real:{rfqs:[{...rfqs[0],id:'RFQ-APPROVED'}],supplies:[{...supply[0],id:'SUP-APPROVED'}]}});
  await api.loadShowcase();
  assert.equal(requests.length,0);
  assert.match(api.render(copy),/SUP-APPROVED/);
});

test('disabled, failed or unmarked showcase response retains honest empty state',async()=>{
  for(const config of [{ok:false},{reject:true},{response:{...payload,demo:false}},{response:{demo:true}}]){
    const {api}=setup(config);
    await api.loadShowcase();
    const html=api.render(copy);
    assert.match(html,/No published offers/);
    assert.equal(cardsIn(panel(html)).length,0);
    assert.doesNotMatch(panel(html),/data-listing-id="rental-|Supplier offer|data-showcase-opportunity/);
    for(const index of [1,2]){
      const catalog=panel(html,index);
      assert.ok(cardsIn(catalog).length>=5,'dated reference catalogs remain available independently');
      assert.doesNotMatch(catalog,/data-showcase-opportunity|data-exchange-id/);
      assert.match(catalog,/Reference/);
    }
  }
});

test('local previews use the same-origin demo route and escape showcase content',async()=>{
  const unsafe={...supply[0],id:'SUP-<unsafe>',title:'<script>bad</script>'};
  const {api}=setup({host:'127.0.0.1',response:{demo:true,featured:{rfqs:[],supplies:[unsafe,{id:'INVALID',model:'Unknown',kind:'model'}]}}});
  await api.loadShowcase();
  const html=api.render(copy);
  assert.match(html,/href="\/demo\/\?role=buyer&amp;opportunity=SUP-%3Cunsafe%3E&amp;intent=buy/);
  assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>|INVALID/);
  assert.equal(cardsIn(panel(html)).length,1);
});
