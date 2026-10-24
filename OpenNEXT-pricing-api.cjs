'use strict';
const crypto=require('node:crypto');
const importedSpotHistory=require('./OpenNEXT-spot-history.cjs');

function equal(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function createPricingRouter(service,{env=process.env,importedHistory=importedSpotHistory,capacity}={}){
  const secret=crypto.randomBytes(32),sessions=new Map();
  const token=String(env.OPENNEXT_ADMIN_TOKEN||'');
  const tokenReady=token.length>=24;
  const send=(res,code,data,headers={})=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));};
  const hostName=req=>{try{return new URL('http://'+req.headers.host).hostname.replace(/^\[|\]$/g,'');}catch{return '';}};
  const local=req=>!req.headers['x-forwarded-for']&&!req.headers['x-forwarded-host']&&!req.headers.forwarded&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&['127.0.0.1','localhost','::1'].includes(hostName(req));
  const sameOrigin=req=>{const raw=req.headers.origin;if(!raw)return local(req);try{return new URL(raw).host===req.headers.host;}catch{return false;}};
  const secure=req=>Boolean(req.socket.encrypted)||(env.OPENNEXT_TRUST_PROXY==='1'&&req.headers['x-forwarded-proto']==='https');
  const bearerAuthenticated=req=>tokenReady&&/^Bearer\s+/i.test(String(req.headers.authorization||''))&&equal(String(req.headers.authorization).replace(/^Bearer\s+/i,''),token);
  function authenticated(req){
    if(local(req))return true;
    if(!tokenReady)return false;
    if(bearerAuthenticated(req))return true;
    const match=String(req.headers.cookie||'').match(/(?:^|;\s*)on_pricing_admin=([^;]+)/);
    if(!match)return false;
    const [id,time,signature]=match[1].split('.');
    if(!id||!time||!signature||Date.now()-Number(time)>30*60*1000||Number(time)>Date.now()+1000)return false;
    const expected=crypto.createHmac('sha256',secret).update(id+'.'+time).digest('hex');
    return equal(signature,expected)&&sessions.get(id)===Number(time);
  }
  async function body(req){
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>8192){const error=Error('Request body is too large');error.status=413;throw error;}chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{const error=Error('Invalid JSON body');error.status=400;throw error;}
  }
  const asProviders=value=>Array.isArray(value)?value:value?.providers||[];
  const asRuns=value=>Array.isArray(value)?value:value?.runs||[];
  function filters(url){
    const out={};for(const key of ['provider','gpuModel','model','region','term','period','instanceType','zone']){const value=url.searchParams.get(key);if(value&&value.length<180)out[key]=value;}
    if(url.searchParams.has('gpuCount'))out.gpuCount=Number(url.searchParams.get('gpuCount'));
    if(url.searchParams.has('gpuMemoryGb'))out.gpuMemoryGb=Number(url.searchParams.get('gpuMemoryGb'));
    if(url.searchParams.has('formFactor'))out.formFactor=url.searchParams.get('formFactor');
    out.limit=Math.min(10000,Math.max(1,Number(url.searchParams.get('limit'))||5000));
    return out;
  }
  function importedFilters(url){
    const out={};
    for(const key of ['gpuModel','model','region','gpuCount','gpuMemoryGb','formFactor','instanceType','period','unit','q','search','term','metric']){
      if(url.searchParams.has(key)){
        const value=url.searchParams.get(key);
        if(value.length>180){const error=Error('History filter is too long');error.status=400;throw error;}
        out[key]=value;
      }
    }
    return out;
  }
  const publicHistoryPaths=new Set(['/api/pricing/regional-history','/api/pricing/capacity-history','/api/pricing/imported-history','/api/pricing/history','/api/pricing/ticker']);
  function publicHistoryPeriod(url,res){
    const requested=url.searchParams.getAll('period');
    const defaultPeriod=url.pathname==='/api/pricing/ticker'?'1W':'3D';
    const period=String(requested[0]||defaultPeriod).trim().toUpperCase()||defaultPeriod;
    if(requested.length>1||!['1D','3D','1W','1M','3M','6M','1Y','ALL'].includes(period)){
      send(res,400,{error:'Invalid history period'});return null;
    }
    if(!['1D','3D','1W','1M','3M'].includes(period)){
      send(res,403,{code:'HISTORY_ACCESS_REQUIRED',error:'Free historical data includes up to 3 months. Contact Sales for access to more history.'});return null;
    }
    return period;
  }
  const route = async function route(req,res,url,{onTerminal=false}={}){
    const path=url.pathname;
    if(!path.startsWith('/api/pricing/')&&!path.startsWith('/api/admin/pricing/'))return false;
    try{
      if(path.startsWith('/api/pricing/')){
        if(req.method!=='GET'){send(res,405,{error:'Read-only endpoint'},{Allow:'GET'});return true;}
        const historyPeriod=publicHistoryPaths.has(path)?publicHistoryPeriod(url,res):null;
        if(publicHistoryPaths.has(path)&&!historyPeriod)return true;
        if(path==='/api/pricing/regional-history'){
          const query=importedFilters(url);
          if(query.metric&&!['min','avg','max'].includes(query.metric)){send(res,400,{error:'Use metric min, avg or max'});return true;}
          if(query.term&&!['Spot','On-demand','Reserved'].includes(query.term)){send(res,400,{error:'Invalid market term'});return true;}
          for(const field of ['gpuCount','gpuMemoryGb'])if(query[field]!==undefined&&(!Number.isFinite(Number(query[field]))||Number(query[field])<0)){send(res,400,{error:'Invalid GPU specification'});return true;}
          if(query.gpuCount!==undefined&&!Number.isInteger(Number(query.gpuCount))){send(res,400,{error:'Invalid GPU count'});return true;}
          query.period=historyPeriod;
          query.term=query.term||'Spot';query.metric=query.metric||'avg';
          if(query.term==='Spot'){
            try{
              const source=await importedHistory.query({...query,unit:'gpu'});
              const result=importedSpotHistory.regionalStatistics(source,query.metric);
              if(result.series.length){send(res,200,result);return true;}
            }catch(error){if(Number(error.status)!==503)throw error;}
          }
          if(!capacity?.queryRegional){send(res,503,{error:'Regional history is not configured'});return true;}
          send(res,200,capacity.queryRegional(query));return true;
        }
        if(path==='/api/pricing/capacity-history'){
          if(!capacity){send(res,503,{error:'Capacity history is not configured'});return true;}
          const query=importedFilters(url);
          for(const field of ['gpuCount','gpuMemoryGb'])if(query[field]!==undefined&&(!Number.isFinite(Number(query[field]))||Number(query[field])<0)){send(res,400,{error:'Invalid GPU specification'});return true;}
          if(query.gpuCount!==undefined&&!Number.isInteger(Number(query.gpuCount))){send(res,400,{error:'Invalid GPU count'});return true;}
          query.period=historyPeriod;
          send(res,200,capacity.query(query));return true;
        }
        if(path==='/api/pricing/ticker'){send(res,200,await importedHistory.ticker({period:historyPeriod}));return true;}
        if(path==='/api/pricing/imported-history'){send(res,200,await importedHistory.query({...importedFilters(url),period:historyPeriod}));return true;}
        if(path==='/api/pricing/history-catalog'){send(res,200,await importedHistory.catalog(importedFilters(url)));return true;}
        if(path==='/api/pricing/prices'){send(res,200,await service.getPrices(filters(url)));return true;}
        if(path==='/api/pricing/history'){send(res,200,await service.getHistory({...filters(url),period:historyPeriod,provider:'aws'}));return true;}
        if(path==='/api/pricing/status'){
          const providers=asProviders(await service.listProviders());
          send(res,200,{providers:providers.map(p=>({id:p.id,name:p.name,status:p.status,recordCount:p.recordCount||0,lastRunAt:p.latestRun?.finishedAt||null})),historyProvider:'aws'});return true;
        }
        send(res,404,{error:'Unknown pricing endpoint'});return true;
      }
      if(onTerminal){send(res,404,{error:'Not found'});return true;}
      const authorized=authenticated(req),access={mutable:authorized,local:local(req),reason:authorized?'Authorized pricing operations':tokenReady?'Administrator sign-in required':'Configure OPENNEXT_ADMIN_TOKEN on the server for remote access'};
      if(path==='/api/admin/pricing/session'&&req.method==='GET'){send(res,200,{access});return true;}
      if(path==='/api/admin/pricing/session'&&req.method==='POST'){
        if(!local(req)&&!secure(req)){send(res,403,{error:'Use HTTPS for administrator sign-in'});return true;}
        if(!sameOrigin(req)){send(res,403,{error:'Origin not allowed'});return true;}
        const data=await body(req);
        if(!tokenReady||!equal(data.token||'',token)){send(res,401,{error:tokenReady?'Administrator sign-in failed':'Server administrator token is not configured'});return true;}
        const id=crypto.randomBytes(24).toString('hex'),time=Date.now();sessions.set(id,time);
        for(const [key,value]of sessions)if(time-value>30*60*1000)sessions.delete(key);
        const value=id+'.'+time,signature=crypto.createHmac('sha256',secret).update(value).digest('hex');
        send(res,200,{ok:true},{'Set-Cookie':`on_pricing_admin=${value}.${signature}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=1800${secure(req)?'; Secure':''}`});return true;
      }
      if(!authorized){send(res,401,{error:access.reason,access});return true;}
      if(!['GET','POST','PATCH'].includes(req.method)){send(res,405,{error:'Method not allowed'});return true;}
      if(req.method!=='GET'&&!sameOrigin(req)&&!bearerAuthenticated(req)){send(res,403,{error:'Origin not allowed'});return true;}
      if(path==='/api/admin/pricing/providers'&&req.method==='GET'){const providers=asProviders(await service.listProviders()).map(p=>({...p,configured:p.credentialConfigured,capabilities:p.supportedTerms,lastRun:p.latestRun?{...p.latestRun,recordCount:p.latestRun.records}:null}));send(res,200,{providers,access});return true;}
      if(path==='/api/admin/pricing/runs'&&req.method==='GET'){send(res,200,{runs:asRuns(await service.listRuns({provider:url.searchParams.get('provider')||undefined}))});return true;}
      const runMatch=path.match(/^\/api\/admin\/pricing\/runs\/([A-Za-z0-9_-]+)$/);
      if(runMatch&&req.method==='GET'){const run=await service.getRun(runMatch[1]);send(res,run?200:404,run||{error:'Run not found'});return true;}
      const match=path.match(/^\/api\/admin\/pricing\/providers\/([a-z0-9-]+)(?:\/(run|test|credential))?$/);
      if(match){
        const [,id,action]=match;
        if(action==='run'&&req.method==='POST'){send(res,202,await service.startRun(id));return true;}
        if(action==='test'&&req.method==='POST'){send(res,200,await service.testProvider(id));return true;}
        if(action==='credential'&&req.method==='POST'){
          if(!local(req)&&!secure(req)){send(res,403,{error:'Use HTTPS to configure provider credentials'});return true;}
          const data=await body(req);
          if(typeof data.credential!=='string'||data.credential.length<5||data.credential.length>4096){send(res,400,{error:'Enter a valid provider credential'});return true;}
          await service.setCredential(id,data.credential);
          send(res,200,{ok:true,configured:true,storage:'server-memory',message:'Credential is kept in server memory only; use environment or a secrets manager for persistence.'});return true;
        }
        if(!action&&req.method==='PATCH'){
          const data=await body(req),update={};
          if(typeof data.enabled==='boolean')update.enabled=data.enabled;
          if(data.intervalMinutes!==undefined){const n=Number(data.intervalMinutes);if(!Number.isInteger(n)||n<10||n>1440){send(res,400,{error:'Interval must be between 10 and 1440 minutes'});return true;}update.intervalMinutes=n;}
          send(res,200,await service.updateProvider(id,update));return true;
        }
      }
      send(res,404,{error:'Unknown pricing operation'});return true;
    }catch(error){
      // Never echo upstream request URLs, authorization headers or provider responses.
      const known=Number(error.status||error.statusCode);
      send(res,[400,401,403,404,409,413,429,501,503].includes(known)?known:500,{error:known===404?'Provider or record not found':known===501?'This connector requires additional integration':known===503&&path.startsWith('/api/pricing/')?'Uploaded history snapshot is not available':'Pricing operation failed. Check the redacted run record for details.'});
      return true;
    }
  };
  // Reuse the same server-side administrator session for private operations.
  // No credential or session secret is exposed to browser code.
  route.security = {authenticated, sameOrigin, bearerAuthenticated, local};
  return route;
}
module.exports={createPricingRouter};
