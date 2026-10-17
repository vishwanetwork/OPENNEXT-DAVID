'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../OpenNEXT-capacity-chart.js'),'utf8');

async function renderChart(term,data){
  const listeners={},attrs={},metrics=Object.fromEntries(['marketPriceLabel','marketPrice','historyPrimaryCaption','marketRecords','marketChange'].map(id=>[id,{textContent:'',className:''}]));
  const cross={setAttribute:(key,value)=>{attrs[key]=value;}};
  const hit={addEventListener:(name,handler)=>{listeners[name]=handler;},setAttribute:(key,value)=>{attrs[key]=value;}};
  const tip={innerHTML:'',hidden:true,style:{}};
  const svg={dataset:{plotWidth:'900'},getBoundingClientRect:()=>({left:0,width:900}),querySelector:selector=>selector==='.capacity-crosshair'?cross:null};
  const target={innerHTML:'',isConnected:true,clientWidth:940,contains:()=>false,querySelector:selector=>({'svg':svg,'.capacity-hit':hit,'.capacity-tooltip':tip}[selector]||null)};
  const document={hidden:false,activeElement:null,getElementById:id=>id==='capacityHistory'?target:metrics[id]||null};
  const requests=[],timers=[];
  const window={ONMarket:{modelOf:()=>({canonical:'H100'}),regionCode:value=>value,regionLabel:value=>value}};
  const context={window,document,URLSearchParams,AbortSignal,console,setTimeout:(fn,ms)=>{timers.push(ms);return timers.length;},clearTimeout:()=>{},fetch:async url=>{requests.push(url);return {ok:true,json:async()=>data};}};
  vm.runInNewContext(code,context,{filename:'OpenNEXT-capacity-chart.js'});
  window.OpenNEXTHistory.bind({model:'H100',count:8,region:'US East',period:'1M',term});
  await new Promise(resolve=>setImmediate(resolve));
  return {metrics,target,tip,listeners,requests,timers,window};
}
const history={
  latest:{Spot:{value:2.3456},'On-demand':{value:4.5678},Reserved:{value:3.4567}},
  points:[
    {time:'2026-10-16T08:00:00Z',values:{Spot:{value:2.3456},'On-demand':{value:4.5678},Reserved:{value:3.4567}}},
    {time:'2026-10-16T10:00:00Z',values:{Spot:{value:2.4},'On-demand':{value:4.6},Reserved:{value:3.5}}}
  ],meta:{bucketMinutes:120,lastSync:'2026-10-16T10:00:00Z',reference:{gpuCount:8,gpuMemoryGb:80,formFactor:'SXM',area:'US East'},matchingOfferings:2}
};

test('selected market term controls heading, line and recorded table with two-decimal prices',async()=>{
  for(const [term,price] of [['Spot','$2.35'],['On-demand','$4.57'],['Reserved','$3.46']]){
    const chart=await renderChart(term,history);
    assert.equal(chart.metrics.marketPriceLabel.textContent,term.toUpperCase()+' / GPU-HR');
    assert.equal(chart.metrics.marketPrice.textContent,price);
    assert.ok(chart.target.innerHTML.includes('data-capacity-line="'+term+'"'));
    assert.equal((chart.target.innerHTML.match(/data-capacity-line=/g)||[]).length,1);
    assert.ok(chart.target.innerHTML.includes(price));
    assert.equal(chart.requests.length,1);
    assert.equal(chart.timers.at(-1),30000);
  }
});

test('missing Reserved price remains missing and never uses the Spot quote',async()=>{
  const noReserved={...history,latest:{Spot:{value:2.3456}},points:history.points.map(point=>({...point,values:{Spot:point.values.Spot}}))};
  const chart=await renderChart('Reserved',noReserved);
  assert.equal(chart.metrics.marketPriceLabel.textContent,'RESERVED / GPU-HR');
  assert.equal(chart.metrics.marketPrice.textContent,'—');
  assert.equal(chart.metrics.marketRecords.textContent,'0');
  assert.ok(chart.target.innerHTML.includes('No Reserved prices for this configuration yet'));
  assert.ok(!chart.target.innerHTML.includes('$2.35'));
});

test('tooltip has the selected-term price first in bold and time last',async()=>{
  const chart=await renderChart('On-demand',history);
  chart.listeners.focus();
  assert.match(chart.tip.innerHTML,/^<div class="capacity-tip-row"><b>\$4\.60<\/b><span>On-demand<\/span>/);
  assert.match(chart.tip.innerHTML,/<small>16 Oct, 10:00 UTC<\/small>$/);
  assert.equal(chart.tip.hidden,false);
  assert.ok(!chart.tip.innerHTML.includes('$2.40'));
});

test('unrecognized term consistently falls back to Spot but null prices never become zero',async()=>{
  const chart=await renderChart('unsupported',{...history,latest:{Spot:{value:null}}});
  assert.equal(chart.metrics.marketPriceLabel.textContent,'SPOT / GPU-HR');
  assert.equal(chart.metrics.marketPrice.textContent,'—');
  assert.ok(chart.target.innerHTML.includes('data-capacity-line="Spot"'));
  assert.ok(!chart.target.innerHTML.includes('$0.00'));
});

test('terminal integration preserves remote chart and local marketplace workflows',()=>{
  const terminal=fs.readFileSync(path.join(__dirname,'../OpenNEXT-terminal.js'),'utf8');
  assert.ok(terminal.includes('delete stored.period;'));
  assert.ok(terminal.includes('delete stored.term;delete stored.count;'));
  assert.ok(terminal.includes('if(window.OpenNEXTHistory){chartInfo=null;return window.OpenNEXTHistory.render(S);}'));
  assert.ok(terminal.includes('window.OpenNEXTHistory?.refresh();'));
  assert.ok(terminal.includes('window.OpenNEXTProcurement.listingTable(context())'));
  assert.ok(terminal.includes('window.OpenNEXTBilling?.init(S)'));
  assert.ok(terminal.includes('D.loadTickerHistory()'));
  assert.ok(terminal.includes("if(incoming.has('gpu')"));
  assert.ok(!terminal.includes("['AMM','Not connected']"));
});
