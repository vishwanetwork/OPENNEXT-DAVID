'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'OpenNEXT-account-profile-preview.js'),'utf8');
const field=bytes=>{const data=Buffer.from(bytes),length=Buffer.alloc(4);length.writeUInt32BE(data.length);return Buffer.concat([length,data]);};
const wire=(type,...parts)=>type+' '+Buffer.concat([field(type),...parts.map(field)]).toString('base64');
const edBytes=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).subarray(-32);
const publicKey=wire('ssh-ed25519',edBytes);
function runtime(adapter){
  const storage=new Map(),sandbox={crypto:crypto.webcrypto,atob,btoa,Uint8Array,Date,console,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},OpenNEXTAccountService:adapter};
  vm.runInContext(source,vm.createContext(sandbox));return {api:sandbox.OpenNEXTAccountProfile,storage,sandbox};
}
function context(demo=true,id='one'){
  const messages=[],opened=[];
  return {S:{auth:true,user:{id,name:'Verified User',email:'verified@example.invalid',provider:'google',demo},identity:{name:'Stale Identity',email:'stale@example.invalid'},role:'Buyer',review:{status:'Not started'},modal:null},messages,opened,render(){},toast(message){messages.push(message);},open(type,data){this.S.modal={type,...data};opened.push({type,...data});}};
}
function form(type,id){const button={disabled:false,isConnected:true},error={textContent:''};return {dataset:{form:type,id},isConnected:true,button,error,querySelector:selector=>selector==='[type="submit"]'?button:error};}

test('profile and SSH public-key workflow',async t=>{
  await t.test('real profile uses verified session identity; Demo hides fixtures',()=>{
    const {api}=runtime(),real=context(false),demo=context();
    assert.match(api.page(real),/Verified User/);assert.match(api.page(real),/verified@example\.invalid/);assert.match(api.page(real),/Google/);
    assert.doesNotMatch(api.page(real),/Stale Identity|stale@example|<dt>Role|<dt>Company/);
    assert.match(api.page(demo),/Your profile/);assert.doesNotMatch(api.page(demo),/Verified User|verified@example|Stale Identity|Google/);
    assert.equal((api.page(demo).match(/<dd>—<\/dd>/g)||[]).length,3);
    assert.equal(real.S.user.name,'Verified User');
  });
  await t.test('add form has empty fields and no private-key material',()=>{
    const {api}=runtime(),dialog=api.modal(context(),'account-ssh-add');
    assert.match(dialog.body,/name="label"/);assert.match(dialog.body,/name="publicKey"/);
    assert.doesNotMatch(dialog.body,/value="/);assert.match(dialog.body,/<textarea[^>]*><\/textarea>/);
    assert.match(dialog.body,/not automatically added/);
  });
  await t.test('valid ED25519 key and fingerprint match OpenSSH SHA-256 convention',async()=>{
    const {api}=runtime(),parsed=api.testHelpers.validatePublicKey(publicKey+' workstation');
    assert.equal(parsed.material,publicKey);assert.equal(parsed.publicKey,publicKey+' workstation');
    const digest=crypto.createHash('sha256').update(Buffer.from(publicKey.split(' ')[1],'base64')).digest('base64').replace(/=+$/,'');
    assert.equal(await api.testHelpers.fingerprint(parsed),'SHA256:'+digest);
  });
  await t.test('rejects private, multiline, malformed and mismatched encoded algorithms',()=>{
    const {api}=runtime(),validate=api.testHelpers.validatePublicKey;
    for(const invalid of ['-----BEGIN OPENSSH PRIVATE KEY-----','ssh-ed25519 aaaa\nssh-ed25519 aaaa','ssh-ed25519 !!!','ssh-rsa '+publicKey.split(' ')[1],wire('ssh-ed25519',Buffer.alloc(31)),publicKey.slice(0,-5),'ssh-ed25519 '+Buffer.concat([field('ssh-ed25519'),field(edBytes),Buffer.from([1])]).toString('base64')])assert.throws(()=>validate(invalid));
  });
  await t.test('accepts RSA 2048 structure and rejects weak or malformed modulus',()=>{
    const {api}=runtime(),validate=api.testHelpers.validatePublicKey;
    const modulus=Buffer.alloc(257,7);modulus[0]=0;modulus[1]=128;
    assert.equal(validate(wire('ssh-rsa',Buffer.from([1,0,1]),modulus)).algorithm,'ssh-rsa');
    assert.throws(()=>validate(wire('ssh-rsa',Buffer.from([1,0,1]),Buffer.alloc(129,7))));
    assert.throws(()=>validate(wire('ssh-rsa',Buffer.from([2]),modulus)));
  });
  await t.test('ECDSA curve and point must both validate',async()=>{
    const {api}=runtime(),jwk=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'jwk'});
    const point=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]);
    const valid=api.testHelpers.validatePublicKey(wire('ecdsa-sha2-nistp256','nistp256',point));
    assert.match(await api.testHelpers.fingerprint(valid),/^SHA256:/);
    assert.throws(()=>api.testHelpers.validatePublicKey(wire('ecdsa-sha2-nistp256','nistp384',point)));
    const bad=Buffer.alloc(65);bad[0]=4;
    await assert.rejects(()=>api.testHelpers.fingerprint(api.testHelpers.validatePublicKey(wire('ecdsa-sha2-nistp256','nistp256',bad))));
  });
  await t.test('Demo starts empty; add persists only public key in identity-specific storage',async()=>{
    const {api,storage}=runtime(),ctx=context(),h=api.testHelpers;
    await h.loadKeys(ctx);assert.equal(h.store(ctx).keys.length,0);
    await h.changeKey(ctx,form('account-ssh-add'),{label:'Laptop',publicKey});
    assert.equal(h.store(ctx).keys.length,1);assert.equal(storage.size,1);
    const [storageKey,value]=[...storage.entries()][0];assert.equal(storageKey,'opennext:demo:account-ssh:v1:one');
    assert.match(value,/Laptop/);assert.match(value,/ssh-ed25519/);assert.doesNotMatch(value,/PRIVATE|verified@example|Verified User/);
    const another=context(true,'two');await h.loadKeys(another);assert.equal(h.store(another).keys.length,0);
    const real=context(false,'one');await h.loadKeys(real);assert.equal(h.store(real).keys.length,0);
    assert.match(h.store(real).error,/not connected/);
  });
  await t.test('duplicate key detection ignores a changed comment and preserves form',async()=>{
    const {api}=runtime(),ctx=context(),h=api.testHelpers;
    await h.changeKey(ctx,form('account-ssh-add'),{label:'Laptop',publicKey});
    const second=form('account-ssh-add');ctx.S.modal={type:'account-ssh-add'};
    await h.changeKey(ctx,second,{label:'Another name',publicKey:publicKey+' another-comment'});
    assert.equal(h.store(ctx).keys.length,1);assert.match(second.error.textContent,/already been added/);
    assert.equal(ctx.S.modal.type,'account-ssh-add');assert.equal(second.button.disabled,false);
  });
  await t.test('Remove action requires confirmation and does not touch instance access',async()=>{
    const {api}=runtime(),ctx=context(),h=api.testHelpers;ctx.S.instances=[{id:'resource',ssh:'unchanged'}];
    await h.changeKey(ctx,form('account-ssh-add'),{label:'Laptop',publicKey});
    const key=h.store(ctx).keys[0];api.action(ctx,'account-ssh-remove',{dataset:{id:key.id}});
    assert.equal(h.store(ctx).keys.length,1);assert.equal(ctx.S.modal.type,'account-ssh-remove');
    assert.match(api.modal(ctx,'account-ssh-remove',{id:key.id}).body,/does not revoke access/);
    await h.changeKey(ctx,form('account-ssh-remove',key.id),{});
    assert.equal(h.store(ctx).keys.length,0);assert.equal(ctx.S.instances[0].ssh,'unchanged');
  });
  await t.test('unconfigured real account cannot be locally saved or pretend success',async()=>{
    const {api,storage}=runtime(),ctx=context(false),f=form('account-ssh-add');
    assert.match(api.modal(ctx,'account-ssh-add').body,/not connected/);assert.match(api.modal(ctx,'account-ssh-add').body,/type="submit" class="btn" disabled/);
    await api.testHelpers.changeKey(ctx,f,{label:'Laptop',publicKey});
    assert.equal(storage.size,0);assert.equal(api.testHelpers.store(ctx).keys.length,0);assert.match(f.error.textContent,/No account changes/);
  });
  await t.test('confirmed real adapter saves/removes without Demo storage or owner parameters',async()=>{
    let keys=[],received;
    const adapter={listSshKeys:async()=>({keys}),addSshKey:async input=>{received=input;const key={...input,id:'backend-key',createdAt:new Date().toISOString()};keys.push(key);return {confirmed:true,key};},removeSshKey:async({id})=>{keys=keys.filter(key=>key.id!==id);return {confirmed:true,id};}};
    const {api,storage}=runtime(adapter),ctx=context(false),h=api.testHelpers;
    await h.changeKey(ctx,form('account-ssh-add'),{label:'Laptop',publicKey});
    assert.equal(h.store(ctx).keys.length,1);assert.deepEqual(Object.keys(received).sort(),['label','publicKey']);assert.equal(storage.size,0);
    await h.changeKey(ctx,form('account-ssh-remove','backend-key'),{});assert.equal(h.store(ctx).keys.length,0);assert.equal(storage.size,0);
  });
  await t.test('unconfirmed real adapter response never updates visible account key state',async()=>{
    const {api}=runtime({listSshKeys:async()=>({keys:[]}),addSshKey:async()=>({confirmed:false})}),ctx=context(false),f=form('account-ssh-add');
    await api.testHelpers.changeKey(ctx,f,{label:'Laptop',publicKey});
    assert.equal(api.testHelpers.store(ctx).keys.length,0);assert.match(f.error.textContent,/not confirmed/);
  });
  await t.test('KYC uses existing Seller review and never approves Buyer identity',()=>{
    const {api}=runtime(),buyer=context(),seller=context();seller.S.role='Seller';seller.S.review.status='Reviewing';
    api.action(seller,'account-verification',{dataset:{}});assert.equal(seller.opened[0].type,'review');assert.match(api.page(seller),/Reviewing/);
    api.action(buyer,'account-verification',{dataset:{}});assert.equal(buyer.opened[0].type,'account-verification');
    assert.match(api.modal(buyer,'account-verification').body,/no approval has been granted/);assert.equal(buyer.S.review.status,'Not started');
  });
  await t.test('user-provided labels and profile fields are escaped',async()=>{
    const {api}=runtime(),ctx=context(),h=api.testHelpers;
    await h.changeKey(ctx,form('account-ssh-add'),{label:'<img src=x onerror=alert(1)>',publicKey});
    assert.doesNotMatch(api.page(ctx),/<img/);assert.match(api.page(ctx),/&lt;img/);
    const real=context(false);real.S.user.name='<script>x</script>';assert.doesNotMatch(api.page(real),/<script>/);
  });
});
