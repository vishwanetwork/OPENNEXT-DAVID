(function(scope) {
  'use strict';
  const PERIODS={'24H':'1D','3D':'3D','7D':'1W','1M':'1M'};
  const TERMS=['Spot','On-demand','Reserved'];
  const METRICS={max:'Maximum',avg:'Average',min:'Minimum'};
  const TTL=300000,requests=new Map(),sessions=new Map(),targets=new WeakMap();
  const countries={
    'af-south-1':'South Africa','ap-east-1':'Hong Kong','ap-east-2':'Taiwan',
    'ap-northeast-1':'Japan','ap-northeast-2':'South Korea','ap-northeast-3':'Japan',
    'ap-south-1':'India','ap-south-2':'India','ap-southeast-1':'Singapore',
    'ap-southeast-2':'Australia','ap-southeast-3':'Indonesia','ap-southeast-4':'Australia',
    'ap-southeast-5':'Malaysia','ap-southeast-6':'New Zealand','ap-southeast-7':'Thailand',
    'ca-central-1':'Canada','ca-west-1':'Canada','cn-north-1':'China','cn-northwest-1':'China',
    'eu-central-1':'Germany','eu-central-2':'Switzerland','eu-north-1':'Sweden',
    'eu-south-1':'Italy','eu-south-2':'Spain','eu-west-1':'Ireland','eu-west-2':'United Kingdom','eu-west-3':'France',
    'il-central-1':'Israel','me-central-1':'United Arab Emirates','me-south-1':'Bahrain',
    'mx-central-1':'Mexico','sa-east-1':'Brazil','us-east-1':'United States','us-east-2':'United States',
    'us-west-1':'United States','us-west-2':'United States','us-gov-east-1':'United States','us-gov-west-1':'United States'
  };
  const cityCountries={'cape town':'South Africa','hong kong':'Hong Kong','tokyo':'Japan','osaka':'Japan','seoul':'South Korea',mumbai:'India',hyderabad:'India',singapore:'Singapore',sydney:'Australia',melbourne:'Australia',jakarta:'Indonesia',malaysia:'Malaysia','canada central':'Canada',frankfurt:'Germany',zurich:'Switzerland',stockholm:'Sweden',milan:'Italy',spain:'Spain',ireland:'Ireland',dublin:'Ireland',london:'United Kingdom',paris:'France','tel aviv':'Israel',uae:'United Arab Emirates',dubai:'United Arab Emirates','sao paulo':'Brazil','n. virginia':'United States',ohio:'United States','n. california':'United States',oregon:'United States'};
  let catalog={loaded:false,loadedAt:0,models:[],regions:[],rows:[],raw:[],pending:null};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=value=>String(value??'').trim().toLowerCase();
  const positive=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))&&Number(value)>0;
  function countryFor(region,details={}){
    const code=String(region||'').trim().toLowerCase();
    if(countries[code])return countries[code];
    if(details.country)return normalizeCountry(details.country);
    return cityCountries[norm(details.city)]||cityCountries[norm(details.name)]||cityCountries[code]||Object.values(countries).find(value=>norm(value)===code)||null;
  }
  function normalizeCountry(value){const code=norm(value);return ({usa:'United States',us:'United States',uk:'United Kingdom',uae:'United Arab Emirates',korea:'South Korea'})[code]||String(value||'').trim();}
  function optionsCopy(options={}){
    return {range:PERIODS[options.range]?options.range:null,term:TERMS.includes(options.term)?options.term:'All',selected:Object.fromEntries(['model','country','vcpu','memory'].map(key=>[key,Array.isArray(options.selected?.[key])?[...new Set(options.selected[key].map(String))]:[]]))};
  }
  function session(ctx){
    const key=String(scope.OpenNEXTAuth?.getUser?.()?.id||ctx?.S?.identity?.email||'local')+':'+String(ctx?.S?.role||'Seller');
    if(!sessions.has(key))sessions.set(key,{model:'H100',term:'Spot',metrics:['avg']});
    return sessions.get(key);
  }
  function modelInfo(label){
    const direct=scope.ONMarket?.catalog?.find(row=>row.name===label),known=[...new Set([...catalog.models,...(scope.ONMarket?.catalog||[]).map(row=>row.canonical)])].filter(Boolean).sort((a,b)=>b.length-a.length);
    const base=direct?.canonical||known.find(value=>norm(label)===norm(value)||norm(label).startsWith(norm(value)+' '))||String(label||'H100').replace(/\s+(SXM|PCIe|NVL72)(?:\s.*)?$/i,'');
    const form=/\b(SXM|PCIe|NVL72)\b/i.exec(String(label))?.[1]||null;
    const memory=/\b(\d+(?:\.\d+)?)\s*GB\b/i.exec(String(label));
    return {base,form,memory:memory?Number(memory[1]):null};
  }
  function availableModels(options){
    if(options.selected.model.length)return options.selected.model;
    return [...new Set(['H100',...catalog.models,...(scope.ONMarket?.catalog||[]).map(row=>row.canonical).filter(Boolean)])];
  }
  function synchronize(ctx,options){
    const state=session(ctx),models=availableModels(options);
    if(!models.includes(state.model))state.model=models.includes('H100')?'H100':models[0]||'H100';
    return {state,models,term:options.term==='All'?state.term:options.term};
  }
  async function cached(url){
    const existing=requests.get(url),now=Date.now();
    if(existing?.pending)return existing.pending;
    if(existing&&now-existing.at<(existing.error?30000:TTL)){if(existing.error)throw existing.error;return existing.data;}
    const entry={at:now,pending:null};
    entry.pending=(async()=>{try{const response=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('History data is temporarily unavailable.');const data=await response.json();entry.data=data;entry.at=Date.now();return data;}catch(error){entry.error=error;entry.at=Date.now();throw error;}finally{entry.pending=null;}})();
    requests.set(url,entry);return entry.pending;
  }
  function buildCatalog(publicCatalog,rawHistory){
    const regions=publicCatalog?.regions||rawHistory?.regions||[],raw=(rawHistory?.series||[]).filter(row=>Number.isInteger(row.gpuCount)&&row.gpuCount>0);
    const source=raw.length?raw:(publicCatalog?.specifications||[]).flatMap(row=>(row.regions||[]).map(region=>({...row,region})));
    const distinct=new Map();
    for(const row of source){
      const region=regions.find(item=>item.code===row.region)||{},model=String(row.gpuModel||'').trim();if(!model)continue;
      const entry={model,country:countryFor(row.region,region),vcpu:positive(row.vCpu??row.vcpu)?Number(row.vCpu??row.vcpu):null,memory:positive(row.gpuMemoryGb)?Number(row.gpuMemoryGb):null,term:null};
      const key=JSON.stringify(entry);if(!distinct.has(key))distinct.set(key,entry);
    }
    return {regions,raw:raw.map(({points,...metadata})=>metadata),rows:[...distinct.values()],models:[...new Set(source.map(row=>String(row.gpuModel||'').trim()).filter(Boolean))].sort()};
  }
  async function ensureCatalog(){
    if(catalog.pending)return catalog.pending;
    if(catalog.loaded&&Date.now()-catalog.loadedAt<TTL)return false;
    catalog.pending=(async()=>{
      const [description,metadata]=await Promise.allSettled([cached('/api/pricing/history-catalog'),cached('/api/pricing/imported-history?period=1D&unit=gpu')]);
      const a=description.status==='fulfilled'?description.value:null,b=metadata.status==='fulfilled'?metadata.value:null;
      const before=JSON.stringify(catalog.rows),next=buildCatalog(a,b);
      if(a||b)catalog={...catalog,...next,loaded:true,loadedAt:Date.now()};
      else catalog.loadedAt=Date.now();
      return before!==JSON.stringify(catalog.rows);
    })();
    try{return await catalog.pending;}finally{catalog.pending=null;}
  }
  function filterRows(){return catalog.rows.map(row=>({...row}));}
  function exactMetadata(series,data){
    if(positive(series.vCpu??series.vcpu))return {vcpu:Number(series.vCpu??series.vcpu)};
    if(data.meta?.sourceKind!=='uploaded_daily_history')return {vcpu:null};
    const instance=series.instanceType||series.configuration;
    const matches=catalog.raw.filter(row=>row.region===series.region&&row.gpuModel===series.gpuModel&&row.instanceType===instance&&row.gpuCount===series.gpuCount&&Number(row.gpuMemoryGb)===Number(series.gpuMemoryGb));
    const counts=[...new Set(matches.map(row=>row.vCpu??row.vcpu).filter(positive).map(Number))];
    return {vcpu:counts.length===1?counts[0]:null};
  }
  function filterData(data,options,focusedModel,focusedTerm=options.term){
    const model=modelInfo(focusedModel),want=options.selected,unknown={vcpu:0,country:0,form:0},sourceRegions=data.regions||[];
    const series=(data.series||[]).filter(row=>{
      if(TERMS.includes(focusedTerm)&&(data.term!==focusedTerm||row.term&&row.term!==focusedTerm))return false;
      if(!Number.isInteger(row.gpuCount)||row.gpuCount<1||norm(row.gpuModel)!==norm(model.base))return false;
      if(model.form&&norm(row.formFactor)!==norm(model.form)){if(!row.formFactor)unknown.form++;return false;}
      if(model.memory!==null&&Number(row.gpuMemoryGb)!==model.memory)return false;
      const region=sourceRegions.find(item=>item.code===row.region)||catalog.regions.find(item=>item.code===row.region)||{};
      const country=countryFor(row.region,region),metadata=exactMetadata(row,data);
      if(want.country.length&&!want.country.some(value=>norm(normalizeCountry(value))===norm(country))){if(!country)unknown.country++;return false;}
      if(want.vcpu.length&&(!positive(metadata.vcpu)||!want.vcpu.some(value=>Number(value)===metadata.vcpu))){if(!positive(metadata.vcpu))unknown.vcpu++;return false;}
      if(want.memory.length&&(!positive(row.gpuMemoryGb)||!want.memory.some(value=>Number(value)===Number(row.gpuMemoryGb))))return false;
      return true;
    }).map(row=>({...row,points:(row.points||[]).map(point=>({...point}))}));
    const codes=new Set(series.map(row=>row.region));
    return {data:{...data,series,regions:sourceRegions.filter(row=>codes.has(row.code)),meta:{...data.meta}},unknown};
  }
  function modelControls(ctx,options){
    const {state,models,term}=synchronize(ctx,options);
    return `<div class="onx-sa-index-controls"><label>Index model<select data-insight-model aria-label="Index GPU model">${models.map(model=>`<option value="${esc(model)}" ${model===state.model?'selected':''}>${esc(model)}</option>`).join('')}</select></label>${options.term==='All'?`<label>Index term<select data-insight-term aria-label="Index market term">${TERMS.map(value=>`<option ${value===term?'selected':''}>${value}</option>`).join('')}</select></label>`:`<span class="onx-sa-index-term">${esc(term)}</span>`}<div class="onx-sa-index-metrics" role="group" aria-label="Price metrics">${Object.entries(METRICS).map(([key,label])=>`<button type="button" data-insight-metric="${key}" aria-pressed="${state.metrics.includes(key)}">${label}</button>`).join('')}</div></div>`;
  }
  function render(ctx,input={}){
    const options=optionsCopy(input),{state,term}=synchronize(ctx,options);
    return `<section class="onx-sa-panel onx-sa-index" data-sa-index aria-label="Historical GPU price index"><header class="onx-sa-panel-head"><div><h2>Index <span data-insight-focus>${esc(state.model)}</span></h2><p>Recorded regional prices · USD / GPU-hour · <span data-insight-term-label>${esc(term)}</span></p></div></header><div data-insight-controls>${modelControls(ctx,options)}</div><div class="onx-sa-index-chart imported-history" data-insight-chart><div class="aws-history-empty"><h3>${options.range?'Loading recorded prices…':'Select a supported history range'}</h3><p>${options.range?'Price observations retain their original dates. Missing data is never estimated.':'Use the shared Market Insight time-range control.'}</p></div></div><p class="onx-sa-index-scope" data-insight-scope></p></section>`;
  }
  function clearOldControls(target){target.querySelectorAll('.history-controls,.periods,[data-act="period"]').forEach(node=>node.remove());}
  function empty(target,title,message){target.innerHTML=`<div class="aws-history-empty"><h3>${esc(title)}</h3><p>${esc(message)}</p></div>`;}
  function requestQuery(options,state,term){
    const spec=modelInfo(state.model),query=new URLSearchParams({gpuModel:spec.base,region:'all',term,period:PERIODS[options.range],metric:'avg'});
    if(spec.form)query.set('formFactor',spec.form);if(spec.memory!==null)query.set('gpuMemoryGb',String(spec.memory));return query.toString();
  }
  function draw(section,ctx,options,record){
    const target=section.querySelector('[data-insight-chart]');if(!target)return;
    const {state,term}=synchronize(ctx,options),filtered=filterData(record,options,state.model,term);
    section.querySelector('[data-insight-focus]').textContent=state.model;section.querySelector('[data-insight-term-label]').textContent=term;
    const scopeNote=section.querySelector('[data-insight-scope]');
    scopeNote.textContent=[options.selected.country.length?options.selected.country.map(normalizeCountry).join(', '):'All countries',options.selected.vcpu.length?options.selected.vcpu.join(' / ')+' vCPU per node':null,options.selected.memory.length?options.selected.memory.join(' / ')+' GB per GPU':null].filter(Boolean).join(' · ');
    if(!filtered.data.series.length){
      const reason=filtered.unknown.vcpu?'The recorded offerings do not provide a verified matching vCPU configuration.':filtered.unknown.form?'The historical catalog does not verify this form-factor variant.':filtered.unknown.country?'The recorded regions could not be verified against the selected countries.':'No recorded configuration matches the selected model, country and hardware filters.';
      empty(target,'No matching historical prices',reason+' Adjust the filters to compare available records.');return;
    }
    if(!scope.OpenNEXTRegionalHistory?.mount){empty(target,'Price chart is unavailable','The historical chart component could not be loaded.');return;}
    const privateState={model:state.model,count:'market-insight',region:'insight:'+JSON.stringify(options.selected),term,period:PERIODS[options.range],priceMetrics:state.metrics.slice(),priceMetric:state.metrics.includes('avg')?'avg':state.metrics[0]};
    scope.OpenNEXTRegionalHistory.mount(target,privateState,filtered.data);clearOldControls(target);
    if(!target.__insightObserver&&scope.MutationObserver){target.__insightObserver=new MutationObserver(()=>clearOldControls(target));target.__insightObserver.observe(target,{childList:true,subtree:true});}
    if(!target.__insightPeriodGuard){target.__insightPeriodGuard=true;target.addEventListener('click',event=>{if(event.target.closest('[data-act="period"]')){event.preventDefault();event.stopImmediatePropagation();}},true);}
  }
  async function load(section,ctx,options){
    if(!section.isConnected)return;
    const target=section.querySelector('[data-insight-chart]'),stateEntry=targets.get(section)||{},token={};stateEntry.token=token;stateEntry.ctx=ctx;stateEntry.options=options;stateEntry.record=null;targets.set(section,stateEntry);
    if(!options.range){empty(target,'Use the shared time-range control','This index does not unlock older history separately.');return;}
    try{
      const changed=await ensureCatalog();if(!section.isConnected||targets.get(section)?.token!==token)return;
      if(changed&&ctx.render){ctx.render();return;}
      const {state,term}=synchronize(ctx,options),query=requestQuery(options,state,term),data=await cached('/api/pricing/regional-history?'+query);
      if(!section.isConnected||targets.get(section)?.token!==token)return;
      stateEntry.record=data;draw(section,ctx,options,data);
    }catch(error){if(section.isConnected&&targets.get(section)?.token===token)empty(target,'Regional history is temporarily unavailable','Please try again shortly. No replacement prices have been generated.');}
  }
  function bind(ctx,input={}){
    const options=optionsCopy(input),section=scope.document?.querySelector('[data-sa-index]');if(!section)return;
    if(!section.__insightBound){
      section.__insightBound=true;
      section.addEventListener('change',event=>{
        if(!event.target.matches('[data-insight-model],[data-insight-term]'))return;
        event.stopPropagation();const entry=targets.get(section);if(!entry)return;const state=session(entry.ctx);
        if(event.target.matches('[data-insight-model]')){if(availableModels(entry.options).includes(event.target.value))state.model=event.target.value;}
        else if(TERMS.includes(event.target.value))state.term=event.target.value;
        section.querySelector('[data-insight-controls]').innerHTML=modelControls(entry.ctx,entry.options);
        empty(section.querySelector('[data-insight-chart]'),'Loading recorded prices…','Only the selected model and matching configurations are included.');load(section,entry.ctx,entry.options);
      },true);
      section.addEventListener('click',event=>{
        const button=event.target.closest('[data-insight-metric]');if(!button)return;event.preventDefault();event.stopPropagation();const entry=targets.get(section);if(!entry)return;
        const state=session(entry.ctx),metric=button.dataset.insightMetric;if(!METRICS[metric])return;
        if(state.metrics.includes(metric)){if(state.metrics.length===1)return;state.metrics=state.metrics.filter(value=>value!==metric);}else state.metrics=['max','avg','min'].filter(value=>value===metric||state.metrics.includes(value));
        section.querySelectorAll('[data-insight-metric]').forEach(node=>node.setAttribute('aria-pressed',String(state.metrics.includes(node.dataset.insightMetric))));
        if(entry.record)draw(section,entry.ctx,entry.options,entry.record);
      },true);
    }
    load(section,ctx,options);
  }
  scope.OpenNEXTMarketInsightIndex={render,bind,filterRows,ensureCatalog,testHelpers:{countryFor,normalizeCountry,buildCatalog,filterData,modelInfo,optionsCopy,requestQuery,periods:PERIODS}};
})(typeof window!=='undefined'?window:globalThis);
