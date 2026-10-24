const test = require('node:test');
const assert = require('node:assert/strict');
const Instances = require('../OpenNEXT-instances.js');

test('an empty workspace displays a visible, clearly separate instance example', () => {
  for (const role of ['Buyer', 'Seller']) {
    const S = {role, instances: []};
    const page = Instances.page({S});
    for (const text of ['No instances yet', 'Example only · not an active resource', 'Training workspace', 'US East', '8 × H100 SXM', '$2.30/GPU-hr', 'GPU utilization 71% · healthy']) assert.ok(page.includes(text), text);
    assert.doesNotMatch(page, /ins-1024|Northstar Compute|PROVIDER/);
    assert.match(page, /class="instance-example-chart[^"]*"/);
    assert.match(page, /data-act="instance-example-connect"/);
    assert.match(page, /data-act="instance-example-manage"/);
    assert.doesNotMatch(page, /<details|instance-example-grid|data-act="instance-resell"/);
    assert.deepEqual(S.instances, []);
  }
});

test('example controls open explanatory views without credentials or infrastructure actions', () => {
  const events = [];
  const c = {S: {role: 'Buyer', instances: []}, open: (...args) => events.push(args)};
  for (const type of ['instance-example-connect', 'instance-example-manage']) {
    assert.equal(Instances.action(c, type, {dataset: {}}), true);
    const view = Instances.modal(c, type, {});
    assert.ok(view.title);
    assert.match(view.body, /example/i);
    assert.match(view.body, /data-act="close-modal"/);
    assert.doesNotMatch(view.body, /data-act="instance-resell"|ssh -|password|private key|data-form=/i);
  }
  assert.equal(events.length, 2);
  assert.deepEqual(c.S.instances, []);
});

test('delivered allocations retain live instance cards rather than the example', () => {
  const c = {S: {role: 'Buyer', instances: [{id:'INS-ACTUAL', name:'Actual capacity', model:'H200', status:'Running', count:8, rate:2.5, region:'Singapore', serviceEnd:new Date(Date.now()+86400000).toISOString(), telemetry:{utilizationPercent:42, observedAt:new Date().toISOString()}}]}};
  const page = Instances.page(c);
  assert.match(page, /Actual capacity/);
  assert.match(page, /42\.0%/);
  assert.match(page, /data-act="instance-manage" data-id="INS-ACTUAL"/);
  assert.doesNotMatch(page, /Example only|Training workspace|No instances yet/);
});
