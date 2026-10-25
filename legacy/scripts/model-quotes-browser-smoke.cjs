'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {createAppServer}=require('../OpenNEXT-preview-server.cjs');
(async()=>{
 const server=createAppServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),p=await context.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(()=>{if(window.top===window&&!localStorage.getItem('opennext-terminal-v3'))localStorage.setItem('opennext-terminal-v3',JSON.stringify({auth:true,identity:{name:'Nova',email:'nova@vishwalab.com'},model:'H100',region:'All regions',term:'Spot',count:8,period:'1M'}));});
 await p.route('**/api/news',r=>r.fulfill({json:{articles:[]}}));
 try{
  await p.goto(base+'/#terminal/models');await p.locator('.model-card').first().waitFor();
  assert.equal(await p.locator('.model-card').count(),29);
  const checks=await p.evaluate(()=>OpenNEXTModelQuotes.list().map(q=>({sku:q.sku,ratio:q.brand==='Anthropic'?.65:.51,actual:[q.input,q.output,q.cache],references:[q.referenceInput,q.referenceOutput,q.referenceCachedInput],display:[...document.querySelector('[data-model-sku="'+q.sku+'"] .model-price-grid').querySelectorAll('strong')].map(e=>e.textContent)})));
  for(const c of checks)for(let i=0;i<3;i++){assert.ok(Math.abs(c.actual[i]-c.references[i]*c.ratio)<1e-9,c.sku);assert.equal(c.display[i],c.actual[i].toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6}));}
  assert.equal(await p.evaluate(()=>/\p{Script=Han}/u.test(document.body.innerText)),false);
  const search=p.locator('[data-search="models"]');await search.fill('GPT-5.4 Mini');assert.equal(await p.locator('.model-card:visible').count(),1);assert.match(await p.locator('.model-card:visible').innerText(),/\$0\.03825/);await search.fill('');
  await p.screenshot({path:path.join('.opennext-data','model-quotes-terminal.png')});
  await p.locator('[data-act="model-quote"][data-sku="claude-sonnet-5"]').click();
  const f=p.locator('form[data-form="model-rfq"]');assert.equal(await f.locator('[name="sku"]').inputValue(),'claude-sonnet-5');
  assert.equal(await f.locator('[name="count"],[name="hours"],[name="ssh"]').count(),0);
  await f.locator('[name="title"]').fill('Production assistant tokens');await f.locator('[name="inputMillion"]').fill('5');await f.locator('[name="outputMillion"]').fill('2');
  assert.match(await f.locator('.model-rfq-estimate').innerText(),/\$19\.50/);
  await f.locator('[name="sku"]').selectOption('gemini-3.5-flash-lite');assert.equal(await f.locator('[name="title"]').inputValue(),'Production assistant tokens');assert.match(await f.locator('.model-rfq-estimate').innerText(),/\$3\.315/);
  await f.locator('[name="days"]').fill('60');await f.locator('[name="tps"]').fill('250');await f.locator('[name="budget"]').fill('100');await f.locator('[name="region"]').fill('Singapore');await f.locator('[name="notes"]').fill('Confirm input modalities and cache billing.');
  await f.locator('button[type="submit"]').click();await p.locator('[data-rfq-kind="model_capacity"]').waitFor();
  const saved=await p.evaluate(()=>ONPreview.state.rfqs[0]);assert.equal(saved.kind,'model_capacity');assert.equal(saved.sku,'gemini-3.5-flash-lite');assert.equal(saved.inputMillion,5);assert.equal(saved.outputMillion,2);assert.equal(saved.days,60);assert.equal(saved.budget,100);assert.equal(saved.priceSnapshot.cache,.0153);assert.equal(saved.count,undefined);assert.equal(saved.hours,undefined);
  assert.match(await p.locator('.modal').innerText(),/\$0\.153/);assert.doesNotMatch(await p.locator('.modal').innerText(),/GPU-hour|SSH|undefined|NaN/);
  await p.locator('[data-act="close-modal"]').first().click();await p.reload();await p.locator('[data-rfq-kind="model_capacity"] [data-act="view-rfq"]').click();assert.match(await p.locator('.modal').innerText(),/Confirm input modalities/);
  await p.locator('[data-act="close-modal"]').first().click();
  await p.goto(base+'/#terminal/supply');assert.match(await p.locator('.page-content').innerText(),/GPU buyer requirements/);assert.doesNotMatch(await p.locator('.page-content').innerText(),/undefined GPU|NaN|Production assistant tokens/);
  await p.goto(base+'/#terminal/models');await p.locator('[data-act="new-rfq"]').click();await p.locator('form[data-form="model-rfq"]').waitFor();await p.locator('[data-act="close-modal"]').first().click();
  await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await p.screenshot({path:path.join('.opennext-data','model-quotes-mobile.png')});
  await p.locator('[data-act="home"]').first().click();assert.equal(await p.locator('#public-listings-0').isChecked(),true);await p.locator('label[for="public-listings-1"]').click();
  const homepage=await p.evaluate(()=>OpenNEXTListings.get('model-quote-claude-sonnet-5'));assert.equal(homepage.input,1.3);assert.equal(homepage.output,6.5);assert.equal(homepage.cache,.13);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,modelTiers:29,verifiedPrices:87,modelRfq:'create-view-reload',errors}));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
