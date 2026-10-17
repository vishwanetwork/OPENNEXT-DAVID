'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function listings(loadQuotes = true, side = 'supply') {
  const context = {
    window: {},
    document: {getElementById: () => ({})},
    matchMedia: () => ({matches: false, addEventListener() {}}),
    MutationObserver: class {observe() {}},
  };
  for (const file of [...(loadQuotes ? ['OpenNEXT-model-quotes.js'] : []), 'OpenNEXT-home-listings.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  const api = context.window.OpenNEXTListings;
  api.selectSide(side);
  const html = api.render({models: 'Model', rental: 'GPU rental', physical: 'Physical GPU'});
  const cards = new Map([...html.matchAll(/<article\b[^>]*data-listing-id="([^"]+)"[\s\S]*?<\/article>/g)].map(match => [match[1], match[0]]));
  return {api, html, cards, quotes:context.window.OpenNEXTModelQuotes};
}

test('every buyer rental target has only a supplier response CTA, bound to that requirement', () => {
  const {api, html: lane, cards} = listings(true, 'demand');
  assert.match(lane, /data-listing-side-filter="demand" aria-pressed="true"/);
  for (const item of api.groups.find(items => items[0].kind === 'rental')) {
    const html = cards.get(item.id);
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0]);
    assert.equal(buttons.length, 1, item.id);
    const offer = buttons.find(button => button.includes('data-listing-intent="offer"'));
    assert.ok(offer, item.id + ' must retain the supplier entry');
    for (const button of buttons) {
      assert.ok(button.includes('data-listing-selection="' + item.id + '"'));
      assert.ok(button.includes('data-mode="rental"'));
      assert.ok(button.includes('data-public-action="open-workspace"'));
    }
    assert.doesNotMatch(html, /data-listing-intent="buy"|<span>Buy capacity<\/span>/);
    assert.match(html, /data-listing-side="demand"/);
    assert.match(offer, /data-target="supply"/);
    assert.match(offer, /<span>Offer capacity<\/span>/);
    assert.match(offer, /aria-label="Offer capacity: /);
  }
});

test('rental pricing remains buyer demand, not a sale or availability promise', () => {
  const {api, cards} = listings(true, 'demand');
  for (const item of api.groups.find(items => items[0].kind === 'rental')) {
    assert.equal(item.priceKind, 'buyer_target');
    assert.equal(api.get(item.id), item);
    assert.match(cards.get(item.id), /Buyer demand/);
    assert.match(cards.get(item.id), /Buyer target price/);
    assert.match(cards.get(item.id), /Buyer budget · availability requires a separate quote/);
  }
});

test('model and hardware references remain in the buyer lane with one correct purchase-inquiry route', () => {
  const {api, html, cards} = listings();
  assert.equal((html.match(/class="public-listing-radio"/g) || []).length, 3);
  assert.equal((html.match(/data-listing-panel="/g) || []).length, 3);
  for (const item of api.groups.flat().filter(item => item.kind !== 'rental')) {
    const card = cards.get(item.id);
    assert.equal((card.match(/data-public-action="open-workspace"/g) || []).length, 1);
    assert.match(card, /<span>Buy capacity<\/span>/);
    assert.match(card, /data-listing-intent="buy"/);
    assert.match(card, /data-listing-side="supply"/);
    assert.ok(card.includes('data-listing-selection="' + item.id + '"'));
    assert.ok(card.includes('data-target="' + (item.kind === 'model' ? 'models' : 'rfq') + '"'));
    if (item.kind === 'hardware') assert.match(card, /data-mode="hardware"/);
    assert.doesNotMatch(card, /Offer capacity|data-listing-intent="offer"/);
    assert.match(card, /confirmed on inquiry|Official reference|subject to quote|Temporarily unavailable/);
  }
});

test('GPU rental is the first and default carousel tab', () => {
  const {api, html} = listings();
  assert.equal(api.groups[0][0].kind, 'rental');
  assert.equal(api.groups[1][0].kind, 'model');
  assert.match(html, /id="public-listings-0" checked><label[^>]*>GPU rental<\/label>/);
  assert.match(html, /No listings/);
  assert.match(html, /No published offers in this market yet/);
  assert.doesNotMatch(html, /data-listing-id="rental-/);
  const demand = listings(true, 'demand').html;
  assert.match(demand, /id="public-listings-0" checked><label[^>]*>GPU rental<\/label>/);
  assert.match(demand, /01 — 05 \/ 14/);
  assert.equal((html.match(/ checked/g) || []).length, 1);
});

test('supplier indications precede unmatched official references without model-version substitution', () => {
  const {api, cards} = listings();
  const model = api.get('model-gemini-lite');
  assert.equal(model.input, 0.153);
  assert.equal(model.output, 1.275);
  assert.equal(model.cachedInput, 0.0153);
  assert.equal(model.priceKind, 'supplier_quote');
  assert.equal(model.sourceUrl, null);
  assert.match(cards.get(model.id), /Supplier quote/);
  assert.match(cards.get(model.id), /\$0\.153/);
  assert.match(cards.get(model.id), /\$1\.275/);
  assert.match(cards.get(model.id), /\$0\.0153/);
  const models = api.groups[1];
  assert.equal(models.length, 40);
  assert.equal(models.filter(item => item.priceKind === 'supplier_quote').length, 29);
  assert.ok(models.slice(0, 29).every(item => item.sourceKind === 'supplier_indication'));
  for (const item of models.slice(29)) {
    assert.equal(item.priceKind, 'public_api_reference');
    assert.ok(item.sourceUrl.startsWith('https://'));
    assert.match(cards.get(item.id), /Official reference/);
  }
  assert.equal(api.get('model-gpt-sol').input, 2);
  assert.equal(api.get('model-claude-sonnet').input, 2);
  assert.equal(api.get('model-gpt-luna').input, .1);
  assert.equal(models.filter(item => item.sku === 'gemini-3.5-flash-lite').length, 1);
  assert.match(cards.get('model-quote-gpt-5.4-mini'), /\$0\.03825/);
  assert.match(cards.get('model-quote-gemini-3.1-flash-lite'), /\$0\.01275/);
  for (const price of ['$1.30','$6.50','$0.13']) assert.ok(cards.get('model-quote-claude-sonnet-5').includes(price));
  for (const price of ['$2.55','$15.30','$0.255']) assert.ok(cards.get('model-quote-gpt-5.6-sol-short').includes(price));
});

test('shared model quotes retain exact tiers, final prices and explicit source uncertainty', () => {
  const {quotes} = listings();
  const rows = quotes.list();
  assert.equal(rows.length, 29);
  assert.equal(new Set(rows.map(row => row.sku)).size, 29);
  assert.equal(new Set(rows.filter(row => row.modelId === 'gpt-5.6-sol').map(row => row.context)).size, 2);
  assert.equal(quotes.get('gpt-5.6-sol'), undefined, 'a model without its context tier is not an exact quote');
  assert.equal(quotes.get('claude-sonnet-5.5'), undefined);
  assert.equal(quotes.get('gpt-6-luna'), undefined);
  assert.equal(quotes.get('toString'), undefined);
  const expected = [
    ['claude-sonnet-5',1.3,6.5,0.13],
    ['claude-sonnet-4-6',1.95,9.75,0.195],
    ['claude-haiku-4-5',0.65,3.25,0.065],
    ['claude-opus-4-5',3.25,16.25,0.325],
    ['gpt-5.6-sol-short',2.55,15.3,0.255],
    ['gpt-5.6-sol-long',5.1,22.95,0.51],
    ['gpt-5.6-terra-short',1.275,7.65,0.1275],
    ['gpt-5.6-terra-long',2.55,11.475,0.255],
    ['gpt-5.6-luna-short',0.51,3.06,0.051],
    ['gpt-5.6-luna-long',1.02,4.59,0.102],
    ['gpt-5.4-mini',0.3825,2.295,0.03825],
    ['gpt-5.4-nano',0.102,0.6375,0.0102],
    ['gemini-3.6-flash',0.765,3.825,0.0765],
    ['gemini-3.5-flash-lite',0.153,1.275,0.0153],
    ['gemini-2.5-pro-up-to-200k',0.6375,5.1,0.06375],
    ['gemini-2.5-pro-over-200k',1.275,7.65,0.1275],
    ['gemini-2.5-flash',0.153,1.275,0.0153],
  ];
  for (const [sku,input,output,cache] of expected) {
    const quote = quotes.get(sku);
    assert.equal(quote.input, input, sku);
    assert.equal(quote.output, output, sku);
    assert.equal(quote.cache, cache, sku);
  }
  for (const quote of rows) {
    assert.equal(quote.sourceKind, 'supplier_indication');
    assert.equal(quote.referenceKind, 'supplier_sheet_reference');
    assert.equal(quote.referenceVerified, false);
    assert.equal(quote.cacheBilling, 'quote-confirm');
    assert.equal(quote.cache, quote.cachedInput);
    assert.equal(quote.outputType, 'Text');
    assert.ok(Object.isFrozen(quote));
    for (const field of ['name','modelId','context','inputType','remarks','terms']) assert.ok(quote[field]);
    assert.match(quote.terms, /not independently verified current official prices/);
    assert.doesNotMatch(JSON.stringify(quote), /authorized|native|discount|markup|upstreamCost/i);
  }
  rows.pop();
  assert.equal(quotes.list().length, 29, 'callers cannot mutate the shared list');
});

test('without the shared quotes asset the original references remain intact', () => {
  const {api} = listings(false);
  assert.equal(api.groups[1].length, 12);
  assert.ok(api.groups[1].every(item => item.priceKind === 'public_api_reference'));
  assert.equal(api.get('model-gemini-lite').input, .3);
  assert.equal(api.get('model-gemini-lite').output, 2.5);
});
