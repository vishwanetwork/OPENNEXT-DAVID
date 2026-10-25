'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const http=require('node:http');
const {createDemoData,MODELS}=require('../OpenNEXT-demo-fixtures.cjs');
const {createDemoService}=require('../OpenNEXT-demo-service.cjs');
const clock=Date.parse('2026-10-18T00:00:00Z');
const regions=['Canada','Germany','Japan','Singapore','United Kingdom','United States'];
const round=value=>Math.round(value*100)/100;
const fixtureId=(prefix,key)=>prefix+'-'+crypto.createHash('sha256').update(key).digest('hex').slice(0,16).toUpperCase();
const distribution=rows=>Object.fromEntries(regions.map(region=>[region,rows.filter(row=>row.region===region).length]));
const even=Object.fromEntries(regions.map(region=>[region,2]));

test('demo region rotation preserves every existing listing identity, price and capacity',()=>{
  const data=createDemoData(clock);
  assert.equal(data.rfqs.length,117);assert.equal(data.supplies.length,117);assert.equal(data.orders.length,78);
  for(const [model,base] of MODELS){
    for(let index=0;index<9;index++){
      const key=model+'-'+index;
      const supply=data.supplies.find(row=>row.id===fixtureId('SUP',key));
      const rfq=data.rfqs.find(row=>row.id===fixtureId('RFQ',key));
      assert.ok(supply);assert.ok(rfq);
      assert.equal(supply.netPrice,round(base*[.93,1.02,.98,1.08,1.04,1.01,1.24,1.20,.91][index]));
      assert.equal(supply.buyerPrice,supply.netPrice);
      assert.equal(supply.count,[64,32,128,16,48,24,64,32,128][index]);
      assert.equal(supply.term,index<6?'Spot':index<8?'On-demand':'Reserved');
      assert.equal(rfq.budget,round(base*[1.34,1.18,1.23,1.27,1.16,1.21,1.42,1.38,1.15][index]));
      assert.equal(rfq.count,[8,16,32,8,16,8,32,8,64][index]);
      assert.ok(rfq.notes.includes(' in '+rfq.region+'.'));
    }
  }
  assert.deepEqual(data,createDemoData(clock),'data generation stays deterministic');
});

test('each demo GPU model retains all six regions and settled orders match their supply region',()=>{
  const data=createDemoData(clock);
  for(const [model] of MODELS){
    assert.deepEqual([...new Set(data.supplies.filter(row=>row.model===model).map(row=>row.region))].sort(),regions);
    assert.deepEqual([...new Set(data.rfqs.filter(row=>row.model===model).map(row=>row.region))].sort(),regions);
  }
  for(const order of data.orders){
    const supply=data.supplies.find(row=>row.id===order.supplyId);
    assert.equal(order.region,supply.region);
    assert.equal(order.model,supply.model);
    assert.equal(order.sellerId,supply.ownerId);
  }
});

test('lowest supply and highest RFQ demo winners are evenly distributed without changing price selection',()=>{
  const data=createDemoData(clock),supplies=[],rfqs=[];
  for(const [model] of MODELS.filter(([model])=>model!=='B300')){
    supplies.push(data.supplies.filter(row=>row.model===model).sort((a,b)=>a.netPrice-b.netPrice)[0]);
    rfqs.push(data.rfqs.filter(row=>row.model===model).sort((a,b)=>b.budget-a.budget)[0]);
  }
  assert.deepEqual(distribution(supplies),even);
  assert.deepEqual(distribution(rfqs),even);
});

test('public demo showcase and guest market both expose balanced approved regional listings',async t=>{
  const service=createDemoService({secureCookies:false,now:()=>clock});
  const server=http.createServer(async(req,res)=>{
    if(!await service.handle(req,res,new URL(req.url,'http://localhost'))){res.writeHead(404);res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await service.close();});
  const response=await fetch(origin+'/api/demo/showcase');
  assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);
  const showcase=await response.json();
  assert.equal(showcase.demo,true);
  assert.deepEqual(distribution(showcase.featured.rfqs),even);
  assert.deepEqual(distribution(showcase.featured.supplies),even);
  for(const lane of ['rfqs','supplies']){
    assert.equal(showcase.featured[lane].length,12);
    assert.ok(!showcase.featured[lane].some(row=>row.model==='B300'),'unapproved B300 remains excluded');
    assert.ok(new Set(showcase.featured[lane].slice(0,5).map(row=>row.region)).size>=4,'the first five cards are regionally varied');
  }
  const start=await fetch(origin+'/api/demo/start',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"role":"buyer"}'});
  assert.equal(start.status,200);
  const cookie=start.headers.get('set-cookie').split(';')[0];
  const guest=await(await fetch(origin+'/api/demo/marketplace/public',{headers:{Cookie:cookie}})).json();
  for(const lane of ['rfqs','supplies'])assert.deepEqual(guest.featured[lane],showcase.featured[lane]);
});
