'use strict';
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TEST_BASE||'http://127.0.0.1:4188';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 const errors=[];
 async function context(){const c=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));return [c,p];}
 async function login(p){await p.locator('[data-auth-provider="Google"]').click();await p.locator('[data-auth-preview-account]').click();}
 async function rentals(p){await p.locator('label[for="public-listings-0"]').click();await p.locator('[data-listing-panel="0"]').scrollIntoViewIfNeeded();}
 async function switchTo(p,value){await p.locator('[data-act="market-menu"]').click();await p.locator('[data-act="switch-market"][data-value="'+value+'"]').click();}
 try{
  const [c,p]=await context();await p.goto(base);
  await p.locator('.public-header [data-public-action="signin"]').click();await login(p);
  assert.equal(await p.evaluate(()=>ONPreview.state.route),'market');
  const order=await p.locator('.filters').evaluate(el=>[...el.children].map(c=>c.className));assert.match(order[0],/market-switch/);
  await p.locator('[data-act="filter"][data-type="model"]').click();await p.locator('#modelSearch').fill('B200');await p.locator('[data-act="select-filter"][data-value="B200"]').click();
  await p.locator('[data-act="market-menu"]').click();await p.screenshot({path:'.opennext-data/market-switch-gpu.png',fullPage:true});
  await p.keyboard.press('Escape');assert.equal(await p.locator('[data-act="market-menu"]').getAttribute('aria-expanded'),'false');
  await p.locator('[data-act="market-menu"]').click();await p.locator('[data-act="sources"]').last().click();
  assert.equal(await p.locator('.market-switch-menu').count(),0);await p.locator('[data-act="close-modal"]').first().click();assert.equal(await p.locator('.market-switch-menu').count(),0);
  await switchTo(p,'models');assert.equal(await p.locator('.model-card').count(),29);
  assert.match(await p.locator('.nav-item.active').textContent(),/Model Capacity/);
  await p.locator('[data-search="models"]').fill('Claude');assert.equal(await p.locator('.model-card:visible').count(),9);
  await p.locator('.model-card:visible [data-act="model-quote"]').first().click();assert.match(await p.locator('form[data-form="model-rfq"] select[name="sku"]').inputValue(),/claude/);await p.locator('[data-act="close-modal"]').first().click();
  await switchTo(p,'market');assert.equal(await p.locator('[data-act="filter"][data-type="model"] strong').textContent(),'B200');
  await p.goBack();await p.waitForFunction(()=>ONPreview.state.route==='models');await p.goForward();await p.waitForFunction(()=>ONPreview.state.route==='market');
  await switchTo(p,'models');await p.screenshot({path:'.opennext-data/market-switch-models.png',fullPage:true});
  await p.setViewportSize({width:390,height:844});await switchTo(p,'market');await p.locator('[data-act="market-menu"]').click();
  const mobile=await p.locator('.market-switch-menu').boundingBox();assert.ok(mobile.x>=0&&mobile.x+mobile.width<=390);
  await p.screenshot({path:'.opennext-data/market-switch-mobile.png',fullPage:true});await p.locator('[data-act="switch-market"][data-value="models"]').click();assert.equal(await p.locator('.model-card').count(),29);await c.close();

  const [c2,q]=await context();await q.goto(base);await rentals(q);
  await q.locator('.on-listing-carousel').screenshot({path:'.opennext-data/home-buy-offer.png'});
  await q.locator('[data-listing-panel="0"] [data-listing-intent="buy"]').first().click();await login(q);
  const form=q.locator('form[data-form="rfq"]');await form.waitFor();
  assert.equal(await form.locator('[name="model"]').inputValue(),'H200');assert.equal(await form.locator('[name="count"]').inputValue(),'1024');assert.equal(await form.locator('[name="region"]').inputValue(),'Worldwide');assert.equal(await form.locator('[name="term"]').inputValue(),'Reserved');assert.equal(await form.locator('[name="hours"]').inputValue(),'8640');assert.equal(await form.locator('[name="offerId"]').inputValue(),'');
  assert.match(await form.textContent(),/another buyer/);assert.equal(await q.evaluate(()=>ONPreview.state.role),'Buyer');
  await form.locator('button[type="submit"],button:not([type])').last().click();
  assert.equal(await q.evaluate(()=>ONPreview.state.rfqs[0].originListingId),'rental-h200-128');
  await q.locator('[data-act="close-modal"]').click();
  await q.locator('[data-act="home"]').click();await rentals(q);await q.locator('[data-listing-panel="0"] [data-listing-intent="offer"]').first().click();
  assert.equal(await q.evaluate(()=>ONPreview.state.role),'Seller');assert.match(await q.locator('.modal h2').textContent(),/Supplier review/);
  let review=q.locator('form[data-form="review"]');await review.locator('[type="checkbox"]').check();await review.locator('button').last().click();
  review=q.locator('form[data-form="review"]');await review.locator('[name="registration"]').fill('QA-REGISTRATION');await review.locator('button').last().click();
  review=q.locator('form[data-form="review"]');await review.locator('[name="evidence"]').fill('QA-OWNERSHIP-REFERENCE');await review.locator('[type="checkbox"]').check();await review.locator('button').last().click();
  await q.locator('form[data-form="review"] button').last().click();
  await q.locator('form[data-form="respond"]').waitFor();assert.equal(await q.evaluate(()=>ONPreview.state.modal.requirement.id),'DEMAND-rental-h200-128');await c2.close();

  const [c3,r]=await context();
  for(const host of ['opennextlab.ai','terminal.opennextlab.ai'])await c3.route('https://'+host+'/**',async route=>{const u=new URL(route.request().url());const response=await route.fetch({url:base+u.pathname+u.search});await route.fulfill({response});});
  await r.goto('https://opennextlab.ai/');await rentals(r);await r.locator('[data-listing-panel="0"] [data-listing-intent="buy"]').first().click();
  await r.waitForURL('https://terminal.opennextlab.ai/**');assert.match(r.url(),/listing=rental-h200-128/);await login(r);
  await r.locator('form[data-form="rfq"]').waitFor();assert.equal(await r.locator('form[data-form="rfq"] [name="count"]').inputValue(),'1024');assert.ok(!new URL(r.url()).searchParams.has('listing'));await c3.close();
  const [c4,cancel]=await context();await cancel.goto(base+'/?listing=rental-h200-128&intent=buy#terminal/rfqs');
  await cancel.locator('[data-auth-back]').click();assert.ok(!new URL(cancel.url()).searchParams.has('listing'));assert.ok(!new URL(cancel.url()).searchParams.has('intent'));
  await cancel.reload();assert.equal(await cancel.evaluate(()=>ONPreview.state.pendingListing),null);await c4.close();
  assert.deepEqual(errors,[]);console.log('PASS: GPU default, bidirectional market switch, filters, model search/quote, back/forward, mobile menu, guest Buy + RFQ submit, Offer + supplier review, split-host handoff.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
