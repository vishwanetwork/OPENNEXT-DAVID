'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const css = fs.readFileSync(path.join(__dirname, '../OpenNEXT-original-homepage.css'), 'utf8');
function landing() {
  const context = {window: {OpenNEXTListings: {render: () => ''}, openNEXTPreviewTicker: () => ''}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../OpenNEXT-original-homepage.js'), 'utf8'), context);
  return context.window.renderOriginalLanding();
}
const lines = text => text.split('<br>').map(line => line.trim());

test('resource descriptions keep the requested two-line and three-line desktop copy', () => {
  const rows = [...landing().matchAll(/<div class="public-market-row"><h3>(.*?)<\/h3><p>(.*?)<\/p>/g)];
  assert.deepEqual(rows.map(row => [row[1], lines(row[2])]), [
    ['GPU compute', ['Compare historical prices and current supply.', 'Source GPU-hours, dedicated clusters or hardware, on your terms.']],
    ['Model capacity', ['Compare model access and token pricing,', 'with supplier provenance and authorization status in view.', 'Match limits and delivery terms to your workload.']],
  ]);
});

test('Specify and Agree retain exact wording with the requested desktop line breaks', () => {
  const process = landing().match(/<ol class="public-process">(.*?)<\/ol>/)[1];
  const steps = [...process.matchAll(/<li><h3>(.*?)<\/h3><p>(.*?)<\/p><\/li>/g)];
  assert.deepEqual(lines(steps.find(step => step[1] === 'Specify')[2]), ['Capture the workload, region,', 'quantity, budget and delivery window.']);
  assert.deepEqual(lines(steps.find(step => step[1] === 'Agree')[2]), ['Accept the right quote. Keep price,', 'scope and delivery terms in one order.']);
  assert.equal(steps.length, 4);
});

test('market rows use shared column widths and equal padding down to the next separator', () => {
  assert.match(css, /\.public-page \.public-market-row\{grid-template-columns:minmax\(180px,1fr\) minmax\(0,2fr\) 132px;gap:32px\}/);
  assert.match(css, /\.public-page \.public-market-section\{--on-market-row-padding:29px;padding-bottom:0\}/);
  assert.match(css, /\.public-page \.public-market-row,\.public-page \.public-market-row:last-child\{padding-block:var\(--on-market-row-padding\)\}/);
  assert.match(css, /\.public-page \.public-market-row p\{min-width:0;max-width:none\}/);
  assert.match(css, /\.public-page \.public-process p\{max-width:none\}/);
});

test('narrow layouts return to natural wrapping without joining words at hidden breaks', () => {
  assert.match(css, /@media\(max-width:1100px\)\{\.public-page \.public-market-row p br,\.public-page \.public-process p br\{display:none\}\}/);
  const html = landing();
  const copy = [...html.matchAll(/<(?:div class="public-market-row"|li)><h3>(?:GPU compute|Model capacity|Specify|Agree)<\/h3><p>(.*?)<\/p>/g)];
  assert.equal(copy.length, 4);
  for (const match of copy) assert.equal((match[1].match(/<br>/g) || []).length, (match[1].match(/<br> /g) || []).length);
});
