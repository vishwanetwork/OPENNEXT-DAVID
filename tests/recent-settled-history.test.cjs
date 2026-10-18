'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const NOW=Date.parse('2026-10-18T12:00:00Z'),DAY=86400000;
class Clock extends Date {static now(){return NOW;}}
const record=(id,age,extra={})=>({id,model:'H100',provider:'Example supplier',region:'Singapore',count:8,hours:72,price:2.35,term:'Spot',settledAt:new Date(NOW-age*DAY).toISOString(),...extra});

function fixture(rows=[]){
  const listeners={},opens=[],renders=[];
  const X={status:()=>({}),best:()=>[],recent:()=>rows,regionMatches:(a,b)=>a===b};
  const window={OpenNEXTExchange:X},document={addEventListener:(type,listener)=>{listeners[type]=listener;}};
  vm.runInNewContext(read('OpenNEXT-procurement.js'),{window,document,Date:Clock},{filename:'OpenNEXT-procurement.js'});
  const P=window.OpenNEXTProcurement,S={model:'H100',region:'All regions',role:'Buyer',rfqs:[],orders:[]};
  const c={S,esc:value=>String(value??''),money:value=>'$'+Number(value).toFixed(2),open:type=>opens.push(type),render:()=>renders.push(P.matches(c,'recent'))};
  const select=value=>{const target={value:String(value),matches:selector=>selector==='[data-proc-days]'};listeners.change({target});return target;};
  P.matches(c,'recent');
  return {P,X,S,c,select,opens,renders,window};
}

test('Recent Settled offers every history period and allows 1W, 1M and 3M without a sales gate',()=>{
  const rows=[record('HALF-DAY',.5),record('TWO-DAYS',2),record('FIVE-DAYS',5),record('TWENTY-DAYS',20),record('EIGHTY-NINE-DAYS',89),record('NINETY-DAYS',90),record('TOO-OLD',91),record('FUTURE',-1),record('OTHER-MODEL',1,{model:'B200'}),record('INVALID-TIME',1,{settledAt:'invalid'})];
  const f=fixture(rows),initial=f.P.matches(f.c,'recent');
  for(const label of ['1D','3D','1W','1M','3M','6M','1Y','ALL'])assert.ok(initial.includes('>'+label+'</option>'));
  assert.match(initial,/>2 settlements</);
  for(const [days,count] of [[1,1],[3,2],[7,3],[30,4],[90,6]]){
    f.select(days);
    const html=f.renders.at(-1);
    assert.match(html,new RegExp('>'+count+' settlements<'));
    assert.match(html,new RegExp('value="'+days+'" selected'));
    for(const id of ['TOO-OLD','FUTURE','OTHER-MODEL','INVALID-TIME'])assert.ok(!html.includes('data-match-id="'+id+'"'));
  }
  assert.equal(f.opens.length,0);
  assert.ok(f.renders.at(-1).includes('data-match-id="NINETY-DAYS"'));
});

test('6M, 1Y and ALL preserve the selected free period and open Contact Sales',()=>{
  const f=fixture([record('VALID',20)]);f.select(90);
  for(const value of [180,365,'all']){
    const target=f.select(value);assert.equal(target.value,'90');
    assert.equal(f.opens.at(-1),'proc-history-upgrade');
  }
  assert.equal(f.renders.length,1);
  const modal=f.P.modal(f.c,'proc-history-upgrade',{});
  assert.match(modal.body,/up to 3 months is free/);
  assert.match(modal.body,/6M, 1Y or all available history/);
  assert.match(modal.body,/data-act="proc-contact-sales"/);
  let contactOpened=false;f.window.OpenNEXTContact={open:()=>{contactOpened=true;}};
  assert.equal(f.P.action(f.c,'proc-contact-sales',{dataset:{}}),true);
  assert.equal(contactOpened,true);
});

test('Recent Settled keeps the selected GPU and region filters across the expanded free window',()=>{
  const f=fixture([record('SINGAPORE',70),record('TOKYO',70,{region:'Tokyo'}),record('B200',70,{model:'B200'})]);
  f.S.region='Singapore';f.select(90);
  const html=f.renders.at(-1);assert.match(html,/>1 settlements</);assert.ok(html.includes('data-match-id="SINGAPORE"'));
  assert.ok(!html.includes('data-match-id="TOKYO"'));assert.ok(!html.includes('data-match-id="B200"'));
  f.S.model='L40S';assert.match(f.P.matches(f.c,'recent'),/No matches\./);
  const renderCount=f.renders.length;assert.equal(f.select('invalid').value,'90');assert.equal(f.renders.length,renderCount);assert.equal(f.opens.length,0);
});

test('exchange loads the full free 90-day settlement window from the read-only server endpoint',async()=>{
  const requests=[],rows=[record('OLDER-VALID',70)],window={};
  const fetch=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url.includes('/settlements?')?{rows}:{rfqs:[],supplies:[],featured:{rfqs:[],supplies:[]}}};};
  vm.runInNewContext(read('OpenNEXT-exchange.js'),{window,fetch,URLSearchParams,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}},{filename:'OpenNEXT-exchange.js'});
  await window.OpenNEXTExchange.refresh({model:'H100',region:'All regions'});
  assert.deepEqual(requests.map(r=>r.url),['/api/marketplace/public','/api/marketplace/reference-catalog','/api/marketplace/settlements?days=90']);
  assert.ok(requests.every(r=>r.options.method==='GET'));
  assert.equal(window.OpenNEXTExchange.recent()[0].id,'OLDER-VALID');
});
