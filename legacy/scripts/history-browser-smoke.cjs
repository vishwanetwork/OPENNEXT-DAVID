'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createAppServer}=require('../OpenNEXT-preview-server.cjs');
(async()=>{
 const server=createAppServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1680,height:1100},reducedMotion:'reduce'}),p=await context.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{if(window.top===window) localStorage.setItem('opennext-terminal-v3',JSON.stringify({auth:true,identity:{name:'Nova',email:'nova@vishwalab.com'},model:'H100',region:'All regions',term:'Spot',count:8,period:'1M'}));});
 await p.route('**/api/news',r=>r.fulfill({json:{articles:[]}}));
 async function choose(type,value){await p.locator(`[data-act="filter"][data-type="${type}"]`).click();await p.locator(`[data-act="select-filter"][data-type="${type}"][data-value="${value}"]`).click();await p.waitForFunction(()=>document.querySelector('.history-comparison')||document.querySelector('#importedHistory h3')?.textContent==='No daily prices for this configuration');}
 try{
  await p.goto(base+'/#terminal/market');await p.locator('.history-comparison').waitFor();
  assert.equal(await p.locator('[data-history-line]').count(),3);
  assert.equal(await p.locator('#marketPrice').innerText(),'$4.6722');
  assert.equal(await p.locator('#marketRecords').innerText(),'31 days');
  assert.equal(await p.evaluate(()=>/\p{Script=Han}/u.test(document.body.innerText)),false);
  await p.locator('[data-history-toggle]').click();assert.equal(await p.locator('.history-region-group').count(),27);
  await p.locator('[data-history-search]').fill('Sydney');assert.equal(await p.locator('.history-region-group:visible').count(),1);
  assert.match(await p.locator('.history-region-group:visible').innerText(),/ap-southeast-2/);
  await p.locator('.history-region-group:visible input').nth(1).check();assert.equal(await p.locator('[data-history-line]').count(),4);
  await p.locator('.history-region-group:visible input').nth(2).check();assert.equal(await p.locator('[data-history-line]').count(),5);
  await p.locator('.history-region-group:visible input').first().click();assert.equal(await p.locator('[data-history-line]').count(),5);assert.match(await p.locator('.history-picker-notice').innerText(),/at most five/);
  await p.locator('[data-history-search]').fill('');await p.locator('.history-picker').screenshot({path:path.join('.opennext-data','history-regions-picker.png')});
  await p.keyboard.press('Escape');assert.equal(await p.locator('.history-picker').count(),0);
  await p.locator('.market-panel').screenshot({path:path.join('.opennext-data','history-all-regions-terminal.png')});
  await p.locator('[data-act="period"][data-value="1W"]').click();await p.waitForFunction(()=>document.getElementById('marketRecords')?.textContent==='8 days');
  await p.locator('[data-act="period"][data-value="ALL"]').click();await p.waitForFunction(()=>document.getElementById('marketRecords')?.textContent==='31 days');
  await choose('region','Asia Pacific (Sydney)');assert.match(await p.locator('.history-legend').innerText(),/Sydney/);assert.doesNotMatch(await p.locator('.history-legend').innerText(),/Virginia/);
  await choose('region','All regions');await choose('model','L4');await choose('count','0');assert.equal(await p.locator('[data-history-unit]').inputValue(),'instance');assert.match(await p.locator('.history-range').innerText(),/instance-hour/);assert.doesNotMatch(await p.locator('#marketPrice').innerText(),/NaN|Infinity|—/);
  await p.locator('[data-history-instance]').selectOption('g6f.4xlarge');assert.match(await p.locator('.history-comparison').innerText(),/g6f.4xlarge/);
  await choose('count','8');await choose('model','B200');assert.doesNotMatch(await p.locator('.history-comparison').innerText(),/g6f/);
  await choose('model','V100');assert.match(await p.locator('.history-comparison').innerText(),/p3dn.24xlarge/);
  await choose('model','H100 SXM');assert.match(await p.locator('#importedHistory').innerText(),/does not declare form factors/);
  await p.locator('[data-act="select-filter"][data-value="H100"]').click();await p.locator('.history-comparison').waitFor();
  await p.locator('.history-plot svg').hover({position:{x:550,y:180}});await p.locator('.history-tooltip').waitFor();assert.match(await p.locator('.history-tooltip').innerText(),/Daily average/);
  await p.locator('[data-act="home"]').first().click();assert.equal(await p.locator('#public-listings-0').isChecked(),true);assert.match(await p.locator('label[for="public-listings-0"]').innerText(),/GPU rental/i);
  await p.setViewportSize({width:390,height:844});await p.goto(base+'/#terminal/market');await p.locator('.history-comparison').waitFor();
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.equal(await p.evaluate(()=>/\p{Script=Han}/u.test(document.body.innerText)),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,regions:27,maxCurves:5,errors}));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
