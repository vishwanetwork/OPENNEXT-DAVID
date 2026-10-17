(() => {
  'use strict';
  const D=window.ONMarket,DAY=86400000,MAX=5,cache=new Map(),pending=new Map(),choices=new Map();
  const colors=['#315f49','#7393af','#b79150','#987ba7','#4b9994'];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=v=>typeof v==='number'&&Number.isFinite(v);
  const money=v=>number(v)?'$'+v.toFixed(2):'—';
  const dayLabel=(date,year=false)=>new Date(date.slice(0,10)+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',...(year?{year:'numeric'}:{}),timeZone:'UTC'});
  const code=S=>D.regionCode(S.region);
  const key=S=>[D.modelOf(S.model).canonical,code(S),S.count,S.period||'1M',/PCIe|SXM|NVL72/.exec(S.model)?.[0]||'',/A100 80GB/.test(S.model)?80:''].join('|');
  const selectionKey=S=>[S.model,code(S),S.count].join('|');
  function regionInfo(region){return (D.importedCatalog?.regions||[]).find(r=>r.code===region)||{code:region,name:D.regionLabel(region),city:D.regionLabel(region)};}
  function state(S,data){
    const k=selectionKey(S);if(!choices.has(k))choices.set(k,{instance:'',selected:[],unit:Number(S.count)===0?'instance':'gpu',open:false,query:'',notice:''});
    const c=choices.get(k),all=data?.series||[];
    const instances=[...new Set(all.map(s=>s.instanceType))].sort();
    if(!instances.includes(c.instance)){c.instance=instances[0]||'';c.selected=[];}
    const eligible=all.filter(s=>s.instanceType===c.instance&&s.points.some(p=>number(c.unit==='instance'?p.instanceHourly:p.value)));
    c.selected=c.selected.filter(id=>eligible.some(s=>s.id===id));
    if(!c.selected.length&&eligible.length){
      for(const region of ['us-east-1','us-west-2','ap-northeast-1']){const s=eligible.find(s=>s.region===region);if(s)c.selected.push(s.id);}
      for(const s of eligible){if(c.selected.length>=3)break;if(!c.selected.some(id=>eligible.find(a=>a.id===id)?.region===s.region))c.selected.push(s.id);}
      if(!c.selected.length)c.selected=[eligible[0].id];
    }
    return {c,all,eligible,instances,selected:c.selected.map(id=>eligible.find(s=>s.id===id)).filter(Boolean)};
  }
  function summary(S){
    const data=cache.get(key(S));if(!data)return null;
    const {c,selected}=state(S,data),main=selected[0];if(!main)return null;
    const points=main.points.filter(p=>number(c.unit==='instance'?p.instanceHourly:p.value));
    const val=p=>c.unit==='instance'?p.instanceHourly:p.value;
    return {latest:val(points.at(-1)),change:points.length>1&&val(points[0])>0?(val(points.at(-1))/val(points[0])-1)*100:null,points:points.length,region:regionInfo(main.region).city,zone:main.zone,last:points.at(-1).date,unit:c.unit,selected:selected.length};
  }
  function header(S){
    const info=summary(S),price=document.getElementById('marketPrice');if(!price)return;
    price.textContent=info?money(info.latest):'—';
    const caption=document.getElementById('historyPrimaryCaption');if(caption)caption.textContent=info?info.zone+' · '+dayLabel(info.last):'Select a recorded configuration';
    const label=document.getElementById('marketPriceLabel');if(label)label.textContent='LAST DAILY AVG / '+(info?.unit==='instance'?'INSTANCE-HR':'GPU-HR');
    const change=document.getElementById('marketChange');if(change){change.textContent=info?.change===null||!info?'—':(info.change>=0?'+':'')+info.change.toFixed(2)+'%';change.className=info?.change>=0?'positive':'negative';}
    const count=document.getElementById('marketRecords');if(count)count.textContent=info?info.points+' days':'—';
  }
  function controls(S,c,instances){return `<div class="history-controls"><div class="periods">${['1D','1W','1M','3M'].map(p=>`<button class="period ${S.period===p?'active':''}" data-act="period" data-value="${p}">${p==='ALL'?'All':p}</button>`).join('')}</div><div class="history-control-fields"><label>Instance <select data-history-instance aria-label="History instance specification">${instances.map(s=>`<option value="${esc(s)}" ${s===c.instance?'selected':''}>${esc(s)}</option>`).join('')}</select></label><label>Unit <select data-history-unit aria-label="History price unit"><option value="gpu" ${c.unit==='gpu'?'selected':''} ${Number(S.count)===0?'disabled':''}>USD / GPU-hour</option><option value="instance" ${c.unit==='instance'?'selected':''}>USD / instance-hour</option></select></label></div></div>`;}
  function picker(S,c,eligible){
    const regions=D.importedCatalog?.regions||[...new Set(eligible.map(s=>s.region))].map(regionInfo);
    return `<div class="history-selection"><button class="btn secondary small" data-history-toggle aria-expanded="${c.open}">Regions & zones <span class="history-count">${c.selected.length} / ${MAX}</span>⌄</button><span>Choose up to ${MAX} curves · All ${regions.length} imported regions available</span>${c.open?`<section class="history-picker" aria-label="Compare regions and availability zones"><div class="history-picker-head"><strong>Compare regions & zones</strong><button type="button" data-history-toggle aria-label="Close region comparison">×</button></div><input type="search" data-history-search aria-label="Search history regions or availability zones" placeholder="Search region, city or availability zone…" value="${esc(c.query)}"><div class="history-picker-hint">Same ${esc(c.instance)} specification · ${c.selected.length} of ${MAX} curves selected</div><div class="history-options">${regions.map(r=>{const rows=eligible.filter(s=>s.region===r.code);return `<div class="history-region-group" data-history-search-text="${esc([r.name,r.city,r.code,...rows.map(s=>s.zone)].join(' ').toLowerCase())}"><div class="history-region-name">${esc(r.name)} <small>${esc(r.code)}</small></div>${rows.length?rows.map(s=>`<label class="history-zone-row"><input type="checkbox" data-history-id="${esc(s.id)}" ${c.selected.includes(s.id)?'checked':''}><span>${esc(s.zone||s.region)}</span><small>${s.points.length} daily points</small></label>`).join(''):'<div class="history-region-empty">No observations for this GPU / instance selection</div>'}</div>`;}).join('')}</div><div class="history-picker-empty" hidden>No matching region or availability zone.</div><div class="history-picker-notice" role="status">${esc(c.notice||'Regions without this configuration remain listed for reference.')}</div></section>`:''}</div>`;
  }
  function chartMarkup(S,data,width){
    const {c,eligible,instances,selected}=state(S,data);
    if(!selected.length)return controls(S,c,instances)+picker(S,c,eligible)+`<div class="aws-history-empty"><span class="eyebrow">IMPORTED SPOT HISTORY</span><h3>No daily prices for this configuration</h3><p>Try another GPU count, region or model. Unreported configurations are not assigned a replacement price.${/SXM|PCIe|NVL72/.test(S.model)?' This workbook does not declare form factors. Select the general GPU model to view its imported observations.':''}</p>${/SXM|PCIe|NVL72/.test(S.model)?`<button class="btn secondary small" data-act="select-filter" data-type="model" data-value="${esc(D.modelOf(S.model).canonical)}">View ${esc(D.modelOf(S.model).canonical)} history</button>`:''}</div>`;
    const val=p=>c.unit==='instance'?p.instanceHourly:p.value;
    const series=selected.map((s,i)=>({...s,color:colors[i],points:s.points.filter(p=>number(val(p))).map(p=>({...p,value:val(p),high:c.unit==='instance'?p.instanceHigh:p.high,low:c.unit==='instance'?p.instanceLow:p.low,time:Date.parse(p.date+'T00:00:00Z')}))}));
    const w=Math.max(600,width-40),h=360,left=24,right=142,top=28,bottom=43;
    const values=series.flatMap(s=>s.points.map(p=>p.value)),times=series.flatMap(s=>s.points.map(p=>p.time));
    const low=Math.min(...values),high=Math.max(...values),pad=Math.max((high-low)*.18,low*.025,.01),min=low-pad,max=high+pad,from=Math.min(...times),to=Math.max(...times);
    const px=t=>from===to?(left+w-right)/2:left+(t-from)/(to-from)*(w-left-right),py=v=>top+(max-v)/(max-min)*(h-top-bottom);
    const ticks=from===to?[from]:Array.from({length:4},(_,i)=>from+(to-from)*i/3);
    let grid=Array.from({length:4},(_,i)=>{const v=min+(max-min)*i/3,y=py(v);return `<line x1="${left}" x2="${w-right}" y1="${y}" y2="${y}" stroke="#e3ebe5" stroke-dasharray="4 7"/><text x="${w-right+16}" y="${y+4}" class="history-axis">$${v.toFixed(2)}</text>`;}).join('');
    let labels=[];
    const paths=series.map((s,i)=>{
      s.points=s.points.map(p=>({...p,x:px(p.time),y:py(p.value)}));
      // Start a new segment across an absent day; never bridge a missing observation.
      const d=s.points.map((p,j)=>`${!j||p.time-s.points[j-1].time>DAY*1.5?'M':'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' '),end=s.points.at(-1);
      labels.push({i,y:end.y,value:end.value,color:s.color,name:regionInfo(s.region).city+(series.filter(a=>a.region===s.region).length>1?' · '+s.zone.split('-').at(-1):''),zone:s.zone,x:end.x});
      return `<path data-history-line="${i}" d="${d}" fill="none" stroke="${s.color}" stroke-width="${i===0?2.8:2.3}" stroke-linecap="round" stroke-linejoin="round" ${i===1?'stroke-dasharray="6 4"':i===3?'stroke-dasharray="3 4"':''}/>${s.points.map((p,j)=>s.points.length===1||(!j||p.time-s.points[j-1].time>DAY*1.5)&&(j===s.points.length-1||s.points[j+1].time-p.time>DAY*1.5)?`<circle cx="${p.x}" cy="${p.y}" r="3" fill="${s.color}"/>`:'').join('')}<circle cx="${end.x}" cy="${end.y}" r="3.5" fill="${s.color}" stroke="white" stroke-width="1.5"/>`;
    }).join('');
    labels.sort((a,b)=>a.y-b.y);for(let i=1;i<labels.length;i++)labels[i].y=Math.max(labels[i].y,labels[i-1].y+34);const excess=Math.max(0,labels.at(-1).y-(h-bottom));if(excess)labels.forEach(l=>l.y-=excess);
    grid=Array.from({length:4},(_,i)=>{const v=min+(max-min)*i/3,y=py(v),covered=labels.some(l=>Math.abs(l.y-y)<28);return `<line x1="${left}" x2="${w-right}" y1="${y}" y2="${y}" stroke="#e3ebe5" stroke-dasharray="4 7"/>${covered?'':`<text x="${w-right+16}" y="${y+4}" class="history-axis">$${v.toFixed(2)}</text>`}`;}).join('');
    const endpoint=labels.map(l=>`<path d="M${l.x+6},${series[l.i].points.at(-1).y} L${w-right+9},${l.y} H${w-right+18}" fill="none" stroke="${l.color}" opacity=".65"/><rect x="${w-right+19}" y="${l.y-17}" width="120" height="34" fill="white"/><text x="${w-right+26}" y="${l.y-3}" class="history-end-name" fill="${l.color}">${esc(l.name)}</text><text x="${w-right+26}" y="${l.y+12}" class="history-end-value" fill="${l.color}">${money(l.value)}</text>`).join('');
    const legend=series.map((s,i)=>`<button data-history-focus="${i}" class="history-legend-chip ${i===0?'primary':''}" title="Emphasize ${esc(s.zone)}"><i style="--series-color:${s.color};${i===1?'border-top-style:dashed':''}"></i><span>${esc(regionInfo(s.region).city)}<small>${esc(s.zone)}</small></span><span data-history-remove="${esc(s.id)}" role="button" aria-label="Remove ${esc(s.zone)}">×</span></button>`).join('');
    const table=series.map(s=>{const p=s.points,first=p[0],last=p.at(-1),change=p.length>1&&first.value>0?(last.value/first.value-1)*100:null;return `<tr><td><i style="background:${s.color}"></i><strong>${esc(regionInfo(s.region).city)}</strong><small>${esc(s.zone)} · ${esc(s.instanceType)}</small></td><td>${money(last.value)}<small>${dayLabel(last.date)}</small></td><td>${change===null?'—':(change>=0?'+':'')+change.toFixed(2)+'%'}<small>${dayLabel(first.date)} → ${dayLabel(last.date)}</small></td><td>$${Math.min(...p.map(a=>a.value)).toFixed(2)} – $${Math.max(...p.map(a=>a.value)).toFixed(2)}</td><td>${p.length} days</td></tr>`;}).join('');
    window.__onHistoryChartInfo={series,w,h,from,to,unit:c.unit};
    return controls(S,c,instances)+picker(S,c,eligible)+`<div class="history-legend">${legend}</div><div class="history-range"><span>${dayLabel(new Date(from).toISOString(),true)} – ${dayLabel(new Date(to).toISOString(),true)}</span><span>Spot · Daily average · ${c.unit==='instance'?'USD / instance-hour':'USD / GPU-hour'}</span></div><div class="history-plot"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(S.model)} daily Spot history">${grid}${paths}${endpoint}${ticks.map((t,i)=>`<text class="history-axis" x="${px(t)}" y="${h-12}" text-anchor="${i===0?'start':i===ticks.length-1?'end':'middle'}">${dayLabel(new Date(t).toISOString())}</text>`).join('')}<g class="history-hover" visibility="hidden"><line y1="${top}" y2="${h-bottom}" stroke="#98ab9d" stroke-dasharray="3 5"/><circle r="4" fill="white" stroke-width="2"/></g></svg><div class="history-tooltip" hidden></div></div><div class="history-footnote"><span>Same instance specification · Gaps remain where observations are missing</span><span>Snapshot through ${dayLabel(data.meta?.asOf||data.meta?.snapshotAsOf||'2026-10-13',true)}</span></div><div class="history-comparison"><div><strong>Regional history comparison</strong><small>Daily averages, not executable quotes</small></div><div class="table-scroll"><table><thead><tr><th>REGION / AVAILABILITY ZONE</th><th>LAST DAILY AVG</th><th>PERIOD CHANGE</th><th>DAILY AVERAGE RANGE</th><th>OBSERVATIONS</th></tr></thead><tbody>${table}</tbody></table></div></div>`;
  }
  function render(){return '<section id="importedHistory" class="imported-history"><div class="aws-history-empty"><span class="eyebrow">SPOT PRICE HISTORY</span><h3>Loading recorded daily prices…</h3></div></section>';}
  async function load(S){
    const k=key(S);if(cache.has(k))return cache.get(k);if(pending.has(k))return pending.get(k);
    const query=new URLSearchParams({gpuModel:D.modelOf(S.model).canonical,region:S.region==='All regions'?'all':code(S),gpuCount:String(S.count),period:S.period||'1M',unit:'instance'});
    if(/PCIe|SXM|NVL72/.test(S.model))query.set('formFactor',/PCIe|SXM|NVL72/.exec(S.model)[0]);
    if(S.model==='A100 80GB'||S.model==='A100 PCIe')query.set('gpuMemoryGb','80');
    const p=(async()=>{const r=await fetch('/api/pricing/imported-history?'+query,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('History request failed');const data=await r.json();cache.set(k,data);return data;})().finally(()=>pending.delete(k));pending.set(k,p);return p;
  }
  function bind(S){
    const target=document.getElementById('importedHistory');if(!target)return;
    const snapshot={model:S.model,region:S.region,count:S.count,period:S.period};let stopped=false;
    function repaint(data){if(!target.isConnected)return;const oldScroll=target.querySelector('.history-options')?.scrollTop||0;target.innerHTML=chartMarkup(snapshot,data,target.clientWidth||900);const opt=target.querySelector('.history-options');if(opt)opt.scrollTop=oldScroll;filterOptions();header(snapshot);bindPlot();}
    function filterOptions(){const c=state(snapshot,cache.get(key(snapshot))).c,q=c.query.trim().toLowerCase();let count=0;target.querySelectorAll('[data-history-search-text]').forEach(el=>{el.hidden=!el.dataset.historySearchText.includes(q);if(!el.hidden)count++;});const empty=target.querySelector('.history-picker-empty');if(empty)empty.hidden=count>0;}
    function bindPlot(){const svg=target.querySelector('.history-plot svg'),info=window.__onHistoryChartInfo;if(!svg||!info)return;const tip=target.querySelector('.history-tooltip'),hover=svg.querySelector('.history-hover');svg.addEventListener('pointermove',e=>{const rect=svg.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*info.w,y=(e.clientY-rect.top)/rect.height*info.h;let selected=null,point=null,dist=Infinity;for(const s of info.series)for(const p of s.points){const d=Math.abs(p.x-x)*1.8+Math.abs(p.y-y);if(d<dist){dist=d;selected=s;point=p;}}if(!point)return;hover.setAttribute('visibility','visible');const line=hover.querySelector('line'),dot=hover.querySelector('circle');line.setAttribute('x1',point.x);line.setAttribute('x2',point.x);dot.setAttribute('cx',point.x);dot.setAttribute('cy',point.y);dot.setAttribute('stroke',selected.color);tip.innerHTML=`<strong>${money(point.value)} <small>/ ${info.unit==='instance'?'instance-hour':'GPU-hour'}</small></strong><span>${esc(regionInfo(selected.region).city)} · ${esc(selected.zone)}</span><span>${esc(selected.instanceType)} · Daily average</span><div>Day low ${money(point.low)}<br>Day high ${money(point.high)}</div><time>${dayLabel(point.date,true)}</time>`;tip.hidden=false;tip.style.left=Math.max(8,Math.min(rect.width-242,point.x/info.w*rect.width-254))+'px';tip.style.top=Math.max(8,Math.min(rect.height-166,point.y/info.h*rect.height-180))+'px';svg.querySelectorAll('[data-history-line]').forEach(el=>el.style.opacity=info.series[Number(el.dataset.historyLine)]===selected?'1':'.5');});svg.addEventListener('pointerleave',()=>{hover.setAttribute('visibility','hidden');tip.hidden=true;svg.querySelectorAll('[data-history-line]').forEach(el=>el.style.opacity='1');});}
    target.addEventListener('click',e=>{
      const data=cache.get(key(snapshot));if(!data)return;const {c}=state(snapshot,data);
      if(e.target.closest('[data-history-toggle]')){c.open=!c.open;c.notice='';repaint(data);if(c.open)target.querySelector('[data-history-search]')?.focus();}
      const remove=e.target.closest('[data-history-remove]');if(remove){e.stopPropagation();if(c.selected.length>1)c.selected=c.selected.filter(id=>id!==remove.dataset.historyRemove);repaint(data);}
      const focus=e.target.closest('[data-history-focus]');if(focus&&!remove){const i=Number(focus.dataset.historyFocus),chosen=c.selected[i];if(chosen){c.selected=[chosen,...c.selected.filter(id=>id!==chosen)];repaint(data);}}
    });
    target.addEventListener('input',e=>{if(e.target.matches('[data-history-search]')){state(snapshot,cache.get(key(snapshot))).c.query=e.target.value;filterOptions();}});
    target.addEventListener('change',e=>{const data=cache.get(key(snapshot));if(!data)return;const {c}=state(snapshot,data);if(e.target.matches('[data-history-instance]')){c.instance=e.target.value;c.selected=[];c.query='';repaint(data);}if(e.target.matches('[data-history-unit]')){c.unit=e.target.value;repaint(data);}if(e.target.matches('[data-history-id]')){const id=e.target.dataset.historyId;if(e.target.checked){if(c.selected.length>=MAX)c.notice='Select at most five curves. Remove one before adding another.';else{c.selected.push(id);c.notice='';}}else if(c.selected.length>1){c.selected=c.selected.filter(s=>s!==id);c.notice='';}else c.notice='Keep at least one curve selected.';repaint(data);}});
    target.addEventListener('keydown',e=>{if(e.key==='Escape'){const data=cache.get(key(snapshot));if(data){state(snapshot,data).c.open=false;repaint(data);target.querySelector('[data-history-toggle]')?.focus();e.stopPropagation();}}});
    Promise.all([D.loadHistoryCatalog(),load(snapshot)]).then(([,data])=>{if(!stopped)repaint(data);}).catch(()=>{if(target.isConnected)target.innerHTML='<div class="aws-history-empty"><h3>Historical data is temporarily unavailable</h3><p>Refresh the page to retry the imported price service.</p></div>';});
  }
  window.OpenNEXTHistory={render,bind,summary,load};
})();
