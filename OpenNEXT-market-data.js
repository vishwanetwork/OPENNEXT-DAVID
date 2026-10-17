(() => {
  'use strict';
  const catalog=[
    ['H100',80,'H100'],['H100 SXM',80,'H100'],['H100 PCIe',80,'H100'],['H200',141,'H200'],
    ['B200',180,'B200'],['B300',288,'B300'],['GB200 Grace Blackwell',186,'GB200'],['GB200 NVL72',186,'GB200'],
    ['GB300 NVL72',279,'GB300'],['A100 80GB',80,'A100'],['A100 (all memory sizes)','40 / 80','A100'],
    ['A100 PCIe',80,'A100'],['L40S',48,'L40S'],['RTX PRO 6000 Blackwell',96,'RTX PRO 6000'],
    ['RTX 5090',32,'RTX 5090'],['RTX 4090',24,'RTX 4090'],['AMD MI300X',192,'MI300X'],
    ['AMD MI325X',256,'MI325X'],['AMD MI355X',288,'MI355X'],['NVIDIA GH200',96,'GH200'],
    ['A10G',24,'A10G'],['L4',24,'L4'],['T4',16,'T4'],['T4G',16,'T4G'],['AMD V520',8,'V520'],
    ['RTX PRO 4500',32,'RTX PRO 4500'],['V100',32,'V100']
  ].map((a,i)=>({name:a[0],memory:a[1],canonical:a[2],spot:null,onDemand:null,network:'Instance topology confirmed in supplier quote',seed:i+1}));
  const regions=[
    {name:'US East',code:'us-east-1',city:'N. Virginia'},{name:'US East · Ohio',code:'us-east-2',city:'Ohio'},
    {name:'US West',code:'us-west-2',city:'Oregon'},{name:'Singapore',code:'ap-southeast-1',city:'Singapore'},
    {name:'Frankfurt',code:'eu-central-1',city:'Frankfurt'},{name:'Ireland',code:'eu-west-1',city:'Dublin'},
    {name:'Tokyo',code:'ap-northeast-1',city:'Tokyo'},{name:'Mumbai',code:'ap-south-1',city:'Mumbai'},
    {name:'Seoul',code:'ap-northeast-2',city:'Seoul'},{name:'Dubai',code:'me-central-1',city:'Dubai'},
    {name:'US West · N. California',code:'us-west-1',city:'N. California'},{name:'Canada',code:'ca-central-1',city:'Montreal'},
    {name:'São Paulo',code:'sa-east-1',city:'São Paulo'},{name:'London',code:'eu-west-2',city:'London'},
    {name:'Paris',code:'eu-west-3',city:'Paris'},{name:'Stockholm',code:'eu-north-1',city:'Stockholm'},
    {name:'Osaka',code:'ap-northeast-3',city:'Osaka'},{name:'Sydney',code:'ap-southeast-2',city:'Sydney'}
  ];
  const news=[
    {source:'AMD',date:'12 Oct 2026',title:'Introducing AMD Helion, Agentic AI Compute at Rack Scale',url:'https://ir.amd.com/news-events/press-releases/detail/1301/introducing-amd-helion-agentic-ai-compute-at-rack-scale'},
    {source:'NVIDIA',date:'8 Oct 2026',title:'NVIDIA commits $1 billion to advance US science over the next five years',url:'https://nvidianews.nvidia.com/news/nvidia-commits-1-billion-to-advance-us-science-over-the-next-five-years'},
    {source:'NVIDIA',date:'1 Oct 2026',title:'How NVIDIA AI factories maximize return on investment',url:'https://blogs.nvidia.com/blog/productive-durable-fungible-ai-factories/'},
    {source:'AMD',date:'31 Aug 2026',title:'AMD, Cisco and HUMAIN expand Saudi Arabia’s AI infrastructure',url:'https://ir.amd.com/news-events/press-releases/detail/1298/amd-cisco-and-humain-expand-saudi-arabias-ai-infrastructure-as-amd-instinct-systems-go-live'}
  ];
  let records=[],meta={status:'loading',message:'Connecting to the server price cache.'},pricePending=null;
  const histories=new Map(),historyPending=new Map();
  const money=n=>n===null||n===undefined||!Number.isFinite(Number(n))?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4}).format(Number(n));
  const names={aws:'AWS',vultr:'Vultr',lambda:'Lambda',shadeform:'Shadeform'};
  const regionCode=value=>regions.find(r=>r.name===value||r.code===value||r.aliases?.includes(value))?.code||value;
  const regionLabel=value=>regions.find(r=>r.code===value)?.name||(value==='unspecified'?'Region not specified':value);
  const modelOf=name=>catalog.find(m=>m.name===name)||{name,canonical:name,memory:null};
  function matches(row,filters={}){
    const m=modelOf(filters.model||filters.gpuModel);
    if(filters.model&&row.gpuModel!==m.canonical)return false;
    if(['A100 80GB','A100 PCIe'].includes(filters.model)&&row.gpuMemoryGb!==80)return false;
    if(/PCIe/i.test(filters.model||'')&&!/pcie/i.test(row.formFactor||''))return false;
    if(/SXM/i.test(filters.model||'')&&!/sxm/i.test(row.formFactor||''))return false;
    if(/NVL72/i.test(filters.model||'')&&!/nvl72/i.test(row.formFactor||''))return false;
    if(filters.region&&filters.region!=='All regions'&&row.region!==regionCode(filters.region))return false;
    if(filters.term&&row.term!==filters.term)return false;
    if(filters.count!==undefined&&filters.count!==null&&row.gpuCount!==Number(filters.count))return false;
    return true;
  }
  function offers(filters){
    const m=modelOf(filters.model);
    return records.filter(row=>matches(row,filters)).map(row=>({
      id:row.recordId,recordId:row.recordId,model:filters.model,provider:(names[row.provider]||row.provider)+(row.underlyingProvider?' · '+row.underlyingProvider:''),
      sourceProvider:row.provider,region:regionLabel(row.region),regionCode:row.region,city:regionLabel(row.region),term:row.term,
      count:row.gpuCount,price:row.perGpuHourly,instanceHourly:row.instanceHourly,instanceType:row.instanceType,
      available:null,availability:row.availability,delivery:null,rating:null,response:null,uptime:null,
      memory:row.gpuMemoryGb??m.memory,network:m.network,fit:null,reviews:null,validUntil:null,
      observedAt:row.observedAt,effectiveAt:row.effectiveAt,sourceUrl:row.sourceUrl,priceKind:row.priceKind,
      stale:row.stale,currency:row.currency,operatingSystem:row.operatingSystem,tenancy:row.tenancy
    })).sort((a,b)=>a.price-b.price);
  }
  function base(model,term){const prices=records.filter(r=>matches(r,{model:model?.name,term})).map(r=>r.perGpuHourly);return prices.length?Math.min(...prices):null;}
  function historyKey(filters){const q=new URLSearchParams({provider:'aws',gpuModel:modelOf(filters.model).canonical,region:filters.region==='All regions'?'all':regionCode(filters.region),term:filters.term,period:filters.period||'1M',gpuCount:String(filters.count||8)});if(['A100 80GB','A100 PCIe'].includes(filters.model))q.set('gpuMemoryGb','80');if(/PCIe/i.test(filters.model))q.set('formFactor','PCIe');if(/SXM/i.test(filters.model))q.set('formFactor','SXM');if(/NVL72/i.test(filters.model))q.set('formFactor','NVL72');return q.toString();}
  function historyFor(filters){return histories.get(historyKey(filters))?.data||{series:[],meta:{status:'loading',message:'Loading AWS observations…'}};}
  async function ensureHistory(filters){
    const copy={model:filters.model,region:filters.region,term:filters.term,period:filters.period,count:filters.count};
    const key=historyKey(copy),cached=histories.get(key);
    if(cached&&Date.now()-cached.at<30000)return false;
    if(historyPending.has(key))return historyPending.get(key);
    const pending=(async()=>{
      try{const response=await fetch('/api/pricing/history?'+key,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('History unavailable');const data=await response.json();
        // Memory/form variants must not inherit a different hardware price.
        if(['A100 80GB','A100 PCIe'].includes(copy.model)||/PCIe|SXM|NVL72/i.test(copy.model)){const eligible=new Set(records.filter(r=>matches(r,copy)).map(r=>r.recordId));data.series=(data.series||[]).filter(s=>eligible.has(s.recordId));}
        histories.set(key,{at:Date.now(),data});return true;
      }catch{histories.set(key,{at:Date.now(),data:{series:[],meta:{status:'error',message:'AWS history is unavailable. No replacement curve has been generated.'}}});return true;}
      finally{historyPending.delete(key);}
    })();historyPending.set(key,pending);return pending;
  }
  function chartSeries(filters){
    const data=historyFor(filters),all=(data.series||[]).filter(s=>s.points?.length),out=[];
    for(const series of all){if(out.length>=3)break;if(!out.some(s=>s.region===series.region))out.push(series);}
    for(const series of all){if(out.length>=3)break;if(!out.includes(series))out.push(series);}
    return {series:out,meta:data.meta};
  }
  function history(offer){if(!offer)return [];for(const item of histories.values()){const series=item.data.series?.find(s=>s.recordId===offer.recordId);if(series)return series.points;}return [];}
  function reference(model){const rows=records.filter(r=>r.provider==='aws'&&matches(r,{model:model.name,term:'On-demand'}));return {source:'AWS public On-demand catalog',url:'https://aws.amazon.com/ec2/pricing/on-demand/',updated:meta.fetchedAt,status:meta.status,locations:[...new Set(rows.map(r=>r.region))],nodeGPUs:null,publicPrice:rows.length?Math.min(...rows.map(r=>r.perGpuHourly)):null};}
  let importedCatalog=null,catalogPending=null;
  async function loadHistoryCatalog(){
    if(importedCatalog)return importedCatalog;
    if(catalogPending)return catalogPending;
    catalogPending=(async()=>{try{const r=await fetch('/api/pricing/history-catalog',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Catalog unavailable');const data=await r.json();for(const entry of data.regions||[]){const current=regions.find(x=>x.code===entry.code);if(current){current.aliases=[...(current.aliases||[]),current.name];current.name=entry.name;current.city=entry.city||entry.name;}else regions.push({name:entry.name,code:entry.code,city:entry.city||entry.name});}importedCatalog=data;return data;}catch{return null;}finally{catalogPending=null;}})();return catalogPending;
  }
  async function refresh(){
    if(pricePending)return pricePending;
    pricePending=(async()=>{try{const response=await fetch('/api/pricing/prices?limit=5000',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Price cache unavailable');const data=await response.json();records=data.records||[];meta=data.meta||{};for(const m of catalog){m.onDemand=base(m,'On-demand');m.spot=base(m,'Spot');}return data;}catch{meta={status:'error',message:'Price API unavailable. Previously collected prices are retained, not replaced with generated values.'};return null;}finally{pricePending=null;}})();return pricePending;
  }
  function tickerRows(){return records.filter(r=>Number.isFinite(r.perGpuHourly)).sort((a,b)=>(a.provider==='aws'?0:1)-(b.provider==='aws'?0:1)||a.perGpuHourly-b.perGpuHourly);}
  window.ONMarket={catalog,regions,news,money,offers,history,reference,refresh,base,ensureHistory,historyFor,chartSeries,tickerRows,regionLabel,regionCode,modelOf,loadHistoryCatalog,get importedCatalog(){return importedCatalog;},get records(){return records;},get meta(){return meta;}};
})();
