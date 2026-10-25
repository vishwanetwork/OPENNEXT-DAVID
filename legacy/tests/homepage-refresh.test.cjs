'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const terminal=read('OpenNEXT-terminal.js'),homepage=read('OpenNEXT-original-homepage.js'),listings=read('OpenNEXT-home-listings.js');
const escaped=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderHomepage(){
  const window={location:{hostname:'opennextlab.ai'},openNEXTPreviewTicker:()=>'<div data-test-ticker></div>',addEventListener(){}};
  const sandbox={window,document:{getElementById:()=>({})},matchMedia:()=>({matches:false,addEventListener(){}}),MutationObserver:class{observe(){}},Intl,Date,console};
  vm.runInNewContext(listings,sandbox);vm.runInNewContext(homepage,sandbox);return window.renderOriginalLanding('en');
}
function ticker(rows){
  const start=terminal.indexOf('  function ticker(){'),end=terminal.indexOf('  function paintTicker(');assert.ok(start>0&&end>start);
  const body=terminal.slice(start,end);
  return vm.runInNewContext('(()=>{'+body+';return ticker();})()', {D:{tickerRows:()=>rows},tickerIndex:0,tickerManual:false,esc:escaped,money:value=>Number.isFinite(value)?'$'+value.toFixed(2):'—',Intl,Date});
}
function fieldTags(html){return [...html.matchAll(/<(strong|span)\b[^>]*data-ticker-field="([^"]+)"[^>]*>(.*?)<\/\1>/g)].map(m=>({field:m[2],value:m[3]}));}
const points=[{date:'2026-10-18',value:2},{date:'2026-10-19',value:2.1},{date:'2026-10-20',value:null},{date:'2026-10-21',value:2.2},{date:'2026-10-24',value:2.4}];
const recorded={gpuModel:'H100',country:'Singapore',vcpu:192,gpuMemoryGb:80,perGpuHourly:2.4,term:'Spot',provider:'AWS',region:'ap-southeast-1',instanceType:'p5.48xlarge',gpuCount:8,observedAt:'2026-10-24',historical:true,points};
test('homepage has the exact new eyebrow and removes the old animation caption and redundant copy',()=>{
  const html=renderHomepage();assert.match(html,/<p class="on-eyebrow">THE AI CAPACITY MARKET - FROM SUPPLY TO WORKLOAD<\/p>/);
  const hero=html.match(/<section class="public-hero public-container">([\s\S]*?)<\/section>/)[1];
  assert.match(hero,/public-hero-visual/);assert.match(hero,/<animateMotion/);assert.doesNotMatch(hero,/<figcaption|public-flow-caption|public-flow-toggle|From supply to workload\./);
  assert.doesNotMatch(html,/Buy, sell or broker capacity from one workspace\.|One workspace\.\s*(?:<br>)?\s*Both sides of the market\./);
});
test('Find capacity and List capacity carry Buyer/Seller intent without adding a role to generic Open Terminal',()=>{
  const html=renderHomepage();const buttons=[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(m=>({attrs:m[1],label:m[2].replace(/<[^>]*>/g,'')}));
  const find=buttons.find(b=>b.label==='Find capacity'),list=buttons.find(b=>b.label==='List capacity');
  assert.ok(find);assert.ok(list);assert.match(find.attrs,/data-target="gpus"/);assert.match(find.attrs,/data-preferred-role="buyer"/);assert.match(list.attrs,/data-target="supply"/);assert.match(list.attrs,/data-preferred-role="seller"/);
  const generic=buttons.filter(b=>b.label==='Open Terminal');assert.ok(generic.length>=1);generic.forEach(b=>assert.doesNotMatch(b.attrs,/data-preferred-role/));
  assert.match(terminal,/openPublicWorkspace\(pub\.dataset\.target,pub\.dataset\.preferredRole\)/);
  const helper=terminal.slice(terminal.indexOf('  function preferPublicRole('),terminal.indexOf('  function resumeMarketOpportunity('));assert.match(helper,/!S\.user\?\.onboardingCompleted/);assert.match(helper,/setPreferredRole/);assert.doesNotMatch(helper,/switchRole|\/api\/auth\/role/);
});
test('supply and demand selectors remain a centered two-button group without side copy',()=>{
  const html=renderHomepage(),group=html.match(/<div class="on-listing-sides">([\s\S]*?)<\/div><\/div>/)[1];
  assert.match(group,/role="group" aria-label="Choose your side of the market"/);assert.equal((group.match(/data-listing-side-filter=/g)||[]).length,2);assert.match(group,/data-listing-side-filter="supply"/);assert.match(group,/data-listing-side-filter="demand"/);assert.doesNotMatch(group,/<p\b/);
  const css=read('OpenNEXT-home-listings.css'),rule=css.match(/\.public-page \.on-listing-sides\{([^}]+)\}/)[1];assert.match(rule,/display:flex/);assert.match(rule,/justify-content:center/);
});
test('ticker shows exactly six requested fields in order with a dated seven-day history and no old footer',()=>{
  const html=ticker([recorded]),fields=fieldTags(html);
  assert.deepEqual(fields.map(f=>f.field),['country','model','vcpu','memory','price','term']);
  assert.deepEqual(fields.map(f=>f.value),['Singapore','H100','192 vCPU','80 GB','$2.40 / GPU-hour','Spot']);
  assert.match(html,/>7D history<\/span>/);assert.match(html,/Oct 18, 2026/);assert.match(html,/Oct 24, 2026/);assert.match(html,/\+20\.00%/);
  assert.doesNotMatch(html,/ticker-foot|Daily reference|Daily Spot avg|Source quote|As of |AWS|p5\.48xlarge|ap-southeast-1/);
  assert.match(read('OpenNEXT-market-data.js'),/fetch\('\/api\/pricing\/ticker\?period=1W'/);
});
test('ticker history never bridges explicit missing observations or unrecorded calendar gaps',()=>{
  const html=ticker([recorded]),line=html.match(/class="ticker-price-line" d="([^"]+)"/)[1];assert.equal((line.match(/M/g)||[]).length,3);assert.equal((line.match(/L/g)||[]).length,1);assert.doesNotMatch(html,/NaN|Infinity/);
  const empty=ticker([{...recorded,points:[],vcpu:null,gpuMemoryGb:null,country:null}]);assert.doesNotMatch(empty,/ticker-price-line|192 vCPU|80 GB|\+0\.00%/);assert.deepEqual(fieldTags(empty).slice(0,4).map(f=>f.value),['—','H100','— vCPU','— GB']);
});
test('ticker values escape external labels and use true recorded hardware metadata only',()=>{
  const html=ticker([{...recorded,country:'<img src=x>',gpuModel:'<script>bad</script>',vcpu:'192',gpuMemoryGb:'80'}]);assert.doesNotMatch(html,/<img|<script|192 vCPU|80 GB/);assert.match(html,/&lt;img src=x&gt;/);assert.deepEqual(fieldTags(html).slice(2,4).map(f=>f.value),['— vCPU','— GB']);
});
