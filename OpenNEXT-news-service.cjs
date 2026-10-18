'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_ARTICLES = 120;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
// Publisher-owned syndication endpoints. Only headlines and short feed excerpts
// are retained; readers follow the original publisher link for the full article.
// NVIDIA RSS is not enabled: its published terms restrict commercial use.
const SOURCES = Object.freeze([
  {id:'aws-announcements', name:'AWS Announcements', url:'https://aws.amazon.com/about-aws/whats-new/recent/feed/', articleHosts:['aws.amazon.com']},
  {id:'aws-news', name:'AWS News Blog', url:'https://aws.amazon.com/blogs/aws/feed/', articleHosts:['aws.amazon.com']},
  {id:'amd-news', name:'AMD Newsroom', url:'https://ir.amd.com/news-events/press-releases/rss', articleHosts:['ir.amd.com','www.amd.com','amd.com','newsroom.amd.com']},
]);

function decodeEntities(value) {
  const names = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] !== '#') return names[entity.toLowerCase()] || match;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : parseInt(entity.slice(1),10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}

function plainText(value, limit=300) {
  return decodeEntities(String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1'))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
}

function tag(block, name) {
  return block.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'\\s*>','i'))?.[1] || '';
}

function canonicalUrl(value, source) {
  try {
    const url = new URL(decodeEntities(String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')).trim());
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (!source.articleHosts.includes(url.hostname.toLowerCase())) return null;
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.hash = '';
    return url.toString().replace(/\/$/,'');
  } catch { return null; }
}

function isGpuRelevant(title, description='') {
  const hardware=/\b(?:GPUs?|CUDA|NVLink|NVSwitch|InfiniBand|Blackwell|Hopper|Rubin|Instinct|MI(?:300|325|350|355|400|450)\w*|[ABH](?:100|200|300)|GB(?:200|300)|L40S|RTX|Radeon|graphics processing|accelerated computing|AI (?:compute|infrastructure)|GPU-hours?)\b/i;
  if(hardware.test(title))return true;
  // A generic AI model/sign-in announcement or region-failover article should
  // not qualify merely because its long description happens to mention a GPU.
  const market=/\b(?:capacity|instances?|infrastructure|compute|servers?|data cent(?:er|re)s?|pricing|supply|demand|chips?|semiconductors?|partnership|investment|acquisition)\b/i;
  return market.test(title) && hardware.test(description.slice(0,1200));
}

function parseFeed(xml, source, now=Date.now()) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml,'utf8') > MAX_FEED_BYTES) throw new Error('Feed exceeds the size limit.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('External XML declarations are not supported.');
  if (!/<(?:rss|feed)\b/i.test(xml) || !/<\/(?:rss|feed)\s*>/i.test(xml)) throw new Error('The publisher did not return a complete RSS or Atom feed.');
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi)].map(match=>match[2]);
  const articles = [];
  for (const block of blocks) {
    const title = plainText(tag(block,'title'),240);
    const description = plainText(tag(block,'description') || tag(block,'summary') || tag(block,'content:encoded') || tag(block,'content'),12000);
    const href = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].find(match=>! /rel\s*=\s*["'](?:self|enclosure)["']/i.test(match[1]))?.[1].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    const url = canonicalUrl(tag(block,'link') || href, source);
    const rawDate = plainText(tag(block,'pubDate') || tag(block,'published') || tag(block,'dc:date') || tag(block,'updated'));
    const published = Date.parse(rawDate);
    if (!title || !url || !Number.isFinite(published) || published > now + 5*60*1000 || published < now - MAX_AGE_MS || !isGpuRelevant(title,description)) continue;
    const publishedAt = new Date(published).toISOString();
    articles.push({id:'NEWS-'+crypto.createHash('sha256').update(url).digest('hex').slice(0,16),sourceId:source.id,source:source.name,title,url,publishedAt,date:publishedAt.slice(0,10),summary:description.slice(0,180).trim(),fetchedAt:new Date(now).toISOString()});
  }
  return mergeArticles(articles, now);
}

function mergeArticles(articles, now) {
  const urls = new Set(), headlines = new Set();
  return articles.filter(article=>article && Date.parse(article.publishedAt) <= now+5*60*1000 && Date.parse(article.publishedAt) >= now-MAX_AGE_MS)
    .sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))
    .filter(article=>{
      const headline = article.title.toLowerCase().replace(/[^a-z0-9]/g,'');
      if (urls.has(article.url) || headlines.has(headline)) return false;
      urls.add(article.url);headlines.add(headline);return true;
    }).slice(0,MAX_ARTICLES);
}

async function readBounded(response) {
  if (Number(response.headers?.get?.('content-length')) > MAX_FEED_BYTES) throw new Error('Feed exceeds the size limit.');
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text,'utf8') > MAX_FEED_BYTES) throw new Error('Feed exceeds the size limit.');
    return text;
  }
  const reader = response.body.getReader();const chunks=[];let size=0;
  try {
    while (true) {
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>MAX_FEED_BYTES){await reader.cancel();throw new Error('Feed exceeds the size limit.');}
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {reader.releaseLock();}
}

function createNewsService(options={}) {
  const env = options.env || process.env;
  const enabled = env.OPENNEXT_NEWS_ENABLED !== '0';
  const sources = (options.sources || SOURCES).map(source=>({...source,articleHosts:[...source.articleHosts]}));
  for (const source of sources) {
    const url = new URL(source.url);
    if(url.protocol!=='https:' || url.username || url.password || !source.id || !source.articleHosts.length) throw new Error('Invalid news source configuration.');
  }
  const dataDir=options.dataDir || env.OPENNEXT_DATA_DIR || path.join(__dirname,'.opennext-data');
  const cacheFile=path.join(dataDir,'market-news.json');
  const fetchImpl=options.fetchImpl || globalThis.fetch;
  const now=options.now || Date.now;
  const setTimer=options.setTimeout || setTimeout,clearTimer=options.clearTimeout || clearTimeout;
  const interval=REFRESH_INTERVAL_MS;
  let articles=[],fetchedAt=null,lastAttemptAt=null,nextRefreshAt=null,started=false,closed=false,timer=null,pending=null,cacheError=null;
  const states=new Map(sources.map(source=>[source.id,{id:source.id,name:source.name,url:source.url,status:'pending',lastSuccessAt:null,itemCount:0,etag:null,lastModified:null}]));
  const controllers=new Set();
  const ready=(async()=>{
    try {
      const stat=await fs.stat(cacheFile);if(stat.size>4*MAX_FEED_BYTES)throw new Error('Invalid news cache.');
      const saved=JSON.parse(await fs.readFile(cacheFile,'utf8'));
      if(saved.version!==1 || !Array.isArray(saved.articles))throw new Error('Invalid news cache.');
      articles=mergeArticles(saved.articles.filter(article=>{
        const source=sources.find(item=>item.id===article.sourceId);
        return source && typeof article.title==='string' && article.title.length<=240 && canonicalUrl(article.url,source)===article.url && typeof article.summary==='string' && article.summary.length<=180 && isGpuRelevant(article.title,article.summary) && Number.isFinite(Date.parse(article.fetchedAt));
      }),now());
      fetchedAt=Number.isFinite(Date.parse(saved.fetchedAt)) && Date.parse(saved.fetchedAt)<=now()?saved.fetchedAt:null;
      lastAttemptAt=Number.isFinite(Date.parse(saved.lastAttemptAt)) && Date.parse(saved.lastAttemptAt)<=now()?saved.lastAttemptAt:null;
      for(const savedState of saved.sources || [])if(states.has(savedState.id))states.set(savedState.id,{...states.get(savedState.id),status:savedState.status==='error'?'error':'cached',lastSuccessAt:Number.isFinite(Date.parse(savedState.lastSuccessAt))?savedState.lastSuccessAt:null,itemCount:articles.filter(article=>article.sourceId===savedState.id).length,etag:typeof savedState.etag==='string'?savedState.etag.slice(0,512):null,lastModified:typeof savedState.lastModified==='string'?savedState.lastModified.slice(0,128):null});
    } catch(error) {if(error.code!=='ENOENT')cacheError='The saved news cache could not be read.';}
  })();

  function result() {
    const stateList=[...states.values()];
    const failures=stateList.filter(source=>source.status==='error').length;
    const stale=!fetchedAt || now()-Date.parse(fetchedAt)>=interval || failures>0;
    const status=!enabled?'disabled':failures===sources.length?(articles.length?'cached':'unavailable'):failures?'partial':!fetchedAt?'empty':stale?'cached':articles.length?'live':'empty';
    return {status,mode:'hourly-rss',fetchedAt,lastAttemptAt,nextRefreshAt,refreshIntervalMs:interval,stale,refreshing:!!pending,articles:articles.map(article=>({...article})),sources:stateList.map(({etag,lastModified,...source})=>({...source})),errors:[...stateList.filter(source=>source.status==='error').map(source=>({sourceId:source.id,message:'The publisher feed could not be refreshed. Cached articles are retained.'})),...(cacheError?[{sourceId:'cache',message:cacheError}]:[])]};
  }

  async function persist() {
    try {
      await fs.mkdir(dataDir,{recursive:true});
      const temp=cacheFile+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';
      try {await fs.writeFile(temp,JSON.stringify({version:1,articles,fetchedAt,lastAttemptAt,sources:[...states.values()]})+'\n',{mode:0o600});await fs.rename(temp,cacheFile);}
      finally {await fs.unlink(temp).catch(()=>{});}
      cacheError=null;
    } catch {cacheError='News was refreshed in memory, but the cache could not be saved.';}
  }

  function schedule() {
    if(timer)clearTimer(timer);timer=null;
    if(!started || closed || !enabled){nextRefreshAt=null;return;}
    const delay=Math.max(1,interval-(lastAttemptAt?Math.max(0,now()-Date.parse(lastAttemptAt)):interval));
    nextRefreshAt=new Date(now()+delay).toISOString();
    timer=setTimer(()=>{timer=null;refresh().catch(()=>{});},delay);timer?.unref?.();
  }

  async function poll(source) {
    const state=states.get(source.id);const abort=new AbortController();controllers.add(abort);
    let timeout,active=true;
    try {
      const request=(async()=>{
        const headers={Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml','User-Agent':'OpenNEXT-Market-News/1.0 (+https://opennextlab.ai)'};
        if(state.etag)headers['If-None-Match']=state.etag;
        if(state.lastModified)headers['If-Modified-Since']=state.lastModified;
        const response=await fetchImpl(source.url,{signal:abort.signal,headers,redirect:'error'});
        if(!active || closed)throw new Error('Publisher request was cancelled.');
        if(response.status===304){state.status='unchanged';state.lastSuccessAt=new Date(now()).toISOString();return [];}
        if(!response.ok)throw new Error('Publisher request failed.');
        const parsed=parseFeed(await readBounded(response),source,now());
        if(!active || closed)throw new Error('Publisher request was cancelled.');
        state.etag=response.headers?.get?.('etag') || null;state.lastModified=response.headers?.get?.('last-modified') || null;
        state.status='ok';state.lastSuccessAt=new Date(now()).toISOString();state.itemCount=parsed.length;
        return parsed;
      })();
      const bounded=new Promise((_,reject)=>{timeout=setTimeout(()=>{abort.abort();reject(new Error('Publisher request timed out.'));},options.fetchTimeoutMs || FETCH_TIMEOUT_MS);});
      return await Promise.race([request,bounded]);
    } catch {state.status='error';return null;}
    finally {active=false;clearTimeout(timeout);controllers.delete(abort);}
  }

  function refresh() {
    if(pending)return pending;
    pending=(async()=>{
      await ready;
      if(closed || !enabled)return result();
      lastAttemptAt=new Date(now()).toISOString();
      const batches=await Promise.all(sources.map(poll));
      const successful=batches.filter(batch=>batch!==null);
      if(successful.length){articles=mergeArticles([...successful.flat(),...articles],now());fetchedAt=new Date(now()).toISOString();}
      await persist();
      return result();
    })().finally(()=>{pending=null;schedule();});
    return pending.then(()=>result());
  }

  async function getNews() {
    await ready;
    if(enabled && !closed && (!lastAttemptAt || now()-Date.parse(lastAttemptAt)>=interval)) {
      if(!articles.length)return refresh();
      refresh().catch(()=>{});
    }
    return result();
  }

  async function start() {
    await ready;if(started || closed || !enabled)return result();started=true;
    if(!lastAttemptAt || now()-Date.parse(lastAttemptAt)>=interval)return refresh();
    schedule();return result();
  }

  async function close() {
    closed=true;started=false;nextRefreshAt=null;if(timer)clearTimer(timer);timer=null;
    for(const controller of controllers)controller.abort();
    if(pending)await pending.catch(()=>{});
  }
  return {getNews,refresh,start,close};
}

module.exports={createNewsService,SOURCES,REFRESH_INTERVAL_MS,parseFeed,isGpuRelevant,mergeArticles};
