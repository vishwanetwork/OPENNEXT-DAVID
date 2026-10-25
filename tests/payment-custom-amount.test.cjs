'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function fixture(){
  const listeners={},window={crypto:{randomUUID:()=> 'payment-test-key'},document:{addEventListener:(name,handler)=>{listeners[name]=handler;}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../OpenNEXT-payments.js'),'utf8'),{window,Intl,URL});
  const toasts=[],opened=[],c={S:{credit:100},toast:value=>toasts.push(value),open:value=>opened.push(value)};
  let selected='100';
  const other={get checked(){return selected==='other';},set checked(value){if(value)selected='other';}};
  const form={dataset:{form:'payment-amount',orderId:'ORDER-1'},querySelector:selector=>selector==='input[name="preset"][value="other"]'?other:null};
  const custom={name:'custom',value:'',closest:selector=>selector==='form[data-form="payment-amount"]'?form:null};
  return {api:window.OpenNEXTPayments,c,toasts,opened,listeners,form,custom,other,setPreset:value=>{selected=value;},data:()=>({preset:selected,custom:custom.value})};
}

test('typing Other amount selects Other and uses the entered cents in the top-up summary',()=>{
  const f=fixture();f.custom.value='247.39';f.listeners.input({target:f.custom});
  assert.equal(f.other.checked,true);
  assert.equal(f.api.submit(f.c,f.form,f.data()),true);
  assert.equal(f.c.S.paymentDraft.amount,247.39);
  assert.equal(f.c.S.paymentDraft.orderId,'ORDER-1');
  assert.deepEqual(f.opened,['payment-method']);
  assert.match(f.api.modal(f.c,'payment-method').body,/<strong>\$247\.39<\/strong>/);
  assert.equal(f.c.S.credit,100);
});

test('Other amount changes select Other, while a later explicit preset selection wins',()=>{
  const f=fixture();f.custom.value='999.99';f.listeners.change({target:f.custom});
  assert.equal(f.other.checked,true);
  f.setPreset('500');f.api.submit(f.c,f.form,f.data());
  assert.equal(f.c.S.paymentDraft.amount,500);
  assert.match(f.api.modal(f.c,'payment-method').body,/<strong>\$500\.00<\/strong>/);
});

test('clearing Other amount does not silently submit the previous preset',()=>{
  const f=fixture();f.custom.value='123';f.listeners.input({target:f.custom});
  f.custom.value='';f.listeners.input({target:f.custom});f.api.submit(f.c,f.form,f.data());
  assert.equal(f.other.checked,true);assert.equal(f.c.S.paymentDraft,undefined);
  assert.equal(f.opened.length,0);assert.equal(f.toasts.length,1);
});

test('custom amounts preserve bounds and decimal validation',()=>{
  for(const value of ['0','-1','100000.01','1.001','Infinity','invalid']){
    const f=fixture();f.custom.value=value;f.listeners.input({target:f.custom});f.api.submit(f.c,f.form,f.data());
    assert.equal(f.c.S.paymentDraft,undefined,value);assert.equal(f.toasts.length,1,value);
  }
  for(const value of ['1.00','1.10','39.99','100000.00']){
    const f=fixture();f.custom.value=value;f.listeners.input({target:f.custom});f.api.submit(f.c,f.form,f.data());
    assert.equal(f.c.S.paymentDraft.amount,Number(value));assert.equal(f.toasts.length,0);
  }
});

test('input events outside the Add credit form do not change payment selection',()=>{
  const f=fixture();
  f.listeners.input({target:{name:'custom',closest:()=>null}});
  f.listeners.input({target:{name:'email',closest:()=>f.form}});
  f.listeners.change({target:{name:'preset',closest:()=>f.form}});
  assert.equal(f.other.checked,false);
  f.api.submit(f.c,f.form,f.data());assert.equal(f.c.S.paymentDraft.amount,100);
});
