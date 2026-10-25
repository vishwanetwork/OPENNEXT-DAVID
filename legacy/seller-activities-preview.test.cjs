const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'OpenNEXT-seller-activities-preview.js'),'utf8');
function load(overrides={}){const context=vm.createContext({Date,Intl,console,OpenNEXTDemo:{active:true},...overrides});vm.runInContext(source,context);return context.OpenNEXTSellerActivities;}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function raw(overrides={}){return {id:'ORDER-TEST',model:'H100 SXM',country:'Singapore',term:'Spot',gpuCount:8,vcpu:192,memory:80,perGpuHourly:2.31,settledAt:new Date(Date.now()-3600000).toISOString(),status:'Completed',...overrides};}
test('normalization excludes quotes, references, invalid nonfinite values and noninteger GPU count',()=>{
 const h=load().testHelpers;
 assert.equal(h.normalizeSettlement(raw(),0).priceCents,231);
 for(const patch of [{status:'Quoted'},{referenceOnly:true},{external:true},{perGpuHourly:Infinity},{gpuCount:Infinity},{gpuCount:1.5},{perGpuHourly:-1},{gpuCount:0},{settledAt:'bad'}])assert.equal(h.normalizeSettlement(raw(patch),0),null,JSON.stringify(patch));
 const normalized=h.normalizeSettlement(raw({provider:'Private Supplier',supplier:'Private Supplier'}),0);assert(!JSON.stringify(normalized).includes('Private Supplier'));
});
test('seven day window includes boundary and excludes older/future rows',()=>{
 const h=load().testHelpers, now=Date.now();
 const rows=[0,1,7*86400000,7*86400000+1,-1000].map((age,i)=>({...h.normalizeSettlement(raw({id:'B'+i}),i),settledAtTime:now-age}));
 assert.deepEqual(Array.from(h.recentWindow(rows,now).map(r=>r.id)),['B0','B1','B2']);
});
test('integer-cent price bands keep every trade and exact GPU totals for all precisions',()=>{
 const h=load().testHelpers;
 const rows=[2.29,2.30,2.31,2.99,3].map((price,i)=>h.normalizeSettlement(raw({id:'P'+i,perGpuHourly:price,gpuCount:i+1}),i));
 const counts={100:2,10:4,1:5};
 for(const step of [100,10,1]){const stats=h.priceBands(rows,step);assert.equal(stats.bands.length,counts[step]);assert.equal(stats.trades,5);assert.equal(stats.totalGpus,15);assert.equal(stats.bands.reduce((a,b)=>a+b.trades,0),5);assert.equal(stats.bands.reduce((a,b)=>a+b.gpus,0),15);assert(Math.abs(stats.bands.reduce((a,b)=>a+b.share,0)-1)<1e-10);}
 assert.equal(h.bandLabel(230,10).range,'$2.30–$2.39');assert.equal(h.bandLabel(200,100).range,'$2.00–$2.99');assert.equal(h.bandLabel(231,1).short,'$2.31');
 assert.throws(()=>h.priceBands(rows,5));
});
test('activity render defaults to 20 while history helpers allow only 20, 50 or 100',()=>{
 const api=load(), ctx={esc,render(){}};
 const rows=Array.from({length:125},(_,i)=>raw({id:'ORD-'+i,settledAt:new Date(Date.now()-i*60000).toISOString()}));
 api.setSettlements(rows);const html=api.render(ctx);
 assert.equal((html.match(/class="onx-sa-activity-row"/g)||[]).length,20);
 assert(html.includes('Showing 20 of 125 in the selected range'));assert(html.includes('ORD-0'));assert(!html.includes('<code>ORD-20</code>'));
 assert(html.includes('class="onx-sa-show-control"'));assert(html.includes('data-sa-show aria-label="Show activities"'));
 assert(html.includes('<option value="20" selected>20</option>'));
 const normalized=rows.map((row,i)=>api.testHelpers.normalizeSettlement(row,i)).filter(Boolean);
 assert.deepEqual(Array.from(api.testHelpers.activityShowOptions),[20,50,100]);
 for(const limit of [20,50,100])assert.equal(api.testHelpers.latestMatching(normalized,limit).length,limit);
 for(const malformed of [0,19,37,101,Infinity,'bad',null])assert.equal(api.testHelpers.latestMatching(normalized,malformed).length,100);
 api.setSettlements([]);const empty=api.render(ctx);assert.equal((empty.match(/class="onx-sa-activity-row"/g)||[]).length,0);
 api.setSettlements(null);assert.equal((api.render(ctx).match(/class="onx-sa-activity-row"/g)||[]).length,20);
});
test('show activities change persists across renders and ignores malformed limits',()=>{
 const listeners={};
 const root={dataset:{},querySelector(){return null;},addEventListener(type,handler){listeners[type]=handler;}};
 const document={querySelector(){return root;},activeElement:null};
 const api=load({document});let renders=0;const ctx={esc,render(){renders+=1;}};
 api.setSettlements(Array.from({length:125},(_,i)=>raw({id:'SHOW-'+i,settledAt:new Date(Date.now()-i*60000).toISOString()})));
 api.bind(ctx);
 const select={dataset:{saShow:''},value:'50',hasAttribute(name){return name==='data-sa-show';}};
 listeners.change({target:select});assert.equal(renders,1);
 let html=api.render(ctx);assert.equal((html.match(/class="onx-sa-activity-row"/g)||[]).length,50);assert(html.includes('<option value="50" selected>50</option>'));
 select.value='37';listeners.change({target:select});assert.equal(select.value,'50');assert.equal(renders,1);
 html=api.render(ctx);assert.equal((html.match(/class="onx-sa-activity-row"/g)||[]).length,50);
});
test('render escapes incoming text and never exposes supplier identity',()=>{
 const api=load();api.setSettlements([raw({id:'<script>alert(1)</script>',model:'<img src=x>',country:'<b>SG</b>',provider:'Private Provider'})]);
 const html=api.render({esc,render(){}});assert(!html.includes('<script>alert'));assert(html.includes('&lt;img src=x&gt;'));assert(!html.includes('Private Provider'));assert(!html.includes('data-sa-group="price"'));
});

test('default insight renders all three controls and removes retired display copy',()=>{
 const html=load().render({esc,render(){}});
 assert(html.includes('<h1>Market Insight</h1>'));
 assert(html.includes('data-visible-count="3"'));
 assert(html.includes('onx-sa-panels has-index'));
 for(const panel of ['index','analytics','activities'])assert(html.includes('data-sa-panel="'+panel+'" aria-pressed="true"'));
 for(const range of ['24H','3D','7D','1M','3M','6M','1Y','ALL'])assert(html.includes('data-sa-range="'+range+'"'));
 for(const retired of ['GPU CAPACITY MARKET','PAST 7 DAYS','Executed price concentration.','SETTLED TRANSACTIONS','Analytics use completed trades only','matching completed settlements'])assert(!html.includes(retired));
});
