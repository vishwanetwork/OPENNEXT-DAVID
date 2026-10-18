'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createMarketplaceService,createMarketplaceRouter}=require('../OpenNEXT-marketplace-service.cjs');
const DAY=86400000,epoch=Date.parse('2026-10-18T12:00:00.000Z');
async function fixture(t){
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),'on-settlement-history-'));
  t.after(()=>fs.rm(dataDir,{recursive:true,force:true}));
  const order=(id,age,status='Completed')=>({id,model:'H100',region:'United States',term:'Spot',count:8,hours:24,unitPrice:2.1,status,settledAt:new Date(epoch-age).toISOString()});
  const orders=[order('older',90*DAY+1),order('boundary',90*DAY),order('month',30*DAY),order('week',7*DAY),order('recent',3*DAY),order('today',0),order('future',-1),order('unsettled',0,'Pending'),{...order('invalid',0),settledAt:'not-a-date'}];
  await fs.writeFile(path.join(dataDir,'marketplace.json'),JSON.stringify({version:2,rfqs:[],supplies:[],kyb:[],interests:[],instances:[],quotes:[],orders,notifications:[],audit:[],homepageReviews:[]}));
  const service=createMarketplaceService({dataDir,now:()=>epoch}),route=createMarketplaceRouter(service);
  const request=async query=>{
    let status,result;const res={writeHead:code=>status=code,end:value=>result=JSON.parse(value)};
    await route({method:'GET',headers:{}},res,new URL('https://terminal.test/api/marketplace/settlements'+query));
    return {status,result};
  };
  return {service,request};
}
test('settlement history includes the exact 90-day boundary and excludes future, invalid, unpaid and older records',async t=>{
  const {service,request}=await fixture(t);
  assert.deepEqual((await service.recent(90)).map(row=>row.id),['boundary','month','week','recent','today']);
  assert.deepEqual((await service.recent()).map(row=>row.id),['recent','today']);
  const response=await request('?days=90');assert.equal(response.status,200);
  assert.deepEqual(response.result.rows.map(row=>row.id),['boundary','month','week','recent','today']);
  assert.equal(response.result.rows[0].price,2.1);
});
test('all advertised free settlement windows work through either period or day filters',async t=>{
  const {request}=await fixture(t);
  for(const [period,days] of [['1D',1],['3D',3],['1W',7],['1M',30],['3M',90]]){
    const byPeriod=await request('?period='+period),byDays=await request('?days='+days);
    assert.equal(byPeriod.status,200,period);assert.equal(byDays.status,200,period);
    assert.deepEqual(byPeriod.result.rows,byDays.result.rows,period);
  }
  assert.equal((await request('?period=%203m%20')).status,200);
});
test('extended settlement windows require history access and cannot fall back to a free window',async t=>{
  const {service,request}=await fixture(t);
  for(const value of [91,180,365,'ALL'])await assert.rejects(service.recent(value),{status:403,code:'HISTORY_ACCESS_REQUIRED'});
  for(const query of ['?period=6M','?period=1Y','?period=ALL','?days=91','?days=180','?days=365','?days=ALL']){
    const response=await request(query);assert.equal(response.status,403,query);
    assert.equal(response.result.code,'HISTORY_ACCESS_REQUIRED');assert.match(response.result.error,/up to 3 months.*Contact Sales/);
  }
});
test('ambiguous or malformed settlement windows are rejected before reading history',async t=>{
  const {service,request}=await fixture(t);
  for(const value of [0,-1,1.5,NaN,Infinity,'invalid'])await assert.rejects(service.recent(value),{status:400});
  for(const query of ['?days=3&days=180','?period=3M&period=6M','?period=3M&days=3','?period=invalid','?period=','?days=','?days=0','?days=-1','?days=1.5','?days=NaN'])assert.equal((await request(query)).status,400,query);
});
