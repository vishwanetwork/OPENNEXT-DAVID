'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../OpenNEXT-market-data.js'),'utf8');
const row={recordId:'history:test',gpuModel:'H100',country:'Singapore',vcpu:192,gpuMemoryGb:80,term:'Spot',historical:true,perGpuHourly:2,observedAt:'2026-10-13',points:[{date:'2026-10-07',value:1},{date:'2026-10-13',value:2}]};
function fixture(tickerResponse={records:[row]}){
  const requests=[];const window={};
  vm.runInNewContext(source,{window,Intl,URLSearchParams,Date,AbortSignal,fetch:async url=>{
    requests.push(url);return {ok:true,json:async()=>url.startsWith('/api/pricing/ticker')?tickerResponse:{records:[{gpuModel:'H100',term:'On-demand',perGpuHourly:3},{gpuModel:'H100',term:'Spot',perGpuHourly:2}]}};
  }});
  return {market:window.ONMarket,requests};
}
test('homepage requests seven-day history and carries its recorded hardware/date fields without remapping',async()=>{
  const {market,requests}=fixture();await market.loadTickerHistory();
  assert.deepEqual(requests,['/api/pricing/ticker?period=1W']);
  const result=market.tickerRows()[0];
  assert.equal(result.country,'Singapore');assert.equal(result.vcpu,192);assert.equal(result.gpuMemoryGb,80);
  assert.equal(result.observedAt,'2026-10-13');assert.equal(result.points[0].date,'2026-10-07');
});
test('ordinary prices and On-demand or undated payloads cannot substitute for the recorded Spot ticker',async()=>{
  const {market}=fixture({records:[{...row,term:'On-demand'},{...row,historical:false},{...row,points:[row.points[0]]}]});
  await market.refresh();assert.equal(market.records.length,2);assert.equal(market.tickerRows().length,0);
  await market.loadTickerHistory();assert.equal(market.tickerRows().length,0);
});
