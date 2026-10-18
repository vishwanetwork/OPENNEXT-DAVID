'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const stableSnapshot = snapshot => {const {generatedAt, ...records} = snapshot; return JSON.stringify(records);};

async function setup(t, enabled = true) {
  const modulePath = require.resolve('../OpenNEXT-preview-server.cjs');
  const hosts = {SITE_HOST:'site.test', TERMINAL_HOST:'terminal.test', ADMIN_HOST:'admin.test'};
  const saved = Object.fromEntries(Object.keys(hosts).map(key => [key,process.env[key]]));
  let createAppServer;
  try {
    Object.assign(process.env, hosts);
    delete require.cache[modulePath];
    ({createAppServer} = require(modulePath));
  } finally {
    for (const key of Object.keys(hosts)) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
    delete require.cache[modulePath];
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'opennext-demo-integration-'));
  const server = createAppServer({dataDir, env:{OPENNEXT_DEMO_ENABLED:enabled?'1':'0'}, secureCookies:false});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dataDir,{recursive:true,force:true});
  });
  const request = (route,{host='terminal.test',method='GET',body,headers={}}={}) => new Promise((resolve,reject) => {
    const req=http.request({host:'127.0.0.1',port:server.address().port,path:route,method,headers:{Host:host,...(body?{'Content-Type':'application/json'}:{}),...headers}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text)}));
    });
    req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  return {request,server};
}

test('public demo entry boots before application scripts and redirects to Terminal host',async t=>{
  const {request}=await setup(t);
  const page=await request('/demo/');
  assert.equal(page.status,200);
  assert.doesNotMatch(page.text,/<base\b/);
  assert.match(page.text,/src="\/OpenNEXT-auth.js"/);
  assert(page.text.indexOf('/OpenNEXT-demo.js') < page.text.indexOf('/OpenNEXT-auth.js'));
  assert.equal(page.headers['x-robots-tag'],'noindex, nofollow');
  for(const asset of ['/OpenNEXT-demo.js','/OpenNEXT-demo.css']) assert.equal((await request(asset)).status,200);
  const redirect=await request('/demo/',{host:'site.test'});
  assert.equal(redirect.status,308);assert.equal(redirect.headers.location,'https://terminal.test/demo/');
  for(const route of ['/demo/','/api/demo/auth/session','/OpenNEXT-demo.js']) assert.equal((await request(route,{host:'admin.test'})).status,404);
  assert.equal((await request('/api/demo/start',{host:'site.test',method:'POST',body:{}})).status,404);
  for(const route of ['/OpenNEXT-demo-service.cjs','/OpenNEXT-demo-fixtures.cjs']) assert.equal((await request(route)).status,404);
});

test('demo session cannot authenticate with production routes or seed the real marketplace',async t=>{
  const {request,server}=await setup(t);
  const before=stableSnapshot(await server.marketplace.admin());
  const start=await request('/api/demo/start',{method:'POST',headers:{Origin:'http://terminal.test'},body:{role:'buyer'}});
  assert.equal(start.status,200,start.text);
  const cookie=start.headers['set-cookie'][0].split(';')[0];
  const live=await request('/api/auth/session',{headers:{Cookie:cookie}});
  assert.equal(live.json().user,null);
  const demo=await request('/api/demo/auth/session',{headers:{Cookie:cookie}});
  assert.equal(demo.json().user.role,'buyer');
  assert.equal(stableSnapshot(await server.marketplace.admin()),before);
  assert.equal((await request('/api/demo/internal/marketplace/agent',{method:'POST',body:{},headers:{Cookie:cookie,Origin:'http://terminal.test'}})).status,403);
});

test('demo can be disabled without changing production authentication',async t=>{
  const {request}=await setup(t,false);
  for(const route of ['/demo/','/api/demo/auth/session','/api/demo/showcase']) assert.equal((await request(route)).status,404);
  assert.equal((await request('/api/demo/start',{method:'POST',body:{}})).status,404);
  assert.equal((await request('/api/auth/session')).status,200);
});

test('homepage can read the showcase without receiving demo session or production fixtures',async t=>{
  const {request,server}=await setup(t);
  const before=stableSnapshot(await server.marketplace.admin());
  for(const host of ['site.test','terminal.test']){
    const response=await request('/api/demo/showcase',{host});
    assert.equal(response.status,200,response.text);
    assert.equal(response.json().demo,true);
    assert(response.json().featured.supplies.length>=5);
    assert(response.json().featured.rfqs.length>=5);
    assert.equal(response.headers['set-cookie'],undefined);
  }
  for(const host of ['admin.test','unknown.test'])assert.equal((await request('/api/demo/showcase',{host})).status,404);
  assert.equal((await request('/api/demo/showcase',{host:'site.test',method:'POST',body:{}})).status,404);
  const live=await request('/api/marketplace/public',{host:'site.test'});
  assert.deepEqual(live.json().supplies,[]);
  assert.deepEqual(live.json().rfqs,[]);
  assert.equal(stableSnapshot(await server.marketplace.admin()),before);
});
