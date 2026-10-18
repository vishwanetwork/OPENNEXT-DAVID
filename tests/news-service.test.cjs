'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createNewsService,parseFeed,isGpuRelevant,REFRESH_INTERVAL_MS,SOURCES}=require('../OpenNEXT-news-service.cjs');
const SOURCE={id:'publisher',name:'Publisher',url:'https://news.example.test/rss',articleHosts:['news.example.test']};
const START=Date.parse('2026-10-18T00:00:00Z');
const item=(overrides={})=>`<item><title>${overrides.title||'H200 GPU capacity expands'}</title><link>${overrides.url||'https://news.example.test/h200'}</link><pubDate>${overrides.date||'Sat, 17 Oct 2026 10:00:00 GMT'}</pubDate><description>${overrides.description||'Dedicated GPU capacity becomes available in a new region.'}</description></item>`;
const rss=(...items)=>`<?xml version="1.0"?><rss version="2.0"><channel>${items.join('')}</channel></rss>`;
const response=(text,status=200,headers={})=>({ok:status>=200&&status<300,status,headers:new Headers(headers),text:async()=>text});
async function setup(t,options={}){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'opennext-news-test-'));
  let clock=START;
  const service=createNewsService({dataDir,now:()=>clock,sources:[SOURCE],fetchImpl:async()=>response(rss(item())),...options});
  t.after(async()=>{await service.close();await fs.rm(dataDir,{recursive:true,force:true});});
  return{service,dataDir,advance:ms=>{clock+=ms;}};
}

test('official sources are fixed HTTPS feeds and do not enable restricted NVIDIA RSS',()=>{
  assert.equal(REFRESH_INTERVAL_MS,3600000);
  assert.equal(SOURCES.length,3);
  assert(SOURCES.every(source=>source.url.startsWith('https://')));
  assert(!SOURCES.some(source=>source.url.includes('nvidia')));
});

test('RSS decoding, source attribution and publication timestamps are preserved',()=>{
  const articles=parseFeed(rss(item({title:'<![CDATA[H200 &amp; H100 capacity <b>expands</b>]]>',url:'https://news.example.test/h200/?utm_source=feed#top',description:'<![CDATA[<script>alert(1)</script><p>GPU capacity &amp; pricing.</p>]]>'})),SOURCE,START);
  assert.equal(articles.length,1);
  assert.equal(articles[0].title,'H200 & H100 capacity expands');
  assert.equal(articles[0].summary,'GPU capacity & pricing.');
  assert.equal(articles[0].url,'https://news.example.test/h200');
  assert.equal(articles[0].publishedAt,'2026-10-17T10:00:00.000Z');
  assert.equal(articles[0].fetchedAt,'2026-10-18T00:00:00.000Z');
  assert.equal(articles[0].source,'Publisher');
});

test('Atom alternate links, published dates and encoded titles are supported',()=>{
  const feed='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>AMD Instinct GPU availability</title><link rel="self" href="https://news.example.test/api/1"/><link rel="alternate" href="https://news.example.test/amd"/><published>2026-10-16T10:00:00Z</published><summary>GPU infrastructure capacity.</summary></entry></feed>';
  const article=parseFeed(feed,SOURCE,START)[0];
  assert.equal(article.url,'https://news.example.test/amd');
  assert.equal(article.date,'2026-10-16');
});

test('irrelevant, future, missing-date, old, off-domain and unsafe links are not published',()=>{
  const rows=[
    item({title:'New office collaboration templates',description:'Workflow news',url:'https://news.example.test/office'}),
    item({date:'Sun, 19 Oct 2026 10:00:00 GMT',url:'https://news.example.test/future'}),
    item({date:'not a date',url:'https://news.example.test/no-date'}),
    item({date:'Fri, 01 May 2026 10:00:00 GMT',url:'https://news.example.test/old'}),
    item({url:'https://evil.example/gpu'}),item({url:'javascript:alert(1)'}),item({url:'https://user:pass@news.example.test/gpu'}),item({url:'https://news.example.test:444/gpu'}),
  ];
  assert.deepEqual(parseFeed(rss(...rows),SOURCE,START),[]);
  assert.equal(isGpuRelevant('General AI assistant release','Office productivity'),false);
  assert.equal(isGpuRelevant('NVIDIA B300 accelerated computing capacity'),true);
  assert.equal(isGpuRelevant('SageMaker Studio introduces new sign-in options','Includes GPU instances for training.'),false);
  assert.equal(isGpuRelevant('ARC Region switch adds capabilities','Restores GPU compute capacity during a failover.'),false);
  assert.equal(isGpuRelevant('EC2 G7 instances expand to new regions','Powered by NVIDIA Blackwell GPUs.'),true);
});

test('duplicate URLs and syndication titles do not create duplicate cards',()=>{
  const articles=parseFeed(rss(item(),item({url:'https://news.example.test/h200?utm_campaign=test'}),item({url:'https://news.example.test/copy'})),SOURCE,START);
  assert.equal(articles.length,1);
});

test('malformed feeds, XML external entities and oversized input are rejected',()=>{
  assert.throws(()=>parseFeed('<html>Not a feed</html>',SOURCE,START));
  assert.throws(()=>parseFeed('<rss><channel>',SOURCE,START));
  assert.throws(()=>parseFeed('<!DOCTYPE rss SYSTEM "file:///etc/passwd">'+rss(item()),SOURCE,START));
  assert.throws(()=>parseFeed(rss(item({description:'x'.repeat(2*1024*1024)})),SOURCE,START));
});

test('collection is persisted and restored without changing original dates or refetching early',async t=>{
  let requests=0;
  const {service,dataDir}=await setup(t,{fetchImpl:async()=>{requests++;return response(rss(item()));}});
  const news=await service.getNews();
  assert.equal(news.status,'live');assert.equal(news.mode,'hourly-rss');assert.equal(requests,1);assert.equal(news.stale,false);
  assert.equal(news.articles.length,1);
  await service.close();
  const restored=createNewsService({dataDir,now:()=>START+1000,sources:[SOURCE],fetchImpl:async()=>{throw new Error('Unexpected fetch');}});
  t.after(()=>restored.close());
  const fromDisk=await restored.getNews();
  assert.deepEqual(fromDisk.articles,news.articles);
  assert.equal(fromDisk.fetchedAt,news.fetchedAt);
  const saved=JSON.parse(await fs.readFile(path.join(dataDir,'market-news.json'),'utf8'));
  assert.equal(saved.version,1);
});

test('failed refresh preserves cached news and its original successful fetch timestamp',async t=>{
  let fail=false;
  const {service,advance}=await setup(t,{fetchImpl:async()=>{if(fail)throw new Error('offline');return response(rss(item()));}});
  const first=await service.refresh();fail=true;advance(REFRESH_INTERVAL_MS);
  const failed=await service.refresh();
  assert.equal(failed.status,'cached');assert.equal(failed.stale,true);assert.equal(failed.articles.length,1);
  assert.equal(failed.fetchedAt,first.fetchedAt);assert.notEqual(failed.lastAttemptAt,first.lastAttemptAt);
  assert.equal(failed.sources[0].status,'error');assert.equal(failed.errors.length,1);
});

test('first-run failure yields an honest empty unavailable result, never static invented articles',async t=>{
  const {service}=await setup(t,{fetchImpl:async()=>{throw new Error('offline');}});
  const news=await service.getNews();
  assert.equal(news.status,'unavailable');assert.equal(news.fetchedAt,null);assert.deepEqual(news.articles,[]);
});

test('partial publisher failure keeps healthy-source updates and reports the failed source',async t=>{
  const other={...SOURCE,id:'other',name:'Other publisher',url:'https://news.example.test/other-rss'};
  const {service}=await setup(t,{sources:[SOURCE,other],fetchImpl:async url=>{if(url.endsWith('other-rss'))throw new Error('offline');return response(rss(item()));}});
  const news=await service.refresh();
  assert.equal(news.status,'partial');assert.equal(news.articles.length,1);assert.equal(news.sources.length,2);assert.equal(news.errors[0].sourceId,'other');
});

test('conditional requests preserve unchanged articles and confirm a successful poll',async t=>{
  let count=0,headers;
  const {service,advance}=await setup(t,{fetchImpl:async(url,options)=>{headers=options.headers;return ++count===1?response(rss(item()),200,{etag:'"version-1"','last-modified':'Sat, 17 Oct 2026 10:00:00 GMT'}):response('',304);}});
  const first=await service.refresh();advance(REFRESH_INTERVAL_MS);
  const next=await service.refresh();
  assert.equal(headers['If-None-Match'],'"version-1"');
  assert.equal(headers['If-Modified-Since'],'Sat, 17 Oct 2026 10:00:00 GMT');
  assert.deepEqual(next.articles,first.articles);assert.notEqual(next.fetchedAt,first.fetchedAt);assert.equal(next.sources[0].status,'unchanged');
});

test('simultaneous readers share one publisher refresh',async t=>{
  let calls=0;
  const {service}=await setup(t,{fetchImpl:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));return response(rss(item()));}});
  const results=await Promise.all([service.getNews(),service.getNews(),service.refresh()]);
  assert.equal(calls,1);assert(results.every(result=>result.articles.length===1));
});

test('hourly background refresh works without open browser requests and stops on close',async t=>{
  let callback,delay,clears=0,requests=0;
  const {service,advance}=await setup(t,{setTimeout:(fn,ms)=>{callback=fn;delay=ms;return{unref(){}};},clearTimeout:()=>{clears++;},fetchImpl:async()=>{requests++;return response(rss(item()));}});
  await service.start();assert.equal(requests,1);assert.equal(delay,REFRESH_INTERVAL_MS);
  assert.equal((await service.getNews()).nextRefreshAt,'2026-10-18T01:00:00.000Z');
  advance(REFRESH_INTERVAL_MS);callback();await service.refresh();
  assert.equal(requests,2);assert.equal(delay,REFRESH_INTERVAL_MS);
  await service.close();assert(clears>0);assert.equal((await service.getNews()).nextRefreshAt,null);
});

test('disabled service does not fetch or schedule',async t=>{
  const {service}=await setup(t,{env:{OPENNEXT_NEWS_ENABLED:'0'},fetchImpl:async()=>{throw new Error('Unexpected fetch');},setTimeout:()=>{throw new Error('Unexpected timer');}});
  await service.start();const news=await service.getNews();assert.equal(news.status,'disabled');assert.equal(news.nextRefreshAt,null);assert.equal(news.lastAttemptAt,null);
});

test('bounded requests timeout safely even when a transport ignores AbortSignal',async t=>{
  const {service}=await setup(t,{fetchTimeoutMs:15,fetchImpl:()=>new Promise(()=>{})});
  const news=await service.getNews();assert.equal(news.status,'unavailable');assert.equal(news.articles.length,0);
});

test('corrupt disk cache does not become a false success and recovers after a valid fetch',async t=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'opennext-news-corrupt-'));
  await fs.writeFile(path.join(dataDir,'market-news.json'),'{broken');
  const service=createNewsService({dataDir,now:()=>START,sources:[SOURCE],fetchImpl:async()=>response(rss(item()))});
  t.after(async()=>{await service.close();await fs.rm(dataDir,{recursive:true,force:true});});
  const news=await service.getNews();assert.equal(news.status,'live');assert.equal(news.errors.length,0);assert.equal(news.articles.length,1);
});
