'use strict';
// Explicit browser QA only. Uses an isolated server and temporary private data.
// Run with PLAYWRIGHT_MODULE / CHROME_EXECUTABLE set for the local runtime.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createAppServer} = require('../OpenNEXT-preview-server.cjs');
const {createContactService} = require('../OpenNEXT-contact-service.cjs');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opennext-contact-browser-'));
  const screenshots = path.resolve('test-results', 'contact-browser-' + Date.now());
  await fs.mkdir(screenshots, {recursive:true});
  const server = createAppServer({dataDir:directory, env:{}});
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({headless:true, ...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {})});
    const page = await browser.newPage({viewport:{width:1440,height:1100}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === '127.0.0.1' || url.protocol === 'data:' ? route.continue() : route.abort();
    });
    await page.goto(base, {waitUntil:'domcontentloaded'});
    await page.locator('.public-header [data-act="contact-us"]').click();
    const modal = page.locator('.on-contact-dialog');
    await modal.waitFor({state:'visible'});
    assert.equal(await modal.getAttribute('aria-labelledby'), 'on-contact-heading');
    await modal.getByRole('button', {name:'Submit request'}).click();
    assert.equal(await page.locator('.on-contact-success').count(), 0);
    await modal.getByLabel('Name', {exact:true}).fill('QA Contact Buyer');
    await modal.getByLabel('Company', {exact:true}).fill('QA Fixture Company');
    await modal.getByLabel('Title', {exact:true}).fill('Infrastructure Lead');
    await modal.getByLabel('Email', {exact:true}).fill('contact-qa@example.test');
    await modal.getByLabel('How can we help?').fill('We need 16 H100 GPUs in Singapore for a 30-day research project. Please confirm delivery timing and capacity.');
    await page.screenshot({path:path.join(screenshots,'01-contact-form.png'),fullPage:false});

    // A failed server request must stay a failure, not a fabricated confirmation.
    const failFirst = route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary QA failure. Please retry.'})});
    await page.route('**/api/contact', failFirst);
    await modal.getByRole('button', {name:'Submit request'}).click();
    await page.locator('.on-contact-error:not([hidden])').waitFor();
    assert.match(await page.locator('.on-contact-error').innerText(), /Temporary QA failure/);
    assert.equal(await page.locator('.on-contact-success').count(), 0);
    assert.equal((await server.contacts.list()).length, 0);
    await page.unroute('**/api/contact', failFirst);
    await modal.getByRole('button', {name:'Submit request'}).click();
    await page.locator('.on-contact-success').waitFor();
    assert.match(await page.locator('.on-contact-success').innerText(), /contact-qa@example\.test/);
    assert.match(await page.locator('.on-contact-success').innerText(), /CONTACT-[A-F0-9]{8}/);
    await page.screenshot({path:path.join(screenshots,'02-contact-received.png'),fullPage:false});
    await page.getByRole('button', {name:'Done',exact:true}).click();
    await page.locator('.on-contact-dialog').waitFor({state:'detached'});
    assert.equal(await page.locator('.on-contact-dialog').count(), 0);

    // Protect the new private endpoints from forwarded requests and public reads.
    assert.equal((await page.request.get(base+'/api/admin/contacts',{headers:{'X-Forwarded-For':'203.0.113.10'}})).status(),401);
    assert.equal((await page.request.get(base+'/.opennext-data/contact-leads.json')).status(),404);
    assert.equal((await page.request.get(base+'/api/contact')).status(),405);

    await page.goto(base+'/admin/#leads', {waitUntil:'domcontentloaded'});
    await page.locator('.on-leads-table tbody tr').waitFor();
    assert.equal(await page.locator('.on-leads-table tbody tr').count(), 1);
    assert.match(await page.locator('.on-leads-table').innerText(), /QA Contact Buyer/);
    await page.locator('[data-lead-search]').fill('not present');
    assert.match(await page.locator('.on-leads-table').innerText(), /No matching requests/);
    await page.locator('[data-lead-search]').fill('QA Fixture');
    await page.locator('[data-lead-action="details"]').click();
    await page.locator('.on-lead-dialog').waitFor();
    assert.match(await page.locator('.on-lead-message').innerText(), /16 H100 GPUs/);
    const note = 'QA follow-up: delivery requirements verified; owner assigned. <not-an-html-element>';
    await page.locator('.on-lead-dialog [name="status"]').selectOption('Qualified');
    await page.locator('.on-lead-dialog [name="note"]').fill(note);
    await page.getByRole('button', {name:'Save update',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('.on-lead-history')?.innerText.includes('QA follow-up: delivery requirements verified'));
    assert.equal(await page.locator('.on-lead-dialog not-an-html-element').count(), 0);
    assert.match(await page.locator('.on-lead-history').innerText(), /<not-an-html-element>/);
    await page.screenshot({path:path.join(screenshots,'03-console-contact-detail.png'),fullPage:false});
    const saved = await createContactService({dataDir:directory}).list();
    assert.equal(saved.length, 1);assert.equal(saved[0].status, 'Qualified');assert.equal(saved[0].history[0].note, note);
    await page.keyboard.press('Escape');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('.on-leads-table tbody tr').waitFor();
    assert.match(await page.locator('.on-leads-table').innerText(), /Qualified/);
    await page.locator('[data-lead-filter]').selectOption('Closed');
    assert.match(await page.locator('.on-leads-table').innerText(), /No matching requests/);
    await page.locator('[data-lead-filter]').selectOption('Qualified');
    assert.equal(await page.locator('.on-leads-table tbody tr').count(), 1);
    await page.screenshot({path:path.join(screenshots,'04-console-contacts.png'),fullPage:false});

    await page.setViewportSize({width:390,height:844});
    await page.goto(base, {waitUntil:'domcontentloaded'});
    await page.locator('.public-header [data-act="contact-us"]').click();
    await page.locator('.on-contact-dialog').waitFor();
    const size = await page.locator('.on-contact-dialog').evaluate(element => ({width:element.getBoundingClientRect().width,viewport:innerWidth,scroll:element.scrollWidth,client:element.clientWidth}));
    assert(size.width <= size.viewport);assert(size.scroll <= size.client + 1);
    await page.screenshot({path:path.join(screenshots,'05-contact-mobile.png'),fullPage:false});
    await page.keyboard.press('Escape');
    await page.locator('.on-contact-dialog').waitFor({state:'detached'});
    assert.equal(await page.locator('.on-contact-dialog').count(), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({passed:true,checks:['form validation','failure feedback','successful submission','private persistence','Console search/filter','details','status and notes','escaped free text','page reload','private endpoint protection','mobile dialog','Escape close'],screenshots},null,2));
  } finally {
    if(browser) await browser.close();
    server.closeAllConnections();
    if(server.listening) await new Promise(resolve => server.close(resolve));
    // Only the unique directory created above is removed; screenshot output is retained.
    assert(path.basename(directory).startsWith('opennext-contact-browser-'));
    await fs.rm(directory,{recursive:true,force:true});
  }
})().catch(error => {console.error(error);process.exitCode=1;});
