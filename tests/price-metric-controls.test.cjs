'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','OpenNEXT-terminal.js'),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const normalizeCode=extract('  function normalizeMetrics(', '  stored.priceMetrics=');
const labels={min:'Lowest price',avg:'Average price',max:'Highest price'};

function fixture(selected=['avg']){
  const S={priceMetrics:[...selected],priceMetric:selected.includes('avg')?'avg':selected[0],menu:'priceMetric',hiddenSeries:[1]},events={},messages=[],focused=[];
  let renders=0,persists=0;
  const context={S,metricLabels:labels,esc:String,filterValues:{priceMetric:()=>[['max','Highest price'],['avg','Average price'],['min','Lowest price']]},document:{addEventListener:(type,handler)=>{events[type]=handler;},querySelector:selector=>({focus:()=>focused.push(selector)})},toast:message=>messages.push(message),render:()=>renders++,persist:()=>persists++};
  vm.runInNewContext(normalizeCode+extract('  function metricMenu(){','  function filterMenu(')+extract("  document.addEventListener('change',", "  document.addEventListener('input',e=>{if(['inputMillion'"),context);
  const toggle=(metric,checked)=>{const target={dataset:{priceMetric:metric},checked};events.change({target});return target;};
  return {S,context,toggle,messages,focused,get renders(){return renders;},get persists(){return persists;}};
}

test('price metrics normalize legacy preferences, remove invalid entries and retain any nonempty combination',()=>{
  const f=fixture();
  for(const metric of ['max','avg','min'])assert.equal(JSON.stringify(f.context.normalizeMetrics(undefined,metric)),JSON.stringify([metric]));
  for(const selected of [['max','avg'],['avg','min'],['min','max'],['max','avg','min']]){
    assert.equal(JSON.stringify(f.context.normalizeMetrics(selected)),JSON.stringify(['max','avg','min'].filter(value=>selected.includes(value))));
  }
  assert.equal(JSON.stringify(f.context.normalizeMetrics(['invalid','avg','avg'])),JSON.stringify(['avg']));
  assert.equal(JSON.stringify(f.context.normalizeMetrics([],null)),JSON.stringify(['avg']));
  assert.ok(source.includes("'priceMetrics'].filter"));
  assert.ok(source.includes('priceMetrics:S.priceMetrics'));
});

test('checkbox selection redraws and persists without dismissing the menu, and supports returning to a single metric',()=>{
  const f=fixture();
  f.toggle('max',true);f.toggle('min',true);
  assert.equal(JSON.stringify(f.S.priceMetrics),JSON.stringify(['max','avg','min']));
  assert.equal(f.S.priceMetric,'avg');assert.equal(f.S.menu,'priceMetric');
  f.toggle('avg',false);f.toggle('max',false);
  assert.equal(JSON.stringify(f.S.priceMetrics),JSON.stringify(['min']));assert.equal(f.S.priceMetric,'min');
  assert.equal(f.renders,4);assert.equal(f.persists,4);assert.equal(f.focused.at(-1),'[data-price-metric="max"]');
  assert.equal(f.S.hiddenSeries.length,0);
  const last=f.toggle('min',false);
  assert.equal(last.checked,true);assert.equal(f.S.priceMetrics[0],'min');assert.equal(f.renders,4);
  assert.equal(f.messages.at(-1),'Keep at least one price metric selected.');
});

test('metric controls provide native checkbox names, instructions, a Done button and distinct line keys',()=>{
  const f=fixture(['max','min']),html=f.context.metricMenu();
  assert.equal((html.match(/type="checkbox"/g)||[]).length,3);
  assert.equal((html.match(/\schecked/g)||[]).length,2);
  for(const metric of ['max','avg','min']){
    assert.ok(html.includes('data-price-metric="'+metric+'"'));
    assert.ok(html.includes(labels[metric]));assert.ok(html.includes('metric-line-'+metric));
  }
  assert.match(html,/aria-describedby="metric-selection-note"/);
  assert.match(html,/data-act="metrics-done"/);
});

test('chart periods include the expanded free window and gate only 6M, 1Y and ALL',()=>{
  const context={calls:[],S:{period:'3D'},open:type=>context.calls.push(type),render:()=>context.calls.push('render')};
  const branch=extract("    case 'period':", "    case 'history-contact':");
  vm.runInNewContext('function selectPeriod(value){switch("period"){'+branch+'}}',context);
  for(const value of ['1D','3D','1W','1M','3M']){context.selectPeriod(value);assert.equal(context.S.period,value);assert.equal(context.calls.at(-1),'render');}
  for(const value of ['6M','1Y','ALL']){context.selectPeriod(value);assert.equal(context.S.period,'3M');assert.equal(context.calls.at(-1),'history-access');}
  assert.ok(source.includes("['1D','3D','1W','1M','3M','6M','1Y','ALL']"));
  assert.ok(!source.includes('Free historical data is limited to 3 days'));
});
