(function(root) {
  'use strict';
  const states=new Map(),operations=new Set(),MAX_KEYS=50;
  const STORAGE_PREFIX='opennext:demo:account-ssh:v1:';
  const UNCONFIGURED='SSH key management is not connected yet. No account changes have been made.';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const svg=(body,cls='')=>`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const icons={user:svg('<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>'),key:svg('<circle cx="8" cy="8" r="4.5"/><path d="m11.3 11.3 9 9m-4-4 2-2m-.5 4.5 2-2"/>'),shield:svg('<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8.5 12 2.3 2.3 4.7-4.8"/>'),copy:svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>'),settings:svg('<path d="m10 3-.5 2-2 .9-1.8-.7-2 3.5 1.5 1.3v2l-1.5 1.3 2 3.5 1.8-.7 2 .9.5 2h4l.5-2 2-.9 1.8.7 2-3.5-1.5-1.3v-2l1.5-1.3-2-3.5-1.8.7-2-.9L14 3Z"/><circle cx="12" cy="11" r="3"/>')};
  function account(ctx){
    const user=ctx.S?.user||{},demo=Boolean(root.OpenNEXTDemo?.active||user.demo),id=typeof user.id==='string'?user.id:'';
    return {user,demo,id,key:(demo?'demo:':'account:')+id,available:Boolean(id&&ctx.S?.auth!==false)};
  }
  function identity(ctx){
    const a=account(ctx);if(a.demo||!a.available)return {name:'',email:'',provider:''};
    const provider=a.user.provider||a.user.signInProvider||a.user.authProvider;
    const providers=provider?[provider]:Array.isArray(a.user.identities)?a.user.identities.map(item=>item.provider):[];
    const labels={google:'Google',github:'GitHub',email:'Email verification',microsoft:'Microsoft',sso:'Company SSO',passkey:'Passkey'};
    return {name:String(a.user.name||'').slice(0,160),email:String(a.user.email||'').slice(0,254),provider:[...new Set(providers.filter(value=>typeof value==='string').map(value=>labels[value.toLowerCase()]||value.slice(0,80)))].join(', ')};
  }
  function current(ctx,key){return account(ctx).key===key&&account(ctx).available;}
  function store(ctx){
    const a=account(ctx);if(!states.has(a.key))states.set(a.key,{keys:[],loaded:false,loading:false,loadedAt:0,error:'',adapter:null});return states.get(a.key);
  }
  function decodeBase64(value){
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(value)||value.length%4===1)throw new Error('The public key contains invalid Base64 data.');
    let binary;try{binary=root.atob(value);}catch{throw new Error('The public key contains invalid Base64 data.');}
    if(root.btoa(binary).replace(/=+$/,'')!==value.replace(/=+$/,''))throw new Error('The public key encoding is not valid.');
    return Uint8Array.from(binary,char=>char.charCodeAt(0));
  }
  function validatePublicKey(value){
    const text=String(value??'').trim();
    if(!text||text.length>16384)throw new Error('Enter one SSH public key, up to 16,384 characters.');
    if(/[\r\n\x00-\x1F\x7F]/.test(text)||/PRIVATE KEY|BEGIN |END /i.test(text))throw new Error('Use a single-line public key only. Never upload a private key.');
    const parts=/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) +([A-Za-z0-9+/=]+)(?: +([^\r\n]{0,254}))?$/.exec(text);
    if(!parts)throw new Error('Use an ED25519, RSA or ECDSA OpenSSH public key.');
    const algorithm=parts[1],bytes=decodeBase64(parts[2]);let cursor=0;
    function field(){if(cursor+4>bytes.length)throw new Error('The public key is incomplete.');const size=((bytes[cursor]*0x1000000)+(bytes[cursor+1]<<16)+(bytes[cursor+2]<<8)+bytes[cursor+3]);cursor+=4;if(size>bytes.length-cursor)throw new Error('The public key is incomplete.');const result=bytes.slice(cursor,cursor+size);cursor+=size;return result;}
    const ascii=bytes=>Array.from(bytes,code=>String.fromCharCode(code)).join('');
    if(ascii(field())!==algorithm)throw new Error('The encoded algorithm does not match the public key type.');
    if(algorithm==='ssh-ed25519'){if(field().length!==32)throw new Error('An ED25519 public key must contain 32 bytes.');}
    else if(algorithm==='ssh-rsa'){
      const exponent=field(),modulus=field();
      const unsigned=value=>value.length>0&&!(value[0]&128)&&!(value.length>1&&value[0]===0&&!(value[1]&128));
      let exp=0n;for(const byte of exponent)exp=(exp<<8n)+BigInt(byte);
      const number=modulus[0]===0?modulus.slice(1):modulus,bits=number.length?8*(number.length-1)+Math.floor(Math.log2(number[0]))+1:0;
      if(!unsigned(exponent)||!unsigned(modulus)||exponent.length>8||exp<3n||exp%2n===0n||bits<2048||bits>8192||!(number[number.length-1]&1))throw new Error('Use a valid RSA public key between 2,048 and 8,192 bits.');
    }else{
      const curve=algorithm.replace('ecdsa-sha2-',''),point=field.call(null);
      if(ascii(point)!==curve)throw new Error('The encoded curve does not match the public key type.');
      const publicPoint=field(),expected={nistp256:65,nistp384:97,nistp521:133}[curve];
      if(publicPoint.length!==expected||publicPoint[0]!==4)throw new Error('The ECDSA public point is not valid.');
    }
    if(cursor!==bytes.length)throw new Error('The public key contains unexpected encoded data.');
    const material=algorithm+' '+root.btoa(Array.from(bytes,byte=>String.fromCharCode(byte)).join(''));
    return {algorithm,material,publicKey:material+(parts[3]?' '+parts[3].trim():''),bytes};
  }
  async function fingerprint(parsed){
    if(!root.crypto?.subtle)throw new Error('Secure key validation is unavailable in this browser.');
    if(parsed.algorithm.startsWith('ecdsa-sha2-')){
      const curves={'ecdsa-sha2-nistp256':['P-256',65],'ecdsa-sha2-nistp384':['P-384',97],'ecdsa-sha2-nistp521':['P-521',133]},[namedCurve,length]=curves[parsed.algorithm];
      try{await root.crypto.subtle.importKey('raw',parsed.bytes.slice(-length),{name:'ECDSA',namedCurve},false,['verify']);}catch{throw new Error('The ECDSA public point is not valid.');}
    }
    const hash=new Uint8Array(await root.crypto.subtle.digest('SHA-256',parsed.bytes));
    return 'SHA256:'+root.btoa(Array.from(hash,value=>String.fromCharCode(value)).join('')).replace(/=+$/,'');
  }
  function keyLabel(value){const label=String(value??'').trim();if(!label||label.length>80||/[\x00-\x1F\x7F]/.test(label))throw new Error('Enter a label between 1 and 80 characters.');return label;}
  async function normalizeKey(row){
    if(!row||typeof row.id!=='string'||!row.id||row.id.length>200)throw new Error('The account service returned an invalid SSH key record.');
    const parsed=validatePublicKey(row.publicKey),label=keyLabel(row.label),date=Date.parse(row.createdAt);
    return {id:row.id,label,publicKey:parsed.publicKey,material:parsed.material,algorithm:parsed.algorithm,fingerprint:await fingerprint(parsed),createdAt:Number.isFinite(date)?new Date(date).toISOString():null};
  }
  function demoStorageKey(a){return STORAGE_PREFIX+encodeURIComponent(a.id);}
  async function readDemo(a){
    if(!a.demo||!a.available)throw new Error('An active Demo workspace is required.');
    const raw=root.localStorage.getItem(demoStorageKey(a));if(!raw)return [];
    const saved=JSON.parse(raw);if(saved.version!==1||!Array.isArray(saved.keys)||saved.keys.length>MAX_KEYS)throw new Error('The Demo SSH key data could not be read.');
    return Promise.all(saved.keys.map(normalizeKey));
  }
  function saveDemo(a,keys){
    if(!a.demo||!a.available)throw new Error('Demo keys cannot be saved to a real account.');
    root.localStorage.setItem(demoStorageKey(a),JSON.stringify({version:1,keys:keys.map(({id,label,publicKey,createdAt})=>({id,label,publicKey,createdAt}))}));
  }
  function connected(method){return typeof root.OpenNEXTAccountService?.[method]==='function';}
  function renderKeys(ctx){
    const state=store(ctx),a=account(ctx);
    const message=state.error?`<p class="onx-account-service-note" role="status">${esc(state.error)}</p>`:'';
    if(state.loading&&!state.loaded)return '<div class="onx-account-empty" role="status">Loading SSH keys…</div>';
    if(!state.keys.length)return message+'<div class="onx-account-empty">No saved keys yet. Add a public key to use when provisioning an instance.</div>';
    return message+`<div class="onx-account-key-list">${state.keys.map(key=>`<article class="onx-account-key" data-account-key="${esc(key.id)}"><span class="onx-account-key-icon">${icons.key}</span><div class="onx-account-key-info"><h3>${esc(key.label)}</h3><code>${esc(key.fingerprint)}</code><small>${esc(key.algorithm)}${key.createdAt?' · Added '+esc(new Date(key.createdAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'})):''}</small></div><div class="onx-account-key-actions"><button type="button" class="onx-account-icon" data-act="account-ssh-copy" data-id="${esc(key.id)}" aria-label="Copy public key for ${esc(key.label)}" title="Copy public key">${icons.copy}</button><button type="button" class="btn secondary small" data-act="account-ssh-remove" data-id="${esc(key.id)}" ${!a.demo&&!connected('removeSshKey')?'disabled':''}>Remove</button></div></article>`).join('')}</div>`;
  }
  function verification(ctx){
    if(ctx.S?.role!=='Seller')return {label:'KYC / KYB',status:'',kind:''};
    const status=['Approved','Reviewing','Rejected'].includes(ctx.S?.review?.status)?ctx.S.review.status:'';
    return {label:'KYC / KYB',status,kind:status==='Approved'?'approved':status==='Reviewing'?'reviewing':status==='Rejected'?'rejected':''};
  }
  function sshSection(ctx,{scope='profile'}={}){
    const area=['profile','instances','instance-access'].includes(scope)?scope:'profile',titleId='account-ssh-title-'+area;
    return `<section class="onx-account-ssh onx-account-ssh-${area}" data-account-key-library aria-labelledby="${titleId}"><header class="onx-account-section-header"><div><h2 id="${titleId}">SSH keys</h2><p>Save public keys for secure access to your instances. Never share a private key.</p></div><button type="button" class="btn secondary small" data-act="account-ssh-add">+ Add key</button></header><div data-account-ssh-list>${renderKeys(ctx)}</div><p class="onx-account-footnote">Removing a key here does not revoke access to existing instances. Remove it from the instance separately.</p></section>`;
  }
  function page(ctx){
    const user=identity(ctx),check=verification(ctx),initials=user.name?user.name.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase():'';
    return `<div class="page-content onx-account-profile" data-account-profile><header class="onx-account-profile-header"><div class="onx-account-avatar" aria-hidden="true">${initials?esc(initials):icons.user}</div><div class="onx-account-title"><h1>${esc(user.name||'Your profile')}</h1><p>${esc(user.email||'Manage your account and access keys.')}</p></div><a class="onx-account-icon onx-account-settings" href="#terminal/settings" data-nav="settings" aria-label="Account settings">${icons.settings}</a></header><section class="onx-account-identity" aria-label="Account information"><dl>${[['Name',user.name],['Email',user.email],['Sign-in',user.provider]].map(([label,value])=>`<div class="onx-account-row"><dt>${label}</dt><dd>${esc(value||'—')}</dd></div>`).join('')}</dl><div class="onx-account-verification"><button type="button" class="onx-account-verify ${check.kind}" data-act="account-verification">${icons.shield}<span>${check.label}</span>${check.status?`<span class="onx-account-review-status">${esc(check.status)}</span>`:''}</button></div></section>${sshSection(ctx)}</div>`;
  }
  function repaintKeys(ctx,key){if(!current(ctx,key))return;root.document?.querySelectorAll('[data-account-ssh-list]').forEach(list=>{list.innerHTML=renderKeys(ctx);});}
  function loadKeys(ctx,{force=false}={}){
    const a=account(ctx),state=store(ctx),adapter=root.OpenNEXTAccountService;if(!a.available){state.error='Sign in to manage your SSH keys.';state.loaded=true;return;}
    if(state.pending)return state.pending;
    if(!force&&state.loaded&&state.adapter===adapter&&Date.now()-state.loadedAt<60000)return;
    state.loading=true;state.error='';state.adapter=adapter;repaintKeys(ctx,a.key);
    state.pending=(async()=>{
    try{
      let keys;if(a.demo)keys=await readDemo(a);else{
        // Backend adapter uses its verified session, never a client-supplied owner ID.
        // listSshKeys() -> {keys:[{id,label,publicKey,createdAt}]}
        // addSshKey({label,publicKey}) -> {confirmed:true,key:{...}}
        // removeSshKey({id}) -> {confirmed:true,id}
        if(!connected('listSshKeys'))throw new Error(UNCONFIGURED);
        const result=await adapter.listSshKeys();if(!Array.isArray(result?.keys)||result.keys.length>MAX_KEYS)throw new Error('The account service returned an invalid key list.');
        keys=await Promise.all(result.keys.map(normalizeKey));
      }
      if(current(ctx,a.key))state.keys=keys;
    }catch(error){if(current(ctx,a.key))state.error=error.message===UNCONFIGURED?UNCONFIGURED:a.demo?'Demo SSH keys could not be loaded. Please check browser storage access.':'SSH keys could not be loaded. Refresh your session and try again.';}
    finally{state.loading=false;state.loaded=true;state.loadedAt=Date.now();repaintKeys(ctx,a.key);}
    })().finally(()=>{state.pending=null;});
    return state.pending;
  }
  function bind(ctx){if(root.document?.querySelector('[data-account-key-library]'))return loadKeys(ctx);}
  function modal(ctx,type,data={}){
    const a=account(ctx);
    if(type==='account-verification')return {title:'Identity verification',body:'<div class="onx-account-dialog"><p>Buyer identity verification is not connected yet. Contact OpenNEXT support if verification is required for your order.</p><p class="form-note">No documents have been submitted and no approval has been granted.</p><div class="modal-footer"><button type="button" class="btn secondary" data-act="close-modal">Close</button><button type="button" class="btn" data-act="account-contact-support">Contact support</button></div></div>'};
    if(type==='account-ssh-add'){
      const available=a.available&&(a.demo||connected('listSshKeys')&&connected('addSshKey'));
      return {title:'Add SSH key',body:`<form data-form="account-ssh-add" class="onx-account-form"><label class="form-label">Label<input class="field" name="label" autocomplete="off" maxlength="80" required placeholder="Work laptop"></label><label class="form-label">Public key<textarea class="field" name="publicKey" rows="5" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="16384" required placeholder="Paste your single-line SSH public key"></textarea></label><p class="form-note">ED25519, RSA (2,048–8,192 bits) and ECDSA keys are supported. A saved key is not automatically added to any running instance.</p>${a.demo?'<p class="form-note">Stored only in this Demo workspace on this browser.</p>':!available?`<p class="onx-account-service-note">${UNCONFIGURED}</p>`:''}<p class="onx-account-form-error" data-account-error role="alert"></p><div class="modal-footer"><button type="button" class="btn secondary" data-act="close-modal">Cancel</button><button type="submit" class="btn" ${available?'':'disabled'}>Add key</button></div></form>`};
    }
    if(type==='account-ssh-remove'){
      const key=store(ctx).keys.find(item=>item.id===data.id);if(!key)return {title:'SSH key unavailable',body:'<p>This key is no longer available. Refresh your profile.</p>'};
      return {title:'Remove SSH key?',body:`<form data-form="account-ssh-remove" data-id="${esc(key.id)}" class="onx-account-form"><p>Remove <strong>${esc(key.label)}</strong> from ${a.demo?'this Demo workspace':'your account'}?</p><code class="onx-account-remove-fingerprint">${esc(key.fingerprint)}</code><p class="form-note">This does not revoke access to existing instances or remove the public key from their authorized keys.</p><p class="onx-account-form-error" data-account-error role="alert"></p><div class="modal-footer"><button type="button" class="btn secondary" data-act="close-modal">Cancel</button><button type="submit" class="btn danger">Remove key</button></div></form>`};
    }
    return null;
  }
  function action(ctx,act,button){
    if(!act.startsWith('account-'))return false;
    if(act==='account-verification'){ctx.open(ctx.S.role==='Seller'?'review':'account-verification');return true;}
    if(act==='account-contact-support'){if(root.OpenNEXTContact?.open){ctx.S.modal=null;ctx.render();root.OpenNEXTContact.open({message:'I would like help with account verification.'});}else ctx.toast('Please contact OpenNEXT support. The contact form is not connected yet.');return true;}
    if(act==='account-ssh-add'){ctx.open('account-ssh-add');return true;}
    if(act==='account-ssh-remove'){ctx.open('account-ssh-remove',{id:button.dataset.id});return true;}
    if(act==='account-ssh-copy'){
      const key=store(ctx).keys.find(item=>item.id===button.dataset.id);if(!key)return true;
      if(!root.navigator?.clipboard?.writeText){ctx.toast('Clipboard access is unavailable in this browser.');return true;}
      root.navigator.clipboard.writeText(key.publicKey).then(()=>ctx.toast('Public key copied.')).catch(()=>ctx.toast('Clipboard permission was denied.'));return true;
    }
    return false;
  }
  async function changeKey(ctx,form,data){
    const a=account(ctx),state=store(ctx),removing=form.dataset.form==='account-ssh-remove',button=form.querySelector('[type="submit"]'),errorNode=form.querySelector('[data-account-error]');
    if(operations.has(a.key))return;operations.add(a.key);if(button)button.disabled=true;if(errorNode)errorNode.textContent='';
    try{
      if(!a.available)throw new Error('Sign in to manage your SSH keys.');
      if(!a.demo&&(!connected('listSshKeys')||!connected(removing?'removeSshKey':'addSshKey')))throw new Error(UNCONFIGURED);
      await loadKeys(ctx,{force:true});if(!current(ctx,a.key))return;if(state.error)throw new Error(state.error);
      if(removing){
        const id=form.dataset.id,key=state.keys.find(item=>item.id===id);if(!key)throw new Error('This key is no longer available.');
        if(a.demo)saveDemo(a,state.keys.filter(item=>item.id!==id));else{
          const result=await root.OpenNEXTAccountService.removeSshKey({id});
          if(result?.confirmed!==true||result.id!==id)throw new Error('Removal was not confirmed by the account service.');
        }
        if(!current(ctx,a.key))return;state.keys=state.keys.filter(item=>item.id!==id);
      }else{
        const label=keyLabel(data.label),parsed=validatePublicKey(data.publicKey);
        if(state.keys.length>=MAX_KEYS)throw new Error('You can save up to 50 SSH keys. Remove an unused key first.');
        if(state.keys.some(key=>key.material===parsed.material))throw new Error('This public key has already been added.');
        let key;
        if(a.demo){key={id:root.crypto.randomUUID(),label,publicKey:parsed.publicKey,material:parsed.material,algorithm:parsed.algorithm,fingerprint:await fingerprint(parsed),createdAt:new Date().toISOString()};saveDemo(a,[...state.keys,key]);}
        else{
          const result=await root.OpenNEXTAccountService.addSshKey({label,publicKey:parsed.publicKey});
          if(result?.confirmed!==true)throw new Error('The account service has not confirmed this key was saved.');
          key=await normalizeKey(result.key);if(key.material!==parsed.material||key.label!==label)throw new Error('The saved key did not match your submission. Refresh your profile to check its status.');
        }
        if(!current(ctx,a.key))return;state.keys=[...state.keys,key];
      }
      state.loaded=true;state.loadedAt=Date.now();ctx.S.modal=null;ctx.render();ctx.toast(a.demo?(removing?'Public key removed from this Demo browser workspace.':'Public key saved only to this Demo browser workspace.'):(removing?'Public key removed. Existing instance access is unchanged.':'Public key saved to your account.'));
    }catch(error){if(current(ctx,a.key)){const message=error.message||'The key could not be updated.';if(errorNode&&form.isConnected)errorNode.textContent=message;ctx.toast(message);}}
    finally{operations.delete(a.key);if(button?.isConnected)button.disabled=false;}
  }
  function submit(ctx,form,data){if(!['account-ssh-add','account-ssh-remove'].includes(form.dataset.form))return false;changeKey(ctx,form,data);return true;}
  root.OpenNEXTAccountProfile={page,sshSection,bind,modal,action,submit,validatePublicKey,fingerprint,testHelpers:{account,identity,validatePublicKey,fingerprint,keyLabel,normalizeKey,readDemo,saveDemo,loadKeys,changeKey,store,verification}};
})(typeof window!=='undefined'?window:globalThis);
