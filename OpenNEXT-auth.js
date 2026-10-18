(function(){
  'use strict';
  const BRAND_PATH='M2 3 10 0v41H2V3Zm11 8 20 19v11L13 22V11ZM34 11l8 2v31h-8V11Z';
  const arrow='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  const eye='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 12s3.7-6.2 10-6.2S22 12 22 12s-3.7 6.2-10 6.2S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>';
  const google='<svg viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.874 2.684-6.614Z"/><path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.181l-2.909-2.258c-.806.54-1.836.859-3.047.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A9 9 0 0 0 9 18Z"/><path fill="#FBBC05" d="M3.964 10.709A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.709V4.959H.957A9 9 0 0 0 0 9c0 1.452.347 2.827.957 4.041l3.007-2.332Z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.507.454 3.441 1.346l2.582-2.581C13.464.892 11.426 0 9 0A9 9 0 0 0 .957 4.959l3.007 2.332C4.672 5.164 6.656 3.58 9 3.58Z"/></svg>';
  const github='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .75C5.79.75.75 5.79.75 12c0 4.97 3.22 9.19 7.69 10.68.56.1.77-.24.77-.54 0-.27-.01-.98-.02-1.92-3.13.68-3.79-1.51-3.79-1.51-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.64 1.22 3.28.93.1-.72.39-1.22.72-1.5-2.5-.29-5.13-1.25-5.13-5.57 0-1.23.44-2.24 1.16-3.03-.12-.28-.5-1.43.11-2.99 0 0 .95-.3 3.1 1.16a10.8 10.8 0 0 1 5.64 0c2.15-1.46 3.1-1.16 3.1-1.16.61 1.56.23 2.71.11 2.99.72.79 1.16 1.8 1.16 3.03 0 4.33-2.64 5.28-5.15 5.56.41.35.77 1.03.77 2.08 0 1.5-.01 2.71-.01 3.08 0 .3.2.65.77.54A11.25 11.25 0 0 0 23.25 12C23.25 5.79 18.21.75 12 .75Z"/></svg>';
const check='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let user=null,config=null,mode='signin',callbacks={},currentRoot=null,emailAddress='',emailChallenge='',onboardingRole='',onboardingStage='role';
  function logo(light=false){return '<span class="onx-brand'+(light?' onx-brand-light':'')+'"><svg viewBox="0 0 42 44" role="img" aria-label="OpenNEXT mark"><path d="'+BRAND_PATH+'"/></svg><span>OpenNEXT</span></span>';}
  function notify(){window.dispatchEvent(new CustomEvent('opennext:authchange',{detail:{user}}));}
  function setUser(value,emit=true){user=value&&typeof value.id==='string'&&typeof value.email==='string'?value:null;if(emit)notify();return user;}
  async function request(endpoint,options={}){
    if(!/^\/api\//.test(endpoint))throw new Error('Invalid API endpoint.');
    const headers={...options.headers};
    if(options.method&&options.method!=='GET'){headers['Content-Type']='application/json';if(user?.csrfToken)headers['X-CSRF-Token']=user.csrfToken;}
    let response;
    try{response=await fetch(endpoint,{...options,headers,credentials:'same-origin',cache:'no-store'});}catch{throw new Error('Unable to reach OpenNEXT. Check your connection and try again.');}
    let payload;try{payload=await response.json();}catch{throw new Error('Authentication is temporarily unavailable. Please try again.');}
    if(!response.ok){const error=new Error(payload.error||'The request could not be completed.');error.status=response.status;throw error;}
    return payload;
  }
  async function refreshSession(){const result=await request('/api/auth/session');return setUser(result.user);}
  async function boot(){try{return await refreshSession();}catch{return setUser(null);}}
  async function logout(){try{await request('/api/auth/logout',{method:'POST',body:'{}'});}catch(reason){if(reason.status!==401)throw reason;}emailAddress='';emailChallenge='';onboardingStage='role';return setUser(null);}
  async function switchRole(role){const result=await request('/api/auth/role',{method:'POST',body:JSON.stringify({role})});return setUser(result.user);}
  function error(message){const box=currentRoot?.querySelector('[data-auth-error]');if(box){box.textContent=message;box.hidden=false;box.focus();}}
  function clearError(){const box=currentRoot?.querySelector('[data-auth-error]');if(box){box.textContent='';box.hidden=true;}currentRoot?.querySelectorAll('[aria-invalid]').forEach(input=>input.removeAttribute('aria-invalid'));}
  // Forms use novalidate so browser-native bubbles never appear in the visitor's UI language.
  function fieldError(input){
    const value=String(input.value||'').trim();
    if(input.name==='email')return !value?'Enter your email address.':value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)?'Enter a valid email address, like you@company.com.':'';
    if(input.name==='code')return !value?'Enter the verification code from your email.':!/^[0-9]{6,8}$/.test(value)?'The verification code is 6 to 8 digits.':'';
    return '';
  }
  function validate(form){
    clearError();
    for(const input of form.querySelectorAll('input[name]')){const message=fieldError(input);if(message){error(message);input.setAttribute('aria-invalid','true');input.focus();input.oninput=()=>{if(!fieldError(input))clearError();};return false;}}
    return true;
  }
  function submit(text){return '<button class="onx-auth-submit" type="submit"><span>'+text+'</span>'+arrow+'</button>';}
  function shell(body){return '<main class="onx-auth-root" data-onx-auth-root><aside class="onx-auth-story">'+logo()+'<div class="onx-auth-story-copy"><div class="onx-auth-kicker">AI capacity, on your terms</div><h2>A clearer market.<br>A better match.</h2><p>Discover GPU capacity, compare market signals and connect with providers in one focused workspace.</p></div><div class="onx-auth-story-foot"><i></i>Private sourcing. Transparent terms.</div><div class="onx-auth-orbits" aria-hidden="true"><i></i><i></i><i></i></div></aside><section class="onx-auth-main"><button type="button" class="onx-auth-back" data-auth-back>'+arrow+'Back to OpenNEXT</button><div class="onx-auth-card"><div class="onx-auth-mobile-brand">'+logo()+'</div>'+body+'</div></section></main>';}
  function render(nextMode='signin'){
    mode=nextMode==='signup'?'signup':nextMode==='verify'?'verify':'signin';
    if(mode==='verify')return shell('<div class="onx-auth-kicker">Verify your email</div><h1>Check your inbox.</h1><p class="onx-auth-subtitle">Enter the verification code sent to <strong>'+esc(emailAddress)+'</strong>. The code expires in 10 minutes.</p><form data-auth-verify novalidate><label class="onx-auth-field"><span>Verification code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" minlength="6" maxlength="8" placeholder="Enter your verification code" required></label><div class="onx-auth-error" data-auth-error role="alert" tabindex="-1" hidden></div>'+submit('Verify and continue')+'</form><div class="onx-auth-account-switch"><button type="button" class="onx-auth-link" data-auth-mode="signin">Use another email or request a new code</button></div>');
    return shell('<div class="onx-auth-kicker">Your capacity workspace</div><h1>'+(mode==='signup'?'Start with OpenNEXT.':'Welcome back.')+'</h1><p class="onx-auth-subtitle">Sign in securely to source, compare and manage AI capacity.</p><div class="onx-auth-providers"><button class="onx-auth-provider onx-auth-google" type="button" data-auth-provider="google">'+google+'<span>Continue with Google</span></button><button class="onx-auth-provider onx-auth-github" type="button" data-auth-provider="github">'+github+'<span>Continue with GitHub</span></button></div><p class="onx-auth-smallnote">Your account is verified by your sign-in provider. OpenNEXT never asks for your Google or GitHub password.</p><div class="onx-auth-divider">or continue with email</div><form data-auth-email novalidate><label class="onx-auth-field"><span>Email address</span><input name="email" type="email" autocomplete="email" placeholder="you@company.com" required maxlength="254"></label><div class="onx-auth-error" data-auth-error role="alert" tabindex="-1" hidden></div>'+submit('Send verification code')+'</form><p class="onx-auth-smallnote">We will email you a one-time code. No password is required.</p><div class="onx-auth-account-switch">'+(mode==='signup'?'Already have an account?':'New to OpenNEXT?')+' <button class="onx-auth-link" type="button" data-auth-mode="'+(mode==='signup'?'signin':'signup')+'">'+(mode==='signup'?'Sign in':'Create account')+'</button></div><details class="onx-auth-other"><summary>Other sign-in options</summary><div class="onx-auth-other-options"><button type="button" disabled>Microsoft</button><button type="button" disabled>Company SSO</button><button type="button" disabled>Passkey</button></div><p class="onx-auth-smallnote">Additional verified sign-in methods are coming soon.</p></details>');
  }
  function resolve(host,next){if(host&&typeof host.querySelector==='function')return {root:host.matches?.('[data-onx-auth-root]')?host:host.querySelector('[data-onx-auth-root]'),callbacks:next||{}};return {root:document.querySelector('[data-onx-auth-root]'),callbacks:host||{}};}
  function replace(markup,bindFn){if(!currentRoot)return;const holder=document.createElement('template');holder.innerHTML=markup;const fresh=holder.content.firstElementChild;currentRoot.replaceWith(fresh);bindFn(fresh,callbacks);fresh.querySelector('input,button[data-onboarding-role]')?.focus();}
  function bind(host,next){
    const resolved=resolve(host,next);currentRoot=resolved.root;callbacks=resolved.callbacks;if(!currentRoot)return;
    currentRoot.querySelector('[data-auth-back]').onclick=()=>callbacks.onBack?.();
    currentRoot.querySelectorAll('[data-auth-mode]').forEach(button=>button.onclick=()=>{callbacks.onMode?.(button.dataset.authMode);replace(render(button.dataset.authMode),bind);});
    currentRoot.querySelectorAll('[data-auth-provider]').forEach(button=>button.onclick=async()=>{
      clearError();button.disabled=true;
      try{config=await request('/api/auth/config');const provider=button.dataset.authProvider;if(!config.providers?.[provider])throw new Error((provider==='google'?'Google':'GitHub')+' sign-in is not configured yet. Please contact OpenNEXT support.');window.location.assign('/api/auth/oauth/'+provider+'/start');}
      catch(reason){error(reason.message);button.disabled=false;}
    });
    const emailForm=currentRoot.querySelector('[data-auth-email]');
    if(emailForm)emailForm.onsubmit=async event=>{
      event.preventDefault();if(!validate(emailForm))return;const button=emailForm.querySelector('[type="submit"]');button.disabled=true;
      try{emailAddress=String(new FormData(emailForm).get('email')).trim();const result=await request('/api/auth/email/request',{method:'POST',body:JSON.stringify({email:emailAddress})});emailChallenge=result.challengeId;replace(render('verify'),bind);}
      catch(reason){error(reason.message);button.disabled=false;}
    };
    const verifyForm=currentRoot.querySelector('[data-auth-verify]');
    if(verifyForm)verifyForm.onsubmit=async event=>{
      event.preventDefault();if(!validate(verifyForm))return;const button=verifyForm.querySelector('[type="submit"]');button.disabled=true;
      try{const result=await request('/api/auth/email/verify',{method:'POST',body:JSON.stringify({challengeId:emailChallenge,code:String(new FormData(verifyForm).get('code'))})});setUser(result.user);callbacks.onLogin?.(user);}
      catch(reason){error(reason.message);button.disabled=false;}
    };
  }
  function renderOnboarding(verifiedUser){
    if(verifiedUser)setUser(verifiedUser,false);
    if(!user)return render();
    if(onboardingStage==='reward'&&user.onboardingCompleted)return shell('<div class="onx-auth-success-icon">'+check+'</div><div class="onx-auth-kicker">Welcome to OpenNEXT</div><h1>Your first $100.<br>On us.</h1><p class="onx-auth-subtitle">A one-time <strong>$100 promotional credit</strong> has been added to your account.</p><div class="onx-auth-reward"><span>Promotional credit</span><strong>$100.00</strong><small>For eligible OpenNEXT purchases. Non-withdrawable and non-transferable. Future funding is available in Billing.</small></div><button class="onx-auth-submit" type="button" data-onboarding-complete>Open Terminal '+arrow+'</button>');
    return shell('<div class="onx-auth-kicker">Set up your workspace</div><h1>How will you<br>use OpenNEXT?</h1><p class="onx-auth-subtitle">Signed in as <strong>'+esc(user.email)+'</strong>. Choose your primary role. You can switch between Buyer and Seller later.</p><div class="onx-auth-roles" role="group" aria-label="Choose your role"><button type="button" class="onx-auth-role" data-onboarding-role="buyer" aria-pressed="false"><strong>Buyer</strong><span>Find GPU capacity, request quotes and manage your resources.</span><i aria-hidden="true"></i></button><button type="button" class="onx-auth-role" data-onboarding-role="seller" aria-pressed="false"><strong>Seller</strong><span>Verify your business, list available capacity and respond to demand.</span><i aria-hidden="true"></i></button><button type="button" class="onx-auth-role" disabled aria-disabled="true"><strong>Broker <small>Coming soon</small></strong><span>Broker access is not available yet.</span></button></div><div class="onx-auth-error" data-auth-error role="alert" tabindex="-1" hidden></div><button class="onx-auth-submit" type="button" data-onboarding-next disabled>Next '+arrow+'</button><p class="onx-auth-smallnote">Complete setup to receive a one-time $100 promotional credit. Promotional credit cannot be withdrawn.</p>');
  }
  function bindOnboarding(host,next){
    const resolved=resolve(host,next);currentRoot=resolved.root;callbacks=resolved.callbacks;if(!currentRoot)return;
    currentRoot.querySelector('[data-auth-back]').onclick=()=>callbacks.onBack?.();
    onboardingRole='';
    currentRoot.querySelectorAll('[data-onboarding-role]').forEach(button=>button.onclick=()=>{onboardingRole=button.dataset.onboardingRole;currentRoot.querySelectorAll('[data-onboarding-role]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));currentRoot.querySelector('[data-onboarding-next]').disabled=false;});
    const nextButton=currentRoot.querySelector('[data-onboarding-next]');
    if(nextButton)nextButton.onclick=async()=>{clearError();nextButton.disabled=true;try{const result=await request('/api/auth/onboarding',{method:'POST',body:JSON.stringify({role:onboardingRole})});setUser(result.user,false);onboardingStage='reward';replace(renderOnboarding(user),bindOnboarding);}catch(reason){error(reason.message);nextButton.disabled=false;}};
    const complete=currentRoot.querySelector('[data-onboarding-complete]');
    if(complete)complete.onclick=()=>{onboardingStage='role';notify();callbacks.onComplete?.(user);};
  }
  window.OpenNEXTAuth={logo,render,bind,boot,refreshSession,session:()=>user,getUser:()=>user,request,logout,switchRole,renderOnboarding,bindOnboarding};
})();
