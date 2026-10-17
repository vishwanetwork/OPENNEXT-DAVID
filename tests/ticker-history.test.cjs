'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {createSpotHistoryStore} = require('../OpenNEXT-spot-history.cjs');

const points = [{date:'2026-10-10',value:2},{date:'2026-10-11',value:2.2},{date:'2026-10-12',value:null},{date:'2026-10-13',value:2.1}];
const series = (id, extra={}) => ({id,provider:'aws',gpuModel:'H100',region:'us-east-1',zone:'us-east-1a',instanceType:'p5.48xlarge',gpuCount:8,term:'Spot',points,...extra});
function store(rows) {
  const data={schemaVersion:1,asOf:'2026-10-13',regions:[{code:'us-east-1',name:'US East',city:'N. Virginia'}],series:rows};
  return createSpotHistoryStore({readFile:async()=>JSON.stringify(data)});
}
test('ticker exposes recorded Spot histories, preserves gaps and keeps one configuration per region/model',async()=>{
  const data=await store([series('first'),series('other-zone',{zone:'us-east-1b',points:points.map(p=>({...p,value:8}))}),series('single',{gpuModel:'A100',points:[points[0]]}),series('fractional',{gpuModel:'L4',gpuCount:0}),series('h200',{gpuModel:'H200'})]).ticker();
  assert.equal(data.records.length,2);
  assert.equal(data.records[0].recordId,'history:first');
  assert.equal(data.records[0].perGpuHourly,2.1);
  assert.equal(data.records[0].regionName,'N. Virginia');
  assert.deepEqual(data.records[0].points,points);
  assert.equal(data.meta.livePrices,false);
  assert.equal(data.meta.unit,'USD/GPU-hour');
});
test('ticker rejects empty, stale-window, invalid and single-point histories',async()=>{
  const data=await store([series('empty',{points:[]}),series('old',{points:[{date:'2025-01-01',value:2},{date:'2025-01-02',value:3}]}),series('bad',{points:[{date:'2026-10-10',value:null},{date:'2026-10-13',value:-1}]})]).ticker();
  assert.equal(data.records.length,0);
});
const terminal=fs.readFileSync(require.resolve('../OpenNEXT-terminal.js'),'utf8');
const spark=vm.runInNewContext('('+terminal.slice(terminal.indexOf('  function tickerSpark('),terminal.indexOf('  function paintTicker('))+')',{Intl,Date});
test('spark has a visible path, date labels, and never bridges missing days',()=>{
  const html=spark(points);
  const path=html.match(/class="ticker-price-line" d="([^"]+)"/)[1];
  assert.equal((path.match(/M/g)||[]).length,2);
  assert.equal((path.match(/L/g)||[]).length,1);
  assert.match(html,/Oct 10/);
  assert.match(html,/Oct 13/);
  assert.doesNotMatch(html,/NaN|Infinity|AWS/);
});
test('flat and single-point observations remain visible; empty data is not fabricated',()=>{
  for(const input of [[points[0]],points.map(p=>({...p,value:2}))]){
    const html=spark(input);
    assert.match(html,/<circle/);
    assert.doesNotMatch(html,/NaN|Infinity/);
    assert.match(html,/cy="45.00"/);
  }
  assert.doesNotMatch(spark([]),/<svg/);
});
