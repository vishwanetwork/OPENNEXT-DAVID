'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'OpenNEXT-auth.js'), 'utf8');
function auth(hostname) {
  const window = {location: {hostname}, dispatchEvent() {}};
  vm.runInNewContext(source, {window, CustomEvent: class {}});
  return window.OpenNEXTAuth;
}
test('local sign-in and sign-up offer the isolated demo without creating an identity', () => {
  for (const hostname of ['127.0.0.1', 'localhost', '[::1]']) {
    const api = auth(hostname);
    for (const mode of ['signin', 'signup']) {
      const html = api.render(mode);
      assert.match(html, /data-auth-demo href="http:\/\/127\.0\.0\.1:4199\/preview\?role=buyer"/);
      assert.match(html, /Enter Demo/);
      assert.ok(html.indexOf('data-auth-demo') < html.indexOf('data-auth-provider'));
      assert.match(html, /Continue with Google/);
      assert.match(html, /Continue with GitHub/);
      assert.match(html, /Send verification code/);
      assert.equal(api.getUser(), null);
    }
  }
});
test('public and lookalike hosts never show a local authentication bypass', () => {
  for (const hostname of ['opennextlab.ai', 'terminal.opennextlab.ai', 'localhost.example.com', '127.0.0.1.example.com', '', undefined]) {
    const api = auth(hostname);
    assert.doesNotMatch(api.render('signin'), /data-auth-demo/);
    assert.doesNotMatch(api.render('signup'), /data-auth-demo/);
    assert.equal(api.getUser(), null);
  }
});
