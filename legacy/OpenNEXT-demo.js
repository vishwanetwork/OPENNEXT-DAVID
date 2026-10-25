/* Public test workspace bootstrap. This file must load before application scripts. */
(function(scope){
  'use strict';
  if(!/^\/demo\/?$/.test(scope.location.pathname))return;
  const nativeFetch=scope.fetch.bind(scope);
  const requestedRole=new URLSearchParams(scope.location.search).get('role');
  const role=requestedRole==='seller'?'seller':'buyer';
  const sandboxRoutes=/^\/api\/(auth|marketplace|billing|contact)(?:\/|$)/;
  let state='loading',failure='',activeUser=null,toolbar=null;
  scope.document.documentElement.classList.add('onx-demo-mode');
  if(!scope.location.hash.startsWith('#terminal/'))scope.history.replaceState({},'',scope.location.pathname+scope.location.search+'#terminal/market');

  function blocked(message){return Promise.resolve(new Response(JSON.stringify({error:message,code:'DEMO_ACTION_UNAVAILABLE'}),{status:403,headers:{'Content-Type':'application/json'}}));}
  function paint(){
    if(!toolbar)return;
    const status=toolbar.querySelector('[data-demo-status]');
    status.textContent=state==='loading'?'Preparing your test workspace…':state==='error'?failure:'Demo · test data · no real transactions';
    toolbar.dataset.state=state;
    toolbar.querySelector('[data-demo-retry]').hidden=state!=='error';
    toolbar.querySelectorAll('[data-demo-role]').forEach(link=>{
      const selected=link.dataset.demoRole===(activeUser?.role||role);
      link.setAttribute('aria-current',selected?'true':'false');
    });
  }
  function mount(){
    if(toolbar||!scope.document.body)return;
    toolbar=scope.document.createElement('aside');
    toolbar.className='onx-demo-toolbar';
    toolbar.setAttribute('aria-label','Demo workspace');
    toolbar.innerHTML='<div class="onx-demo-label"><span class="onx-demo-dot" aria-hidden="true"></span><strong data-demo-status role="status">Preparing your test workspace…</strong></div><nav class="onx-demo-actions" aria-label="Demo controls"><a data-demo-role="buyer" href="/demo/?role=buyer#terminal/market">Buyer</a><a data-demo-role="seller" href="/demo/?role=seller#terminal/market">Seller</a><a data-demo-retry href="/demo/#terminal/market" hidden>Try again</a><a class="onx-demo-exit" data-demo-exit href="/#terminal/market">Exit Demo <span aria-hidden="true">↗</span></a></nav>';
    scope.document.body.append(toolbar);
    toolbar.querySelector('[data-demo-exit]').addEventListener('click',async event=>{
      event.preventDefault();
      const controller=new AbortController(),timeout=scope.setTimeout(()=>controller.abort(),3000);
      try{if(activeUser?.csrfToken)await nativeFetch('/api/demo/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':activeUser.csrfToken},body:'{}',signal:controller.signal});}catch{}finally{scope.clearTimeout(timeout);scope.location.assign('/#terminal/market');}
    });
    paint();
  }

  // Start only the sandbox session. Production auth cookies and records are untouched.
  const ready=(async()=>{
    const controller=new AbortController(),timeout=scope.setTimeout(()=>controller.abort(),15000);
    try{
      const response=await nativeFetch('/api/demo/start',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({role}),signal:controller.signal});
      let result=await response.json();
      if(!response.ok||!result.user?.id)throw new Error(result.error||'The demo could not be started. Please try again.');
      // Resuming a sandbox must not silently alter its role. An explicit toolbar
      // selection uses the same CSRF-protected role change as the account menu.
      if(['buyer','seller'].includes(requestedRole)&&result.user.role!==role){
        const changed=await nativeFetch('/api/demo/auth/role',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':result.user.csrfToken},body:JSON.stringify({role}),signal:controller.signal});
        result=await changed.json();
        if(!changed.ok||!result.user?.id)throw new Error(result.error||'The demo role could not be changed. Please try again.');
      }
      activeUser=result.user;state='ready';paint();return result;
    }catch(error){
      state='error';failure=error.name==='AbortError'?'The demo timed out. Please try again.':error.message||'The demo is temporarily unavailable. Please try again.';paint();return null;
    }finally{scope.clearTimeout(timeout);}
  })();

  scope.fetch=async function(input,options){
    const isRequest=typeof Request!=='undefined'&&input instanceof Request;
    const url=new URL(isRequest?input.url:String(input),scope.location.href);
    const method=String(options?.method||(isRequest?input.method:'GET')).toUpperCase();
    const sameOrigin=url.origin===scope.location.origin;
    if(sameOrigin&&/^\/api\/(admin|internal)(?:\/|$)/.test(url.pathname))return blocked('Administration and infrastructure access are not available in the demo.');
    if(sameOrigin&&sandboxRoutes.test(url.pathname)){
      if(!await ready)return blocked('The demo is unavailable. Use Try again to start a new test workspace.');
      url.pathname=url.pathname.replace(/^\/api\//,'/api/demo/');
      const target=isRequest?new Request(url.href,input):url.href;
      const response=await nativeFetch(target,{...options,credentials:'same-origin',mode:'same-origin'});
      if(response.status===401){state='error';failure='Your demo session expired. Start a new test workspace.';paint();}
      return response;
    }
    // Public prices and news remain read-only. Never fall through to real writes.
    if(!['GET','HEAD'].includes(method)&&!(sameOrigin&&/^\/api\/demo\//.test(url.pathname)))return blocked('This action is not available in the demo. No real transaction was submitted.');
    return nativeFetch(input,options);
  };
  scope.OpenNEXTDemo=Object.freeze({active:true,ready});
  scope.addEventListener('opennext:authchange',event=>{activeUser=event.detail?.user||null;paint();});
  if(scope.document.readyState==='loading')scope.document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})(window);
