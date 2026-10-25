'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const field=value=>{const bytes=Buffer.from(value),size=Buffer.alloc(4);size.writeUInt32BE(bytes.length);return Buffer.concat([size,bytes]);};
const publicBytes=crypto.generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).subarray(-32);
const publicKey='ssh-ed25519 '+Buffer.concat([field('ssh-ed25519'),field(publicBytes)]).toString('base64');
function fixture(){
  const storage=new Map(),lists=[{innerHTML:''},{innerHTML:''}],opens=[],messages=[];
  const sandbox={Intl,Date,Map,Set,Uint8Array,crypto:crypto.webcrypto,atob,btoa,console,OpenNEXTDemo:{active:true},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},document:{querySelector:selector=>selector==='[data-account-key-library]'?{}:null,querySelectorAll:selector=>selector==='[data-account-ssh-list]'?lists:[]}};
  vm.createContext(sandbox);for(const file of ['OpenNEXT-account-profile-preview.js','OpenNEXT-instances.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),sandbox);
  const context={S:{auth:true,user:{id:'demo-buyer-access',demo:true},role:'Buyer',identity:{},instances:[],orders:[],route:'instances'},render(){},toast:message=>messages.push(message),open(type,data){this.S.modal={type,...data};opens.push({type,...data});}};
  return {sandbox,storage,lists,opens,messages,context,account:sandbox.OpenNEXTAccountProfile,instances:sandbox.OpenNEXTInstances};
}
function form(){const error={textContent:''},button={isConnected:true};return {dataset:{form:'account-ssh-add'},isConnected:true,querySelector:selector=>selector==='[type="submit"]'?button:error};}

test('Instances uses the Profile public-key library with no API credentials',async()=>{
  const f=fixture();await f.account.bind(f.context);
  const body=f.instances.page(f.context);
  assert.match(body,/data-account-key-library/);assert.match(body,/account-ssh-title-instances/);assert.match(body,/No saved keys yet/);
  assert.match(body,/data-act="account-ssh-add"/);assert.doesNotMatch(body,/API credentials|API key|api-key|name="ssh"|Credentials/);
  assert.match(f.account.page(f.context),/account-ssh-title-profile/);
  assert.equal(f.account.validatePublicKey(publicKey).material,publicKey);
  assert.match(await f.account.fingerprint(f.account.validatePublicKey(publicKey)),/^SHA256:/);
});

test('binding on Instances loads and repaints all visible library copies',async()=>{
  const f=fixture();
  await f.account.testHelpers.changeKey(f.context,form(),{label:'Instance access key',publicKey});
  await f.account.testHelpers.loadKeys(f.context,{force:true});
  assert.equal(f.storage.size,1);
  assert.match([...f.storage.keys()][0],/^opennext:demo:account-ssh:v1:/);
  for(const list of f.lists)assert.match(list.innerHTML,/Instance access key/);
  assert.match(f.instances.page(f.context),/Instance access key/);
  assert.match(f.account.page(f.context),/Instance access key/);
  assert.equal(f.context.S.identity.ssh,undefined);
  f.context.S.user={id:'different-demo-user',demo:true};await f.account.bind(f.context);
  for(const list of f.lists)assert.doesNotMatch(list.innerHTML,/Instance access key/);
});

test('instance Manage offers SSH library without pretending to install keys',()=>{
  const f=fixture(),resource={id:'active-instance',model:'H100',count:8,region:'Singapore',term:'Spot',status:'Running',rate:2.3,serviceEnd:new Date(Date.now()+3600000).toISOString()};
  f.context.S.instances=[resource];
  assert.match(f.instances.modal(f.context,'instance-manage',{id:resource.id}).body,/data-act="instance-access"/);
  assert.equal(f.instances.action(f.context,'instance-access',{dataset:{id:resource.id}}),true);
  assert.equal(f.opens[0].type,'instance-access');
  const dialog=f.instances.modal(f.context,'instance-access',f.opens[0]);
  assert.match(dialog.body,/account-ssh-title-instance-access/);assert.match(dialog.body,/Singapore/);
  assert.match(dialog.body,/key installation is not connected yet/);assert.match(dialog.body,/does not install it/);
  assert.doesNotMatch(dialog.body,/API credentials|Attached|Installed/);
  assert.equal(resource.sshPublicKey,undefined);
  assert.match(f.instances.modal(f.context,'instance-example-manage').body,/data-act="instance-access"[^>]*data-example="true"/);
  assert.match(f.instances.modal(f.context,'instance-access',{example:true}).body,/no server to connect to/);
});
