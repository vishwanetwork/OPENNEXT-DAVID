'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const countries=require('../OpenNEXT-countries.js');
const backendRegionMatches=require('../OpenNEXT-external-marketplace.cjs').regionMatches;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const external=(extra={})=>({id:'EXT-LARGE-1',kind:'rental',side:'demand',external:true,executable:false,responseMode:'operations',provider:'Sourced requirement',model:'B200',title:'128 B200 nodes',description:'Dedicated cluster with a 12-month commitment.',region:'Worldwide',regionScope:{type:'worldwide',countries:[]},quantity:{nodes:128,gpusPerNode:8,totalGpusMin:1024,sourceMinimum:true},rentalMonths:{min:12,preferred:12},price:2.3,priceUnit:'GPU-hour',urgency:'High',status:'Approved',...extra});
const native=extra=>({id:'RFQ-NATIVE-1',kind:'rental',side:'demand',provider:'Verified buyer',model:'B200',count:8,hours:72,price:3,region:'Singapore',term:'Spot',...extra});
async function fixture({role='Seller',rows=[external()],best=rows,recent=[],filters={}}={}){
  const calls=[],contacts=[],toasts=[];
  const user={id:'test-user',role:role.toLowerCase(),onboardingCompleted:true};
  const own={rfqs:[],listings:[],review:{status:'Approved'},responses:[],orders:[],notifications:[],instances:[]};
  const window={OpenNEXTAuth:{getUser:()=>user},OpenNEXTCountries:countries,OpenNEXTContact:{open:options=>contacts.push(options)}};
  const fetch=async(url,options)=>{calls.push({url,method:options.method});const pathname=url.split('?')[0],body=pathname.endsWith('/public')?{rfqs:rows,supplies:[],featured:{rfqs:[],supplies:[]}}:pathname.endsWith('/reference-catalog')?{rfqs:[],supplies:[],recent:[]}:pathname.endsWith('/me')?own:pathname.endsWith('/matches')?{rows:best,reason:'No matches.',submissionPrompt:'Submit Supply for more precise recommendations.'}:{rows:recent};return {ok:true,json:async()=>body};};
  const sandbox={window,fetch,URLSearchParams};
  for(const file of ['OpenNEXT-exchange.js','OpenNEXT-procurement.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),sandbox,{filename:file});
  const X=window.OpenNEXTExchange,P=window.OpenNEXTProcurement,S=X.init({role,auth:true,identity:{name:'User',company:'',email:'user@example.test'},model:'B200',region:'All regions',count:8,term:'Spot',rfqs:[],listings:[],...filters});
  await X.refresh(S);
  const c={S,esc,money:value=>'$'+Number(value).toFixed(2),persist(){},render(){},toast:message=>toasts.push(message),open(type,extra){S.modal={type,...extra};}};
  return {X,P,S,c,calls,contacts,toasts};
}

test('formal external RFQs join native rows without requiring invented Spot terms or 8-GPU inventory',async()=>{
  const sourced=external(),before=JSON.stringify(sourced),f=await fixture({rows:[sourced,native()]});
  const rows=f.X.matches(f.S,'demand');assert.equal(rows.length,2);assert.ok(rows.some(r=>r.id==='EXT-LARGE-1'));
  assert.equal(rows.find(r=>r.external).hours,undefined);assert.equal(rows.find(r=>r.external).term,undefined);assert.equal(rows.find(r=>r.external).count,undefined);
  assert.equal(JSON.stringify(sourced),before);assert.equal(f.S.rfqs.length,0);assert.equal(f.S.orders.length,0);
  f.S.term='On-demand';assert.deepEqual(Array.from(f.X.matches(f.S,'demand'),r=>r.id),['EXT-LARGE-1']);
  f.S.count=2048;assert.equal(f.X.matches(f.S,'demand').length,0);
});

test('source region scope supports worldwide, flexible, European countries and EU-only accurately',async()=>{
  const f=await fixture();
  for(const type of ['worldwide','flexible'])assert.equal(f.X.recordRegionMatches(external({regionScope:{type}}),'Tokyo'),true);
  const europe=external({regionScope:{type:'europe'}}),eu=external({regionScope:{type:'europe',unionOnly:true}});
  assert.equal(f.X.recordRegionMatches(europe,'London'),true);assert.equal(f.X.recordRegionMatches(europe,'Zurich'),true);assert.equal(f.X.recordRegionMatches(europe,'Singapore'),false);
  assert.equal(f.X.recordRegionMatches(eu,'Frankfurt'),true);assert.equal(f.X.recordRegionMatches(eu,'United Kingdom'),false);assert.equal(f.X.recordRegionMatches(eu,'Switzerland'),false);
  const countries=external({regionScope:{type:'countries',countries:['US','GB']}});
  assert.equal(f.X.recordRegionMatches(countries,'us-east-1'),true);assert.equal(f.X.recordRegionMatches(countries,'London'),true);assert.equal(f.X.recordRegionMatches(countries,'Germany'),false);
});

test('alternative GPU models project the matching budget without changing identity or original data',async()=>{
  const row=external({id:'EXT-DUAL',model:'B200',modelOptions:['B200','H200'],modelBudgets:{B200:3,H200:1.7},price:3}),before=JSON.stringify(row),f=await fixture({rows:[row]});
  assert.equal(f.X.matches(f.S,'demand')[0].price,3);
  f.S.model='H200';const projected=f.X.matches(f.S,'demand')[0];assert.equal(projected.id,row.id);assert.equal(projected.model,'H200');assert.equal(projected.price,1.7);assert.equal(f.X.get(row.id).price,1.7);
  assert.equal(f.X.best(f.S)[0].model,'H200');assert.equal(JSON.stringify(row),before);
  const details=f.P.modal(f.c,'proc-listing',{id:row.id}).body;assert.match(details,/GPU model<\/small><strong>H200/);assert.match(details,/Buyer target price<\/small><strong>\$1\.70/);assert.doesNotMatch(details,/Buyer target price<\/small><strong>\$3\.00/);
  f.S.model='H100';assert.equal(f.X.matches(f.S,'demand').length,0);assert.equal(f.X.best(f.S).length,0);
});

test('country exclusions are honored for worldwide, flexible, Europe and explicit countries',async()=>{
  const f=await fixture();
  for(const type of ['worldwide','flexible','europe','countries']){
    const row=external({regionScope:{type,countries:['DE','GB'],excludedCountries:['Germany']}});
    assert.equal(f.X.recordRegionMatches(row,'Germany'),false,type);assert.equal(f.X.recordRegionMatches(row,'DE'),false,type);assert.equal(f.X.recordRegionMatches(row,'Frankfurt'),false,type);assert.equal(f.X.recordRegionMatches(row,'eu-central-1'),false,type);
    assert.equal(f.X.recordRegionMatches(row,'United Kingdom'),true,type);
  }
  const nonUS=external({regionScope:{type:'worldwide',excludedCountries:['US']}});assert.equal(f.X.recordRegionMatches(nonUS,'US East'),false);assert.equal(f.X.recordRegionMatches(nonUS,'Singapore'),true);
});

test('frontend and backend external geography agree for every country and territory',async()=>{
  const f=await fixture();
  const scopes=[{type:'worldwide'},{type:'flexible',excludedCountries:['United States']},{type:'europe'},{type:'europe',unionOnly:true},{type:'europe',excludedCountries:['Russia','Turkey']},{type:'countries',countries:['United States','United Kingdom','Germany'],excludedCountries:['Germany']}];
  for(const regionScope of scopes)for(const country of countries.list){
    const row=external({regionScope});
    for(const selected of [country.code,country.name])assert.equal(f.X.recordRegionMatches(row,selected),backendRegionMatches(row,selected),JSON.stringify(regionScope)+' '+selected);
  }
  for(const code of ['RU','TR','AX','FO','GG','GI','IM','JE','SJ'])assert.equal(f.X.recordRegionMatches(external({regionScope:{type:'europe'}}),code),true,code);
});

test('seller RFQ table preserves nodes and commitment months with operations-only action',async()=>{
  const f=await fixture({rows:[external(),native()]});const html=f.P.listingTable(f.c);
  assert.match(html,/Marketplace &amp; sourced requirements|Marketplace & sourced requirements/);assert.match(html,/128 nodes · 1,024\+ GPUs/);assert.match(html,/Commitment · From 12 months/);
  assert.match(html,/data-act="proc-external-inquiry" data-id="EXT-LARGE-1"/);assert.match(html,/data-act="proc-opportunity" data-id="RFQ-NATIVE-1"/);
  assert.doesNotMatch(html,/undefined|NaN|1024 hours|Verified marketplace records/);
  assert.match(html,/Sourced listings\. Availability and commercial terms are confirmed through OpenNEXT\./);
});

test('Buyer RFQ rows show no Offer capacity and no fabricated bidder count',async()=>{
  const f=await fixture({role:'Buyer'}),html=f.P.listingTable(f.c);assert.match(html,/<td>—<\/td>/);
  assert.doesNotMatch(html,/Offer capacity|proc-external-inquiry|proc-opportunity/);assert.match(html,/Sourced requirement/);
});

test('external details retain ranges, optional price and source terms without fake dates',async()=>{
  const row=external({quantity:{minNodes:64,maxNodes:128,gpusPerNode:8,totalGpusMin:512},rentalMonths:{min:12,max:24,options:[12,24],notes:'Annual terms preferred.'},price:null,description:'Required <network> & storage.'});
  const f=await fixture({rows:[row]});f.X.matches(f.S,'demand');const html=f.P.modal(f.c,'proc-listing',{id:row.id}).body;
  assert.match(html,/64–128 nodes · 512\+ GPUs/);assert.match(html,/Commitment · 12 \/ 24 months/);assert.match(html,/Buyer target price<\/small><strong>To confirm/);
  assert.match(html,/Required &lt;network&gt; &amp; storage/);assert.match(html,/Annual terms preferred/);
  assert.doesNotMatch(html,/Quote deadline|Start time|Delivery method|\/ GPU-hour<\/strong>.*NaN|\$0\.00|Verified buyer/);
  assert.match(html,/does not place an order or confirm a buyer account/);
});

test('same-model sourced recommendations cannot claim precise matching and never enter settlements',async()=>{
  const row=external({bestMatch:true,settledAt:new Date().toISOString()}),f=await fixture({rows:[row],best:[row,external({id:'WRONG',model:'H100'})],recent:[row]});
  const best=f.P.matches(f.c,'best');assert.match(best,/Sourced recommendation/);assert.doesNotMatch(best,/Matches your submitted requirements|data-match-id="WRONG"/);
  assert.match(best,/Commitment · From 12 months/);assert.equal(f.X.recent(f.S,3).length,0);assert.doesNotMatch(f.P.matches(f.c,'recent'),/data-match-id="EXT/);
});

test('Offer capacity opens existing operations Contact with external ID and no quote or order write',async()=>{
  const f=await fixture();f.X.matches(f.S,'demand');const before=JSON.stringify({orders:f.S.orders,rfqs:f.S.rfqs,responses:f.S.responses});
  f.P.action(f.c,'proc-external-inquiry',{dataset:{id:'EXT-LARGE-1'}});
  assert.equal(f.contacts.length,1);assert.match(f.contacts[0].message,/OpenNEXT requirement: EXT-LARGE-1/);assert.match(f.contacts[0].message,/128 nodes · 1,024\+ GPUs/);
  assert.doesNotMatch(f.contacts[0].message,/Packet|packet\.ai/);assert.ok(f.calls.every(call=>call.method==='GET'));
  assert.equal(JSON.stringify({orders:f.S.orders,rfqs:f.S.rfqs,responses:f.S.responses}),before);
});

test('Buyer cannot enter external supplier inquiry and direct external quote submission is blocked',async()=>{
  const f=await fixture({role:'Buyer'});f.X.matches(f.S,'demand');f.P.opportunity(f.c,'EXT-LARGE-1','offer');assert.equal(f.contacts.length,0);assert.match(f.toasts[0],/Seller account/);
  f.P.submit(f.c,{dataset:{form:'proc-response',id:'EXT-LARGE-1'},querySelector(){return null;}},{rate:2});
  assert.ok(f.calls.every(call=>call.method==='GET'));assert.match(f.toasts.at(-1),/contact OpenNEXT operations/);
  assert.equal(f.X.sampleQuotes(external()).length,0);assert.throws(()=>f.X.accept(f.S,external(),{}),/OpenNEXT operations/);
});

test('external region matching is retained in Best Matches and seller requirement summary',async()=>{
  const row=external({region:'Europe',regionScope:{type:'europe'}}),f=await fixture({rows:[row],filters:{region:'Frankfurt'}});
  assert.match(f.P.matches(f.c,'best'),/data-match-id="EXT-LARGE-1"/);
  const summary=f.P.supplyDemand(f.c);assert.match(summary,/128 nodes · 1,024\+ GPUs/);assert.match(summary,/Commitment/);assert.doesNotMatch(summary,/undefinedh|undefined GPU/);
  f.S.region='Singapore';assert.doesNotMatch(f.P.matches(f.c,'best'),/data-match-id="EXT-LARGE-1"/);
});

test('external supply uses sourced offer wording and only Buyer can contact operations',async()=>{
  const row=external({id:'EXT-OFFER-1',side:'supply',provider:'Sourced offer',title:'B200 cluster offer'}),buyer=await fixture({role:'Buyer',rows:[]});
  buyer.X.get=()=>row;
  const details=buyer.P.modal(buyer.c,'proc-listing',{id:row.id}).body;
  assert.match(details,/Sourced offer/);assert.match(details,/Request quote/);assert.doesNotMatch(details,/Offer capacity|confirm a buyer account/);
  buyer.P.opportunity(buyer.c,row.id,'buy');assert.match(buyer.contacts[0].message,/request a quote for this sourced offer/);assert.match(buyer.contacts[0].message,/OpenNEXT offer: EXT-OFFER-1/);assert.equal(buyer.S.orders.length,0);
  const seller=await fixture();seller.X.get=()=>row;
  assert.doesNotMatch(seller.P.modal(seller.c,'proc-listing',{id:row.id}).body,/proc-external-inquiry/);
  seller.P.opportunity(seller.c,row.id,'buy');assert.equal(seller.contacts.length,0);assert.match(seller.toasts[0],/Buyer account/);
});
