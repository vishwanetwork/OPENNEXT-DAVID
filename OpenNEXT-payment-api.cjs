'use strict';
// The payment backend owns checkout sessions and payment webhooks. No browser action credits an account.
function createPaymentRouter({auth,checkoutAdapter,allowedOrigins=[]}={}) {
  return async function(req,res,url) {
    if(url.pathname!=='/api/billing/checkout')return false;
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));return true;};
    if(req.method!=='POST')return send(405,{error:'Method not allowed.'});
    let user;try{user=await auth.authenticate(req);}catch{return send(503,{error:'Account verification is temporarily unavailable. No payment was initiated.'});}if(!user?.onboardingCompleted)return send(401,{error:'Verify your account and complete onboarding first.'});
    if(!auth.checkCsrf(req,user))return send(403,{error:'Request origin was not verified.'});
    if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))return send(415,{error:'Use application/json.'});
    let data;try{let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)return send(413,{error:'Request too large.'});}data=JSON.parse(body);}catch{return send(400,{error:'Invalid payment request.'});}
    if(!data||typeof data!=='object'||Array.isArray(data))return send(400,{error:'Invalid payment request.'});
    const amount=Number(data.amount);
    if(!['credit_card','paypal'].includes(data.method)||!Number.isFinite(amount)||amount<1||amount>100000||Math.abs(amount*100-Math.round(amount*100))>0.000001||!(/^[a-zA-Z0-9-]{12,80}$/.test(String(data.idempotencyKey||''))))return send(400,{error:'Choose a valid amount and payment method.'});
    if(!checkoutAdapter)return send(503,{error:'Payment checkout is not connected yet. Your balance has not changed.',code:'PAYMENTS_NOT_CONFIGURED'});
    try{const result=await checkoutAdapter.createCheckout({userId:user.id,currency:'USD',amountCents:Math.round(amount*100),method:data.method,idempotencyKey:data.idempotencyKey});const target=new URL(result.checkoutUrl);if(target.protocol!=='https:'||!allowedOrigins.includes(target.origin))throw Error('Invalid checkout destination');return send(200,{checkoutUrl:target.href});}catch{return send(502,{error:'The payment provider could not create a checkout. No credit was added.'});}
  };
}
module.exports={createPaymentRouter};
