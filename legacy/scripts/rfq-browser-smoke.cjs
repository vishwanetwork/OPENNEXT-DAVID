'use strict';
// Explicit browser QA using private ephemeral data and a real isolated Demo service.
// Run with PLAYWRIGHT_MODULE and CHROME_EXECUTABLE set for the local runtime.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createAppServer}=require('../OpenNEXT-preview-server.cjs');
const {createDemoService}=require('../OpenNEXT-demo-service.cjs');

(async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'opennext-rfq-browser-'));
  const screenshots=path.resolve('test-results','rfq-browser-'+Date.now());
  await fs.mkdir(screenshots,{recursive:true});
  const demo=createDemoService({enabled:true,secureCookies:false});
  const server=createAppServer({dataDir:directory,demoService:demo,env:{OPENNEXT_NEWS_ENABLED:'0',OPENNEXT_EXTERNAL_MARKETPLACE_ENABLED:'0'},secureCookies:false});
  let browser,page,consolePage;
  const errors=[],submitted=[],checks=[];
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
    page=await context.newPage();consolePage=await context.newPage();
    for(const current of [page,consolePage])current.on('pageerror',error=>errors.push(error.message));
    await consolePage.goto(base+'/admin/#demoSubmissions',{waitUntil:'domcontentloaded'});
    await consolePage.getByText('No submissions yet',{exact:true}).waitFor();
    await page.goto(base+'/demo/?role=buyer#terminal/market',{waitUntil:'domcontentloaded'});
    await page.locator('.onx-spot-post-rfq').waitFor();
    await page.waitForFunction(()=>window.OpenNEXTAuth?.getUser?.()?.role==='buyer');
    assert.equal((await demo.consoleSnapshot()).rfqs.length,0);

    async function fillRequest({term='Spot',model='H200',notes=''}={}){
      const form=page.locator('form[data-form="proc-rfq"]');await form.waitFor();
      assert.equal(await form.locator('[name="title"],[name="project"]').count(),0);
      await form.locator('[name="model"]').fill(model);
      await form.locator('[name="region"]').selectOption({label:'Singapore'});
      await form.locator('[name="vcpu"]').fill('128');await form.locator('[name="count"]').fill('8');
      await form.locator('[name="memory"]').fill('141');await form.locator('[name="hours"]').fill('72');
      await form.locator('[name="term"]').selectOption(term);await form.locator('[name="budget"]').fill('2.15');
      const now=Date.now();
      await form.locator('[name="start"]').fill(new Date(now+72*3600000).toISOString().slice(0,16));
      await form.locator('[name="quoteDeadline"]').fill(new Date(now+48*3600000).toISOString().slice(0,16));
      for(const name of ['network','storage','image','sla','notes']){
        assert.equal(await form.locator(`[name="${name}"]`).getAttribute('required'),null,`${name} is optional`);
        await form.locator(`[name="${name}"]`).fill(name==='notes'?notes:'');
      }
      await form.locator('[name="deliveryMethod"]').fill('Dedicated bare metal');
      await page.waitForFunction(()=>document.querySelector('[data-proc-maximum-quote]')?.textContent==='$1,238.40');
      return form;
    }
    async function submitRequest(form,kind){
      const responsePromise=page.waitForResponse(response=>response.url()===base+'/api/demo/marketplace/rfqs'&&response.request().method()==='POST');
      await form.getByRole('button',{name:kind==='rfq'?'Post RFQ':'Submit request',exact:true}).click();
      const response=await responsePromise,result=await response.json();
      assert.equal(response.status(),201,JSON.stringify(result));
      assert.equal(result.rfq.requestKind,kind);assert.equal(result.rfq.status,'Reviewing');
      assert.equal(result.rfq.maximumQuotePrice,1238.4);assert.equal(result.rfq.vcpu,128);assert.equal(result.rfq.memory,141);
      submitted.push(result.rfq);
      await page.locator('.proc-request-success').waitFor();
      const text=await page.locator('.proc-request-success').innerText();
      assert.match(text,/submitted successfully/);assert.match(text,/match suitable capacity/);assert.match(text,/latest progress/);assert.match(text,/contact you by email/);
      return result.rfq;
    }
    async function verifyConsole(row){
      await consolePage.bringToFront();await consolePage.locator('[data-market-action="refresh"]').click();
      const button=consolePage.locator(`[data-market-action="details"][data-id="${row.id}"]`);await button.waitFor();
      const summary=await button.locator('xpath=ancestor::tr').innerText();
      for(const text of ['guest@demo.invalid',row.model,'128','141 GB / GPU',row.term])assert.ok(summary.includes(text),text);
      await button.click();const dialog=consolePage.locator('.market-console-dialog');await dialog.waitFor();
      const order=await dialog.locator('.rfq-detail-grid [data-rfq-field]').evaluateAll(elements=>elements.map(element=>element.dataset.rfqField));
      assert.deepEqual(order,['model','region','vcpu','count','memory','hours','term','budget','start','quoteDeadline','network','storage','image','sla','deliveryMethod','urgency','visibility','notes','shareClosingPrice']);
      assert.equal(await dialog.locator('.rfq-request-details input,.rfq-request-details select,.rfq-request-details textarea,.rfq-request-details button,.rfq-request-details a').count(),0);
      assert.match(await dialog.innerText(),/Approve Demo RFQ/);assert.match(await dialog.innerText(),/Reject RFQ/);
      assert.match(await dialog.locator('.rfq-detail-total').innerText(),/\$1,238\.40/);
      if(row.requestKind==='quote_request')assert.match(await dialog.locator('.rfq-detail-offer').innerText(),/Selected resource/);
      await consolePage.screenshot({path:path.join(screenshots,`console-${submitted.length}-details.png`),fullPage:false});
      await dialog.locator('[data-market-action="close"]').click();
      await page.bringToFront();
    }

    const initialRoute=new URL(page.url()).hash;
    await page.locator('.onx-spot-post-rfq').click();
    let form=await fillRequest();
    await page.screenshot({path:path.join(screenshots,'01-post-rfq-form.png'),fullPage:false});
    const rfq=await submitRequest(form,'rfq');
    await page.screenshot({path:path.join(screenshots,'02-submitted.png'),fullPage:false});
    await page.getByRole('dialog').getByRole('button',{name:'OK',exact:true}).click();
    assert.equal(new URL(page.url()).hash,initialRoute);assert.equal(await page.getByRole('dialog').count(),0);
    await verifyConsole(rfq);checks.push('GPU Market Post RFQ','optional fields','live maximum price','real Demo submission','Console field layout','OK preserves current page');

    for(const term of ['On-demand','Reserved']){
      await page.goto(base+'/demo/?role=buyer#terminal/market',{waitUntil:'domcontentloaded'});
      await page.locator(`[data-spot-term="${term}"]`).click();
      await page.locator('[data-spot-quote]').first().click();
      form=page.locator('form[data-form="proc-rfq"]');await form.waitFor();
      assert.equal(await form.locator('[name="requestKind"]').inputValue(),'quote_request');
      assert.equal(await form.locator('[name="term"]').inputValue(),term);
      const offer=JSON.parse(await form.locator('[name="selectedOffer"]').inputValue());
      assert.equal(offer.term,term);assert.ok(offer.id);
      assert.doesNotMatch(await page.getByRole('dialog').innerText(),/This local preview saves the request|no email is sent in this preview/);
      form=await fillRequest({term,model:offer.model,notes:'Need root access. <customer-note> Preserve this text.'});
      const row=await submitRequest(form,'quote_request');assert.equal(row.selectedOffer.id,offer.id);
      if(term==='On-demand'){
        await page.getByRole('dialog').getByRole('button',{name:'RFQs & Quote',exact:true}).click();
        await page.waitForURL('**#terminal/rfqs');
        await page.locator(`[data-act="proc-request-details"][data-id="${row.id}"]`).click();
        const detail=page.getByRole('dialog');await detail.waitFor();
        assert.equal(await detail.locator('.modal-body button').count(),1);assert.equal(await detail.locator('.modal-body button').innerText(),'Close');
        assert.equal(await detail.locator('.modal-body a,.modal-body form,.modal-body input,.modal-body textarea,.modal-body select').count(),0);
        assert.match(await detail.locator('.rfq-detail-field[data-rfq-field="notes"]').innerText(),/<customer-note>/);
        assert.equal(await detail.locator('customer-note').count(),0);
        await page.screenshot({path:path.join(screenshots,'03-buyer-request-details.png'),fullPage:false});
        await detail.getByRole('button',{name:'Close',exact:true}).click();
        await page.getByRole('button',{name:'View notifications',exact:true}).click();await page.waitForURL('**#terminal/notifications');
      }else{
        await page.getByRole('dialog').getByRole('button',{name:'OK',exact:true}).click();
        assert.equal(new URL(page.url()).hash,'#terminal/market');
      }
      await verifyConsole(row);checks.push(`${term} native quote request`);
    }
    const snapshot=await demo.consoleSnapshot();assert.equal(snapshot.rfqs.length,3);
    for(const row of snapshot.rfqs){assert.equal(row.ownerEmail,'guest@demo.invalid');assert.equal(row.status,'Reviewing');assert.equal(row.vcpu,128);assert.equal(row.memory,141);}
    assert.equal((await server.marketplace.admin()).rfqs.length,0,'Demo requests never reach production storage.');
    checks.push('owner-only read-only details','RFQs & Quote success navigation','Notification navigation','isolated Console records');

    await page.setViewportSize({width:390,height:844});
    await page.goto(base+'/demo/?role=buyer#terminal/market',{waitUntil:'domcontentloaded'});
    await page.locator('.onx-spot-post-rfq').click();await fillRequest();
    const bounds=await page.getByRole('dialog').evaluate(element=>({width:element.getBoundingClientRect().width,viewport:innerWidth,scroll:element.scrollWidth,client:element.clientWidth}));
    assert.ok(bounds.width<=bounds.viewport);assert.ok(bounds.scroll<=bounds.client+1,JSON.stringify(bounds));
    const pageBounds=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:innerWidth}));assert.ok(pageBounds.scroll<=pageBounds.client+1,JSON.stringify(pageBounds));
    await page.screenshot({path:path.join(screenshots,'04-mobile-rfq.png'),fullPage:false});
    await page.locator('[data-proc-maximum-quote]').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(screenshots,'05-mobile-rfq-footer.png'),fullPage:false});
    await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
    await page.goto(base+'/demo/?role=buyer#terminal/rfqs',{waitUntil:'domcontentloaded'});
    await page.locator(`[data-act="proc-request-details"][data-id="${rfq.id}"]`).click();
    const detailBounds=await page.getByRole('dialog').evaluate(element=>({scroll:element.scrollWidth,client:element.clientWidth}));assert.ok(detailBounds.scroll<=detailBounds.client+1);
    await page.screenshot({path:path.join(screenshots,'06-mobile-request-details.png'),fullPage:false});
    checks.push('390px form and read-only details without horizontal overflow');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,checks,submitted:submitted.map(({id,requestKind,term})=>({id,requestKind,term})),screenshots},null,2));
  }catch(error){
    if(page&&!page.isClosed())await page.screenshot({path:path.join(screenshots,'failure-terminal.png'),fullPage:false}).catch(()=>{});
    if(consolePage&&!consolePage.isClosed())await consolePage.screenshot({path:path.join(screenshots,'failure-console.png'),fullPage:false}).catch(()=>{});
    console.error('Browser artifacts: '+screenshots);throw error;
  }finally{
    if(browser)await browser.close();
    server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));
    await Promise.all([server.news.close(),server.pricing.close(),server.capacity.close(),demo.close()]);
    assert(path.basename(directory).startsWith('opennext-rfq-browser-'));assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    await fs.rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
