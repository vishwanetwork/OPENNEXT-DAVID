'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','OpenNEXT-terminal.js'),'utf8');
function extract(start,end){
  const first=source.indexOf(start),last=source.indexOf(end,first);
  assert(first>=0&&last>first,'Expected news helper boundaries in Terminal source.');
  return source.slice(first,last);
}
const escapeCode=source.split(/\r?\n/).find(line=>line.startsWith('  const esc='));
const stampCode=source.split(/\r?\n/).find(line=>line.startsWith('  const money='));
const newsCode=extract("  let newsState={status:'loading'",'  function market(){');
const scheduleCode=extract('  refreshNews();',"  window.addEventListener('opennext:marketplace'");
const START=Date.parse('2026-10-18T10:00:00Z');
const article={source:'Publisher News',title:'H200 GPU capacity expands',url:'https://publisher.example/gpu-capacity',publishedAt:'2026-10-16T08:30:00.000Z',date:'2026-10-16'};
const success=(articles=[article],extra={})=>({status:'live',fetchedAt:'2026-10-18T10:00:00.000Z',stale:false,articles,...extra});
const response=data=>({ok:true,json:async()=>data});

function fixture({fetchImpl=async()=>response(success()),schedule=false,mounted=true}={}){
  let clock=START,nextTimer=0;
  const timers=new Map(),intervals=[],events={},calls=[],replacements=[];
  const D={news:[]};
  class TestDate extends Date {static now(){return clock;}}
  const document={hidden:false,addEventListener:(name,handler)=>{events[name]=handler;},createElement:name=>{
    assert.equal(name,'template');let html='';
    return{set innerHTML(value){html=value;},get content(){return{firstElementChild:{html}};}};
  }};
  const context={D,document,Date:TestDate,AbortController,root:{querySelector:selector=>{assert.equal(selector,'.news');return mounted?{replaceWith:element=>replacements.push(element.html)}:null;}},
    fetch:(url,options)=>{calls.push({url,options});return fetchImpl(url,options,calls.length);},
    setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;},
  };
  vm.runInNewContext(escapeCode+'\n'+stampCode+'\n'+newsCode+'\n'+
    'globalThis.testNews={render:news,refresh:refreshNews,setState:value=>{newsState=value;},getState:()=>newsState,getPending:()=>newsPending,getLastCheck:()=>lastNewsCheck};'+
    (schedule?'\n'+scheduleCode:''),context);
  return{api:context.testNews,D,document,timers,intervals,events,calls,replacements,advance:ms=>{clock+=ms;}};
}

test('loading and healthy empty news have distinct honest messages',()=>{
  const f=fixture();
  let html=f.api.render();
  assert.match(html,/Checking official sources/);assert.match(html,/Checking official GPU news sources/);
  assert.doesNotMatch(html,/temporarily unavailable|class="news-card"/);
  f.api.setState(success([],{status:'empty'}));html=f.api.render();
  assert.match(html,/No recent GPU-market headlines were found in the connected sources/);
  assert.match(html,/Checked 18 Oct/);assert.match(html,/Hourly refresh/);
  assert.doesNotMatch(html,/temporarily unavailable|Checking official GPU/);
});

test('disabled news shows an operator pause and never promises hourly updates',()=>{
  const f=fixture();f.api.setState({status:'disabled',fetchedAt:null,stale:true});
  const html=f.api.render();
  assert.match(html,/Updates paused/);assert.match(html,/News updates are paused by the operator/);
  assert.doesNotMatch(html,/Hourly refresh|retry automatically/);
});

test('populated cards win over the empty-state expression and retain original publication dates',()=>{
  const f=fixture();f.D.news.push(article);f.api.setState(success());
  const html=f.api.render();
  assert.match(html,/Checked 18 Oct/);
  assert.match(html,/Publisher News · 16 Oct 2026/);
  assert.match(html,/<h4>H200 GPU capacity expands<\/h4>/);
  assert.equal((html.match(/class="news-card"/g)||[]).length,1);
  assert.doesNotMatch(html,/api-empty-row|temporarily unavailable|<\/a><\/p>/);
});

test('partial and stale states keep existing cards with accurate freshness warnings',()=>{
  const f=fixture();f.D.news.push(article);f.api.setState(success([article],{status:'partial',stale:true}));
  let html=f.api.render();
  assert.match(html,/Some sources unavailable/);assert.match(html,/Cached data/);assert.match(html,/class="news-card"/);
  f.api.setState(success([article],{status:'cached',stale:true}));html=f.api.render();
  assert.match(html,/Cached data/);assert.doesNotMatch(html,/Some sources unavailable/);
  assert.match(html,/Publisher News · 16 Oct 2026/);
});

test('news escapes source, title and href attributes and rejects non-HTTPS links',()=>{
  const f=fixture();f.api.setState(success());f.D.news.push(
    {...article,source:'<img src=x onerror="attack()">',title:'GPU <script>attack()</script> & pricing',url:'https://publisher.example/story?q=" onmouseover="attack()'},
    {...article,url:'javascript:attack()'},
    {...article,url:'data:text/html,attack()'},
    {...article,url:'http://publisher.example/story'},
  );
  const html=f.api.render();
  assert.equal((html.match(/class="news-card"/g)||[]).length,1);
  assert.match(html,/&lt;img src=x onerror=&quot;attack\(\)&quot;&gt;/);
  assert.match(html,/GPU &lt;script&gt;attack\(\)&lt;\/script&gt; &amp; pricing/);
  assert.match(html,/href="https:\/\/publisher\.example\/story\?q=&quot; onmouseover=&quot;attack\(\)"/);
  assert.match(html,/target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html,/<script>|<img |javascript:|data:text\/html|" onmouseover="/);
});

test('a successful refresh replaces stale articles and updates the mounted panel',async()=>{
  const f=fixture();f.D.news.push({...article,title:'Older headline'});
  await f.api.refresh();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/api/news');assert.ok(f.calls[0].options.signal instanceof AbortSignal);
  assert.equal(f.api.getPending(),null);assert.equal(f.timers.size,0);assert.equal(f.api.getState().status,'live');
  assert.equal(f.D.news.length,1);assert.equal(f.D.news[0].title,article.title);
  assert.equal(f.replacements.length,1);assert.match(f.replacements[0],/H200 GPU capacity expands/);assert.doesNotMatch(f.replacements[0],/Older headline|api-empty-row/);
});

test('failed HTTP refresh retains cached articles and permits the next request',async()=>{
  const f=fixture({fetchImpl:async()=>({ok:false,json:async()=>({error:'Unavailable'})})});
  f.D.news.push(article);f.api.setState(success());
  await f.api.refresh();
  assert.equal(f.api.getState().status,'unavailable');assert.equal(f.api.getState().stale,true);
  assert.equal(f.D.news[0].title,article.title);assert.equal(f.api.getPending(),null);assert.equal(f.timers.size,0);
  assert.match(f.replacements[0],/Cached data/);assert.match(f.replacements[0],/class="news-card"/);
  await f.api.refresh();assert.equal(f.calls.length,2);
});

test('20-second timeout aborts the request, releases newsPending and allows a successful retry',async()=>{
  const f=fixture({fetchImpl:async(url,{signal},count)=>{
    if(count>1)return response(success());
    return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true}));
  }});
  const pending=f.api.refresh();
  assert.equal(f.api.refresh(),pending);assert.equal(f.calls.length,1);assert.equal(f.timers.size,1);
  const timer=[...f.timers.values()][0];assert.equal(timer.ms,20000);timer.fn();await pending;
  assert.equal(f.calls[0].options.signal.aborted,true);assert.equal(f.api.getPending(),null);assert.equal(f.timers.size,0);
  assert.equal(f.api.getState().status,'unavailable');
  await f.api.refresh();assert.equal(f.calls.length,2);assert.equal(f.api.getState().status,'live');assert.equal(f.api.getPending(),null);
});

test('foreground hourly updates pause in hidden tabs and resume when a stale tab becomes visible',async()=>{
  const f=fixture({schedule:true});await f.api.getPending();
  assert.equal(f.calls.length,1);assert.equal(f.intervals.length,1);assert.equal(f.intervals[0].ms,3600000);
  f.document.hidden=true;f.advance(3600000);f.intervals[0].fn();assert.equal(f.calls.length,1);
  f.events.visibilitychange();assert.equal(f.calls.length,1);
  f.document.hidden=false;f.events.visibilitychange();await f.api.getPending();assert.equal(f.calls.length,2);
  f.events.visibilitychange();assert.equal(f.calls.length,2);
  f.advance(3600000);f.intervals[0].fn();await f.api.getPending();assert.equal(f.calls.length,3);
});

test('news refresh also works while the market panel is not mounted',async()=>{
  const f=fixture({mounted:false});await f.api.refresh();
  assert.equal(f.api.getState().status,'live');assert.equal(f.replacements.length,0);assert.equal(f.api.getPending(),null);
});
