'use strict';
// Explicit browser QA with isolated Demo sessions and ephemeral server storage.
// Set PLAYWRIGHT_MODULE and CHROME_EXECUTABLE for the local browser runtime.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createAppServer}=require('../OpenNEXT-preview-server.cjs');
const {createDemoService}=require('../OpenNEXT-demo-service.cjs');

(async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'opennext-insight-browser-'));
  const screenshots=path.resolve('test-results','insight-model-browser-'+Date.now());
  await fs.mkdir(screenshots,{recursive:true});
  const demo=createDemoService({enabled:true,secureCookies:false});
  const server=createAppServer({dataDir:directory,demoService:demo,env:{OPENNEXT_NEWS_ENABLED:'0',OPENNEXT_EXTERNAL_MARKETPLACE_ENABLED:'0'},secureCookies:false});
  let browser,page;
  const errors=[],checks=[];
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
    const context=await browser.newContext({viewport:{width:1440,height:1080}});
    context.setDefaultTimeout(15000);
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      return url.origin===base||url.protocol==='data:'?route.continue():route.abort();
    });
    page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/demo/?role=buyer#terminal/insight',{waitUntil:'domcontentloaded'});
    await page.locator('[data-sa-trade-model][value="H100 SXM"]').waitFor();
    await page.locator('[data-sa-option="model"][value="H100"]').waitFor();
    await page.waitForFunction(()=>window.OpenNEXTAuth?.getUser?.()?.role==='buyer');

    async function tradeView(model){
      for(const panel of ['analytics','activities'])assert.equal(await page.locator(`.onx-sa-${panel} .onx-sa-panel-model`).innerText(),model);
      const selected=await page.locator('[data-sa-trade-model]:checked').evaluateAll(elements=>elements.map(element=>element.value));
      assert.deepEqual(selected,[model]);
      assert.equal(await page.locator('[data-sa-group="tradeModel"] [data-sa-all]').count(),0);
      assert.equal(await page.locator('[data-sa-trade-model][value="All"]').count(),0);
      const models=await page.locator('.onx-sa-activity-row > div:nth-child(2) > strong').allTextContents();
      assert.ok(models.length>0,'The chosen model has completed activity.');
      assert.deepEqual([...new Set(models)],[model]);
      return page.locator('.onx-sa-metrics').innerText();
    }
    async function overflow(){
      const bounds=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
      assert.ok(bounds.scroll<=bounds.viewport+1,JSON.stringify(bounds));
      return bounds;
    }
    async function indexSelection(){
      return page.locator('[data-sa-option="model"]:checked').evaluateAll(elements=>elements.map(element=>element.value).sort());
    }
    const initialStats=await tradeView('H100 SXM');
    assert.equal(await page.locator('[data-sa-trade-model]').first().getAttribute('type'),'radio');
    assert.equal(await page.locator('[data-sa-option="model"]').first().getAttribute('type'),'checkbox');
    assert.equal(await page.locator('[data-sa-all="model"]').isChecked(),true);
    checks.push('Index uses checkboxes; trade panels use exactly one radio and no All');

    await page.locator('[data-sa-option="model"][value="H100"]').check();
    await page.locator('[data-sa-option="model"][value="H200"]').check();
    assert.deepEqual(await indexSelection(),['H100','H200']);
    assert.equal(await page.locator('[data-sa-all="model"]').isChecked(),false);
    assert.deepEqual(await page.locator('[data-insight-model] option').evaluateAll(elements=>elements.map(element=>element.value).sort()),['H100','H200']);
    assert.equal(await tradeView('H100 SXM'),initialStats);
    checks.push('Index model multiselect leaves Analytics and Activities unchanged');

    await page.locator('[data-sa-trade-model][value="H200 SXM"]').check();
    const nextStats=await tradeView('H200 SXM');assert.notEqual(nextStats,initialStats);
    assert.deepEqual(await indexSelection(),['H100','H200']);
    await page.locator('[data-sa-show]').selectOption('100');
    await tradeView('H200 SXM');
    checks.push('Trade model switches both panels without mixed-model activity or changed Index selections');
    await overflow();
    await page.screenshot({path:path.join(screenshots,'01-desktop-three-panels.png'),fullPage:true});

    await page.locator('[data-sa-panel="index"]').click();
    assert.equal(await page.locator('[data-sa-group="model"]').count(),0);
    assert.equal(await page.locator('[data-sa-group="tradeModel"]').count(),1);
    assert.equal(await page.locator('.onx-sa-panels').getAttribute('data-visible-count'),'2');
    await tradeView('H200 SXM');
    await page.screenshot({path:path.join(screenshots,'02-desktop-trade-panels.png'),fullPage:true});
    await page.locator('[data-sa-panel="activities"]').click();
    assert.equal(await page.locator('.onx-sa-panels.single-panel .onx-sa-analytics').count(),1);
    assert.equal(await page.locator('[data-sa-panel="analytics"]').isDisabled(),true);
    assert.equal(await page.locator('[data-sa-group="tradeModel"]').count(),1);
    await page.locator('[data-sa-panel="index"]').click();
    await page.locator('[data-sa-panel="analytics"]').click();
    assert.equal(await page.locator('[data-sa-group="tradeModel"]').count(),0);
    assert.equal(await page.locator('[data-sa-group="model"]').count(),1);
    assert.deepEqual(await indexSelection(),['H100','H200']);
    assert.equal(await page.locator('[data-sa-panel="index"]').isDisabled(),true);
    await page.locator('[data-sa-panel="analytics"]').click();
    await page.locator('[data-sa-panel="activities"]').click();
    await tradeView('H200 SXM');
    checks.push('Panel hide/show scopes model controls and preserves both selections');

    await page.setViewportSize({width:390,height:844});
    await overflow();
    await page.screenshot({path:path.join(screenshots,'03-mobile-filters.png'),fullPage:false});
    await page.locator('[data-sa-group="tradeModel"]').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(screenshots,'04-mobile-trade-model.png'),fullPage:false});
    await page.locator('[data-sa-trade-model][value="H100 SXM"]').check();
    await tradeView('H100 SXM');
    await page.locator('.onx-sa-analytics').scrollIntoViewIfNeeded();
    await overflow();
    await page.screenshot({path:path.join(screenshots,'05-mobile-analytics.png'),fullPage:false});
    await page.locator('.onx-sa-activities').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(screenshots,'06-mobile-activities.png'),fullPage:false});
    checks.push('390px responsive filters and both trade panels have no document horizontal overflow');

    await page.setViewportSize({width:1440,height:1080});
    await page.goto(base+'/demo/?role=seller#terminal/market',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.OpenNEXTAuth?.getUser?.()?.role==='seller');
    await page.locator('[data-sa-trade-model][value="H100 SXM"]').waitFor();
    await tradeView('H100 SXM');
    await page.locator('[data-sa-trade-model][value="H200 SXM"]').check();
    await tradeView('H200 SXM');
    assert.equal(await page.locator('[data-act="new-supply"]').count(),1);
    await overflow();
    checks.push('Seller Market Insight uses the same single-model trade controls');

    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,checks,screenshots},null,2));
  }catch(error){
    if(page&&!page.isClosed())await page.screenshot({path:path.join(screenshots,'failure.png'),fullPage:false}).catch(()=>{});
    console.error('Browser artifacts: '+screenshots);throw error;
  }finally{
    if(browser)await browser.close();
    server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));
    await Promise.all([server.news.close(),server.pricing.close(),server.capacity.close(),demo.close()]);
    assert(path.basename(directory).startsWith('opennext-insight-browser-'));assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    await fs.rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
