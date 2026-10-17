'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {createContactService,createContactRouter}=require('../OpenNEXT-contact-service.cjs');
const {createAppServer}=require('../OpenNEXT-preview-server.cjs');
const TOKEN='contact-test-token-01234567890123456789';
const fixture={name:'Test Buyer',company:'Fixture Company',title:'Procurement lead',email:'buyer@example.test',message:'Testing a temporary GPU capacity inquiry.',submissionId:'00000000-0000-4000-8000-000000000001'};

async function setup(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'opennext-contact-test-'));
  const server=createAppServer({dataDir:directory,env:{OPENNEXT_ADMIN_TOKEN:TOKEN,OPENNEXT_TRUST_PROXY:'1'}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
  const address=server.address();
  const request=(url,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:address.port,path:url,method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text)}));
    });req.on('error',reject);req.end(body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body));
  });
  return{request,directory,server,origin:`http://127.0.0.1:${address.port}`};
}

test('contact submission is durable, idempotent, private and actionable in the console',async t=>{
  const {request,directory}=await setup(t);
  let response=await request('/api/contact',{method:'POST',body:fixture});assert.equal(response.status,201);
  const created=response.json();assert.match(created.id,/^CONTACT-[A-F0-9]{8}$/);assert.equal(created.status,'New');assert(!response.text.includes(fixture.email));
  response=await request('/api/contact',{method:'POST',body:fixture});assert.equal(response.json().id,created.id);
  const restored=createContactService({dataDir:directory});let leads=await restored.list();assert.equal(leads.length,1);assert.equal(leads[0].company,fixture.company);assert.equal(leads[0].submissionId,undefined);
  response=await request('/api/admin/contacts');assert.equal(response.status,200);assert.equal(response.json().leads[0].email,fixture.email);
  response=await request('/api/admin/contacts/'+created.id,{method:'PATCH',body:{status:'Qualified',note:'Budget and delivery window confirmed.',updatedAt:leads[0].updatedAt}});assert.equal(response.status,200);assert.equal(response.json().lead.history[0].note,'Budget and delivery window confirmed.');
  leads=await restored.list();assert.equal(leads[0].status,'Qualified');
  assert.equal((await request('/.opennext-data/contact-leads.json')).status,404);
  assert.equal((await request('/OpenNEXT-contact-service.cjs')).status,404);
});

test('private enquiries reject remote or forwarded loopback bypass; shared admin session works',async t=>{
  const {request}=await setup(t);
  for(const headers of [{Host:'admin.example'},{'X-Forwarded-For':'203.0.113.3'},{'X-Forwarded-Host':'admin.example'},{Forwarded:'for=203.0.113.3'}]){
    assert.equal((await request('/api/admin/contacts',{headers})).status,401);
  }
  const remote={Host:'admin.example',Origin:'https://admin.example','X-Forwarded-Proto':'https'};
  let response=await request('/api/admin/pricing/session',{method:'POST',headers:remote,body:{token:TOKEN}});assert.equal(response.status,200);
  const cookie=response.headers['set-cookie'][0];assert.match(cookie,/Path=\/api\/admin;/);
  response=await request('/api/admin/contacts',{headers:{...remote,Cookie:cookie.split(';')[0]}});assert.equal(response.status,200);
  assert.equal((await request('/api/admin/contacts',{headers:{Host:'admin.example',Authorization:'Bearer '+TOKEN}})).status,200);
});

test('contact input is bounded and rejects invalid email, honeypots and wrong content types',async t=>{
  const {request}=await setup(t);
  assert.equal((await request('/api/contact',{method:'POST',body:{...fixture,email:'not-an-email'}})).status,400);
  assert.equal((await request('/api/contact',{method:'POST',body:{...fixture,name:'x'.repeat(101)}})).status,400);
  assert.equal((await request('/api/contact',{method:'POST',body:{...fixture,website:'spam.example'}})).status,400);
  assert.equal((await request('/api/contact',{method:'POST',body:fixture,headers:{'Content-Type':'text/plain'}})).status,415);
  assert.equal((await request('/api/contact',{method:'POST',body:{...fixture,message:'x'.repeat(9000)}})).status,413);
  assert.equal((await request('/api/contact')).status,405);
});

test('CSRF, rate limits, invalid transitions and stale records are rejected',async t=>{
  const {request,origin}=await setup(t);
  assert.equal((await request('/api/contact',{method:'POST',headers:{Origin:'https://evil.example'},body:fixture})).status,403);
  const created=(await request('/api/contact',{method:'POST',headers:{Origin:origin},body:fixture})).json();
  const uri='/api/admin/contacts/'+created.id;
  assert.equal((await request(uri,{method:'PATCH',headers:{Origin:'https://evil.example'},body:{status:'Closed'}})).status,403);
  assert.equal((await request(uri,{method:'PATCH',body:{status:'Paid'}})).status,400);
  assert.equal((await request(uri,{method:'PATCH',body:{status:'Closed',updatedAt:'stale'}})).status,409);
  for(let index=0;index<4;index++)assert.equal((await request('/api/contact',{method:'POST',body:{...fixture,submissionId:'00000000-0000-4000-8000-00000000000'+(index+2)}})).status,201);
  const blocked=await request('/api/contact',{method:'POST',body:fixture});assert.equal(blocked.status,429);assert.equal(blocked.headers['retry-after'],'900');
});

test('failed/corrupt storage is never treated as a successful submission',async t=>{
  const {request,directory}=await setup(t);
  await fs.writeFile(path.join(directory,'contact-leads.json'),'invalid-json');
  const response=await request('/api/contact',{method:'POST',body:fixture});assert.equal(response.status,503);assert.equal(response.json().id,undefined);
});

test('terminal host cannot read contact administration even with an administrator token',async()=>{
  const route=createContactRouter({}, {security:{authenticated:()=>true}});
  let code,body;const response={writeHead:value=>{code=value;},end:value=>{body=JSON.parse(value);}};
  assert.equal(await route({method:'GET'},response,new URL('http://terminal.test/api/admin/contacts'),{onTerminal:true}),true);
  assert.equal(code,404);assert.equal(body.error,'Not found.');
});

test('news snapshot is refreshed as of 17 October without fabricating publication dates',async()=>{
  const {getNews}=require('../OpenNEXT-market-feed.cjs');const news=await getNews();assert.equal(news.asOf,'2026-10-17');assert.match(news.verifiedAt,/^2026-10-17/);assert.equal(news.articles.length,5);
  assert(news.articles.every(article=>article.date<='2026-10-17'&&article.source&&article.summary&&/^https:\/\//.test(article.url)));
  assert.equal(news.articles[0].date,'2026-10-16');
});
