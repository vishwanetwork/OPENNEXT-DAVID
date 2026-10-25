'use strict';
// Isolated browser QA: test Credit only; all data is temporary and outside production.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createAppServer}=require('../OpenNEXT-preview-server.cjs');
const {createDemoService}=require('../OpenNEXT-demo-service.cjs');
const usd=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const keyPart=value=>{const bytes=Buffer.isBuffer(value)?value:Buffer.from(value),size=Buffer.alloc(4);size.writeUInt32BE(bytes.length);return Buffer.concat([size,bytes]);};
const sshPublicKey='ssh-ed25519 '+Buffer.concat([keyPart('ssh-ed25519'),keyPart(Buffer.alloc(32,7))]).toString('base64')+' topup-browser-fixture';

(async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'opennext-topup-browser-'));
  const screenshots=path.resolve('test-results','topup-browser-'+Date.now());await fs.mkdir(screenshots,{recursive:true});
  const demo=createDemoService({enabled:true,secureCookies:false});
  const server=createAppServer({dataDir:directory,demoService:demo,env:{OPENNEXT_NEWS_ENABLED:'0',OPENNEXT_EXTERNAL_MARKETPLACE_ENABLED:'0'},secureCookies:false});
  let browser,page,consolePage,context,base;
  const errors=[],reviewRequests=[],checks=[],created=[];
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
    context=await browser.newContext({viewport:{width:1440,height:1080}});context.setDefaultTimeout(15000);
    await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===base||url.protocol==='data:'?route.continue():route.abort();});
    page=await context.newPage();consolePage=await context.newPage();
    for(const current of [page,consolePage])current.on('pageerror',error=>errors.push(error.message));
    consolePage.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/admin/topups/')&&request.url().includes('/review'))reviewRequests.push(request.postDataJSON());});
    await consolePage.goto(base+'/admin/#topups',{waitUntil:'domcontentloaded'});
    await consolePage.locator('[data-topup-scope]').selectOption('demo');await consolePage.getByText('No top-up requests yet',{exact:true}).waitFor();
    await page.goto(base+'/demo/?role=buyer#terminal/billing',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.OpenNEXTAuth?.getUser?.()?.role==='buyer'&&window.ONPreview?.state?.billingAccountConfirmed===true);
    assert.equal(await page.evaluate(()=>window.ONPreview.state.balance),100);
    const account=()=>page.evaluate(async()=>{const response=await fetch('/api/demo/billing/account');if(!response.ok)throw Error('Test account unavailable');return response.json();});
    const modal=()=>page.getByRole('dialog');
    const shot=name=>page.screenshot({path:path.join(screenshots,name+'.png'),fullPage:false});
    async function waitForBalance(value){
      await page.bringToFront();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(expected=>Math.round(window.ONPreview.state.balance*100)===Math.round(expected*100),value);
      assert.equal(await page.locator('.terminal-head .credit strong').innerText(),usd(value));
    }
    async function beginGeneric(){await page.locator('.terminal-head [data-nav="billing"]').filter({hasText:/^Billing$/}).click();await page.getByRole('button',{name:'Add credit',exact:true}).click();await page.locator('form[data-form="payment-amount"]').waitFor();}
    async function submitTopup(amount,{method='credit_card',reference=''}={}){
      const amountForm=page.locator('form[data-form="payment-amount"]');await amountForm.waitFor();
      assert.equal(await amountForm.getAttribute('data-purchase-reference'),reference);
      await amountForm.locator('[name="custom"]').fill(String(amount));assert.equal(await amountForm.locator('[name="preset"][value="other"]').isChecked(),true);
      await amountForm.locator('[type="submit"]').click();const paymentForm=page.locator('form[data-form="payment-method"]');await paymentForm.waitFor();
      assert.equal(await modal().locator('.pay-summary strong').innerText(),usd(amount));
      await paymentForm.locator(`[name="method"][value="${method}"]`).check();
      const responsePromise=page.waitForResponse(response=>response.url()===base+'/api/demo/billing/topups'&&response.request().method()==='POST');
      await paymentForm.locator('[type="submit"]').click();const response=await responsePromise,result=await response.json();
      assert.equal(response.status(),201,JSON.stringify(result));assert.equal(result.request.status,'Pending');assert.equal(result.request.amount,amount);assert.equal(result.request.purchaseReference||'',reference);
      created.push(result.request);await modal().getByRole('heading',{name:'Top-up in progress.',exact:true}).waitFor();
      assert.equal(await modal().getByRole('button',{name:'Back to purchase',exact:true}).count(),0);
      return result.request;
    }
    async function review(row,decision,{verifyCheckbox=false}={}){
      await consolePage.bringToFront();await consolePage.locator('[data-topup-action="refresh"]').click();
      const button=consolePage.locator(`[data-topup-action="${decision==='Approve'?'approve':'reject'}"][data-id="${row.id}"]`);await button.waitFor();
      const workspaceId=await button.getAttribute('data-workspace');assert.match(workspaceId,/^DEMO-/);
      const summary=await button.locator('xpath=ancestor::tr').innerText();assert.match(summary,/guest@demo.invalid/);assert.ok(summary.includes(usd(row.amount)));assert.match(summary,/Pending/);
      await button.click();const dialog=consolePage.locator('.on-topup-dialog'),form=dialog.locator('[data-topup-form="review"]');await form.waitFor();
      assert.match(await dialog.innerText(),/Test account only/);
      if(decision==='Approve'){
        if(verifyCheckbox){const before=reviewRequests.length;await form.locator('[type="submit"]').click();assert.equal(await form.locator('[name="fundsVerified"]').evaluate(element=>element.validity.valueMissing),true);assert.equal(reviewRequests.length,before);}
        await form.locator('[name="fundsVerified"]').check();
      }else await form.locator('[name="reason"]').fill('Payment was not received in the isolated test account.');
      await consolePage.screenshot({path:path.join(screenshots,`${created.length}-console-${decision.toLowerCase()}.png`),fullPage:false});
      const responsePromise=consolePage.waitForResponse(response=>response.url()===base+'/api/admin/topups/'+row.id+'/review?scope=demo'&&response.request().method()==='POST');
      await form.locator('[type="submit"]').click();const response=await responsePromise,result=await response.json();assert.equal(response.status(),200,JSON.stringify(result));assert.equal(result.request.status,decision==='Approve'?'Approved':'Rejected');
      await dialog.waitFor({state:'detached'});return {workspaceId,result:result.request};
    }
    async function openTopupNotice(id){
      await page.locator('[data-qp-action="bell"]').click();
      const notificationId=(await account()).notifications.find(item=>item.topupId===id)?.id;assert.ok(notificationId);
      await page.locator(`[data-qp-action="notification"][data-qp-id="${notificationId}"]`).click();await modal().waitFor();
      assert.equal(await page.evaluate(()=>window.ONPreview.state.modal.id),id);
    }

    await beginGeneric();await shot('01-add-credit');
    const first=await submitTopup(125.5);assert.equal((await account()).availableCredit,100);await shot('02-generic-pending');
    const reviewed=await review(first,'Approve',{verifyCheckbox:true});await waitForBalance(225.5);
    await modal().getByRole('heading',{name:'Credit added.',exact:true}).waitFor();assert.equal(await modal().getByRole('button',{name:'Back to purchase',exact:true}).count(),0);
    await shot('03-generic-approved');await modal().getByRole('button',{name:'Done',exact:true}).click();
    await openTopupNotice(first.id);assert.match(await modal().innerText(),/\$125\.50 has been credited/);await shot('04-approval-notification');await modal().getByRole('button',{name:'Done',exact:true}).click();
    const duplicate=await consolePage.evaluate(async data=>{const response=await fetch('/api/admin/topups/'+data.id+'/review?scope=demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision:'Approve',fundsVerified:true,workspaceId:data.workspaceId})});return {status:response.status,data:await response.json()};},{id:first.id,workspaceId:reviewed.workspaceId});
    assert.equal(duplicate.status,200);assert.equal((await account()).availableCredit,225.5);assert.equal((await account()).notifications.length,1);
    checks.push('Other amount selects Other and preserves the top-up amount','Pending adds no Credit','Console verified-funds checkbox','Approval updates header and notification','Generic top-up never offers Back to purchase','Duplicate approval cannot double-credit');

    await beginGeneric();const rejected=await submitTopup(75,{method:'paypal'});assert.equal((await account()).availableCredit,225.5);
    await review(rejected,'Reject');await waitForBalance(225.5);await modal().getByRole('heading',{name:'Top-up not approved.',exact:true}).waitFor();
    assert.equal(await modal().getByRole('button',{name:'Back to purchase',exact:true}).count(),0);assert.match(await modal().innerText(),/No credit was added/);
    await shot('05-rejected');await modal().getByRole('button',{name:'Done',exact:true}).click();checks.push('Rejected top-up adds no Credit and reports its amount');

    await page.locator('.terminal-head [data-nav="market"]').click();await page.locator('[data-spot-buy]').first().click();
    const purchaseForm=page.locator('form[data-form="spot-checkout-review"]');await purchaseForm.waitFor();
    const hourly=Number((await purchaseForm.locator('.onx-spot-checkout-summary p').first().locator('strong').innerText()).replace(/[^\d.]/g,''));assert.ok(hourly>0);
    const hours=Math.ceil(275.5/(hourly*1.05))+.25;
    await purchaseForm.locator('[name="durationHours"]').fill(String(hours));await purchaseForm.locator('[name="sshPublicKey"]').fill(sshPublicKey);
    const total=Number((await purchaseForm.locator('[data-spot-total]').innerText()).replace(/[^\d.]/g,''));assert.ok(total>225.5);
    await purchaseForm.locator('[type="submit"]').click();await modal().getByRole('button',{name:/Pay by Credit/}).click();await page.locator('[data-act="spot-checkout-deposit"]').waitFor();
    assert.match(await page.locator('.onx-spot-credit-balance').getAttribute('class'),/is-insufficient/);await shot('06-insufficient-credit');
    const reference=await page.evaluate(()=>window.OpenNEXTSpotMarket.purchaseReference({S:window.ONPreview.state}));assert.ok(reference);
    for(const method of ['Cancel','Close dialog','backdrop','Escape']){
      await page.locator('[data-act="spot-checkout-deposit"]').click();await page.locator('form[data-form="payment-amount"]').waitFor();
      if(method==='Escape')await page.keyboard.press('Escape');
      else if(method==='backdrop')await page.locator('.overlay').click({position:{x:5,y:200}});
      else await modal().getByRole('button',{name:method,exact:true}).click();
      await page.locator('[data-act="spot-checkout-resume"]').waitFor();
      assert.equal(await page.evaluate(()=>window.OpenNEXTSpotMarket.purchaseReference({S:window.ONPreview.state})),reference);
      await page.locator('[data-act="spot-checkout-resume"]').click();await modal().getByRole('button',{name:/Pay by Credit/}).click();await page.locator('[data-act="spot-checkout-deposit"]').waitFor();
    }
    await page.locator('[data-act="spot-checkout-deposit"]').click();
    const linked=await submitTopup(Math.ceil(total-225.5)+25,{reference});assert.equal((await account()).availableCredit,225.5);await shot('07-linked-pending');
    await review(linked,'Approve');await waitForBalance(225.5+linked.amount);await modal().getByRole('button',{name:'Back to purchase',exact:true}).waitFor();await shot('08-linked-approved');
    await modal().getByRole('button',{name:'Back to purchase',exact:true}).click();await modal().getByRole('heading',{name:'Choose payment',exact:true}).waitFor();
    await modal().getByRole('button',{name:'Back to review',exact:true}).click();
    assert.equal(await page.locator('[name="durationHours"]').inputValue(),String(hours));assert.equal(await page.locator('[name="sshPublicKey"]').inputValue(),sshPublicKey);assert.equal(await page.evaluate(()=>window.OpenNEXTSpotMarket.purchaseReference({S:window.ONPreview.state})),reference);
    await shot('09-purchase-restored');
    await page.setViewportSize({width:390,height:844});await page.locator('[name="durationHours"]').scrollIntoViewIfNeeded();await shot('10-mobile-restored');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.setViewportSize({width:1440,height:1080});
    await page.locator('form[data-form="spot-checkout-review"] [type="submit"]').click();await modal().getByRole('button',{name:/Pay by Credit/}).click();await page.locator('[data-act="spot-checkout-authorize"]').waitFor();
    const before=(await account()).availableCredit;await page.locator('[data-act="spot-checkout-authorize"]').click();await page.locator('[data-spot-checkout-error]').filter({hasText:'No Credit was charged'}).waitFor();assert.equal((await account()).availableCredit,before);
    checks.push('Insufficient Credit is red and opens Deposit Credit','Cancel, close, backdrop and Escape preserve purchase context on retry','Pending linked top-up has no Back action','Approved exact-reference top-up returns to purchase','Duration and SSH survive top-up return','390px purchase view has no overflow','Demo checkout cannot charge funds');
    assert.equal((await server.topups.list()).length,0,'No production top-up records were created.');
    const workspace=await page.evaluate(async()=>{const response=await fetch('/api/demo/marketplace/me');if(!response.ok)throw Error('Test workspace unavailable');return response.json();});
    assert.equal(workspace.orders.length,0,'No GPU order was created.');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,checks,topups:created.map(({id,amount,purchaseReference})=>({id,amount,purchaseReference:purchaseReference||null})),screenshots},null,2));
  }catch(error){
    if(page&&!page.isClosed())await page.screenshot({path:path.join(screenshots,'failure-terminal.png'),fullPage:false}).catch(()=>{});
    if(consolePage&&!consolePage.isClosed())await consolePage.screenshot({path:path.join(screenshots,'failure-console.png'),fullPage:false}).catch(()=>{});
    console.error('Browser artifacts: '+screenshots);throw error;
  }finally{
    if(browser)await browser.close();server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));
    await Promise.all([server.news.close(),server.pricing.close(),server.capacity.close(),demo.close()]);
    assert.ok(path.basename(directory).startsWith('opennext-topup-browser-'));assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));await fs.rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
