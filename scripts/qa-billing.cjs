/* Manual local browser QA. Run explicitly; not part of the dependency-free test suite. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.OPENNEXT_PLAYWRIGHT_PATH || 'C:/Users/asus/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

(async () => {
  const folder = path.resolve(__dirname, '../.opennext-data/qa/billing');
  fs.mkdirSync(folder, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.OPENNEXT_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.OPENNEXT_BASE_URL || 'http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.ONPreview && window.OpenNEXTBilling);
    await page.evaluate(() => {
      const S = window.ONPreview.state;
      Object.assign(S, { auth: true, role: 'Buyer', balance: 0, ledger: [], orders: [], paymentSessions: [], earningsBalance: 0, payouts: [], billingUI: undefined });
      window.OpenNEXTBilling.init(S); window.ONPreview.navigate('billing');
    });
    await page.getByRole('heading', { name: 'Billing & usage', exact: true }).waitFor();
    assert.match(await page.locator('.credit').innerText(), /\$0\.00/);
    assert.equal(await page.evaluate(() => window.ONPreview.state.balance), 0);
    await page.evaluate(() => window.ONPreview.navigate('market'));
    await page.locator('.credit').click();
    await page.getByRole('heading', { name: 'Billing & usage', exact: true }).waitFor();
    await page.screenshot({ path: path.join(folder, 'buyer-desktop.png'), fullPage: true });

    async function openCheckout(preset) {
      await page.locator('[data-act="pay-start"]').first().click();
      await page.locator('.pay-presets label').filter({ has: page.locator(`[value="${preset}"]`) }).click();
      await page.getByRole('button', { name: 'Continue to checkout', exact: true }).click();
      await page.getByRole('heading', { name: 'Review your payment', exact: true }).waitFor();
    }
    await openCheckout('100');
    await page.locator('[data-act="pay-fail"]').click();
    assert.equal(await page.evaluate(() => window.ONPreview.state.balance), 0);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await openCheckout('1000');
    await page.locator('[data-act="pay-cancel"]').click();
    assert.equal(await page.evaluate(() => window.ONPreview.state.balance), 0);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await openCheckout('500');
    await page.screenshot({ path: path.join(folder, 'checkout-desktop.png'), fullPage: true });
    await page.locator('[data-act="pay-confirm"]').click();
    assert.equal(await page.evaluate(() => window.ONPreview.state.balance), 500);
    assert.equal(await page.evaluate(() => window.OpenNEXTBilling.completePayment(window.ONPreview.state, window.ONPreview.state.paymentSessions[0].id, 'Paid')), false);
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    await page.locator('[data-act="bill-sample"]').click();
    await page.locator('[data-act="bill-chart"][data-value="lines"]').click();
    await page.locator('[data-act="bill-series"][data-value="spot"]').click();
    await page.locator('[data-form="bill-filter"] [name="from"]').fill('2026-10-01');
    await page.locator('[data-form="bill-filter"] [name="to"]').fill('2026-10-17');
    await page.locator('[data-form="bill-filter"] button').click();
    assert.equal(await page.evaluate(() => window.ONPreview.state.balance), 500);
    assert.equal(await page.evaluate(() => window.ONPreview.state.ledger.length), 1);
    assert.equal(await page.evaluate(() => window.OpenNEXTBilling.analytics(window.ONPreview.state).rows.length), 17);
    await page.screenshot({ path: path.join(folder, 'buyer-analytics-desktop.png'), fullPage: true });
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-act="bill-export"][data-value="daily"]').click();
    const exported = await downloadPromise;
    assert.match(exported.suggestedFilename(), /example-daily\.csv$/);

    await page.evaluate(() => {
      const S = window.ONPreview.state, now = new Date().toISOString();
      S.role = 'Seller'; S.earningsBalance = 600; S.billingUI.sample = false;
      S.billingUI.from = now.slice(0, 8) + '01'; S.billingUI.to = now.slice(0, 10);
      S.ledger.push({ id: 'SALE-QA', type: 'Sale settlement', amount: 600, status: 'Paid', createdAt: now, role: 'Seller', wallet: 'earnings', test: true });
      window.ONPreview.render();
    });
    await page.getByRole('heading', { name: 'Earnings & payouts', exact: true }).waitFor();
    await page.locator('[data-act="cashout-start"]').first().click();
    await page.locator('[data-form="cashout-request"] [name="amount"]').fill('125');
    await page.locator('[data-form="cashout-request"] [name="bank"]').fill('QA business account');
    await page.locator('[data-form="cashout-request"] [name="last4"]').fill('1234');
    await page.getByRole('button', { name: 'Request test payout', exact: true }).click();
    assert.equal(await page.evaluate(() => window.ONPreview.state.earningsBalance), 475);
    assert.equal(await page.evaluate(() => window.ONPreview.state.balance), 500);
    await page.screenshot({ path: path.join(folder, 'seller-payout-desktop.png'), fullPage: true });
    await page.locator('[data-act="cashout-cancel"]').click();
    assert.equal(await page.evaluate(() => window.ONPreview.state.earningsBalance), 600);
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.locator('[data-act="cashout-start"]').first().click();
    await page.locator('[data-form="cashout-request"] [name="amount"]').fill('200');
    await page.locator('[data-form="cashout-request"] [name="bank"]').fill('QA business account');
    await page.locator('[data-form="cashout-request"] [name="last4"]').fill('1234');
    await page.getByRole('button', { name: 'Request test payout', exact: true }).click();
    await page.locator('[data-act="cashout-settle"]').click();
    assert.equal(await page.evaluate(() => window.ONPreview.state.earningsBalance), 400);
    assert.equal(await page.evaluate(() => window.ONPreview.state.payouts[0].status), 'Paid');
    await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    await page.screenshot({ path: path.join(folder, 'seller-desktop.png'), fullPage: true });

    await page.evaluate(() => {
      const S = window.ONPreview.state, now = new Date().toISOString();
      S.role = 'Broker';
      S.orders.unshift({ id: 'ORDER-10086', side: 'buy', role: 'Broker', title: 'H100 training cluster', kind: 'gpu_capacity', model: 'H100 SXM', count: 8, region: 'Singapore', term: 'On-demand', hours: 24, unitPrice: 2, subtotal: 384, fees: 4, total: 388, paymentStatus: 'Unpaid', status: 'Awaiting payment', buyer: { name: 'Nova', company: 'Vishwa', email: 'nova@vishwalab.com' }, seller: { name: 'Supplier Team', company: 'Northstar Compute', email: 'supplier@example.com' }, createdAt: now, quoteValidUntil: new Date(Date.now() + 86400000).toISOString(), deliveryMinutes: 15, deliveryMethod: 'SSH', serviceStart: new Date(Date.now() + 3600000).toISOString(), serviceEnd: new Date(Date.now() + 25 * 3600000).toISOString(), audit: [{ at: now, event: 'Quote accepted' }] });
      window.ONPreview.render();
    });
    await page.getByRole('heading', { name: 'Billing & earnings', exact: true }).waitFor();
    await page.locator('[data-act="bill-order"][data-id="ORDER-10086"]').first().click();
    await page.getByRole('heading', { name: 'Order details · ORDER-10086', exact: true }).waitFor();
    assert.equal(await page.locator('[data-act="proc-payment"][data-id="ORDER-10086"]').count(), 1);
    await page.screenshot({ path: path.join(folder, 'order-desktop.png'), fullPage: true });
    await page.locator('.modal-head [data-act="close-modal"]').click();
    await page.screenshot({ path: path.join(folder, 'broker-desktop.png'), fullPage: true });

    // A resize must not discard unsubmitted form values or rebuild the form itself.
    await page.locator('[data-form="bill-filter"] [name="from"]').fill('2026-09-09');
    await page.evaluate(() => { window.billingQAForm = document.querySelector('[data-form="bill-filter"]'); });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.bill-chart').getAttribute('viewBox').split(' ')[2] === '280');
    assert.equal(await page.evaluate(() => window.billingQAForm === document.querySelector('[data-form="bill-filter"]')), true);
    assert.equal(await page.locator('[data-form="bill-filter"] [name="from"]').inputValue(), '2026-09-09');

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const currentRole of ['Buyer', 'Seller', 'Broker']) {
        await page.evaluate(r => { window.ONPreview.state.role = r; window.ONPreview.render(); }, currentRole);
        await page.evaluate(() => window.scrollTo(0, 0));
        const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        assert.ok(overflow.document <= width + 1 && overflow.body <= width + 1, `${currentRole} overflow at ${width}: ${JSON.stringify(overflow)}`);
        if (width === 390) await page.screenshot({ path: path.join(folder, currentRole.toLowerCase() + '-mobile.png'), fullPage: true });
      }
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, checks: ['zero account', 'failed/cancelled/successful top-ups', 'idempotent confirmation', 'chart/date/sample controls', 'CSV download', 'seller payout reserve/cancel/settle', 'broker order details', 'Buyer/Seller/Broker desktop + mobile no overflow'], screenshots: folder }, null, 2));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
