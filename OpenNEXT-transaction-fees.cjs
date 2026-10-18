'use strict';

const FEE_PERCENT = 5;
const FEE_POLICY_VERSION = 'opennext-explicit-5pct-v1';
const FEE_LABEL = 'OpenNEXT Fee 5%';
const feePolicy = Object.freeze({feePercent:FEE_PERCENT,feePolicyVersion:FEE_POLICY_VERSION,feeLabel:FEE_LABEL});
const invalid = () => Object.assign(new Error('The transaction amount is outside the supported currency range.'),{status:400});

// Prices retain six decimal places; money is rounded once to cents at the
// transaction subtotal. Both fees independently use that same subtotal.
function transactionAmounts({kind='gpu_rental',rate,count=1,hours=1}) {
  const type=({rental:'gpu_rental',hardware:'physical_gpu',model:'model_capacity'})[kind]||kind;
  if(!['gpu_rental','physical_gpu','model_capacity'].includes(type))throw invalid();
  if(type!=='model_capacity'&&(!Number.isSafeInteger(Number(count))||Number(count)<1))throw invalid();
  if(type==='gpu_rental'&&(!Number.isSafeInteger(Number(hours))||Number(hours)<1))throw invalid();
  const unitRate=Number(rate),units=type==='model_capacity'?1:Number(count)*(type==='gpu_rental'?Number(hours):1);
  if(!Number.isFinite(unitRate)||unitRate<0||unitRate>1e9||!Number.isSafeInteger(units)||units<1)throw invalid();
  const micros=Math.round(unitRate*1e6);
  if(!Number.isSafeInteger(micros))throw invalid();
  const subtotalCents=(BigInt(micros)*BigInt(units)+5000n)/10000n;
  const buyerFeeCents=(subtotalCents*BigInt(FEE_PERCENT)+50n)/100n;
  const sellerFeeCents=(subtotalCents*BigInt(FEE_PERCENT)+50n)/100n;
  const buyerTotalCents=subtotalCents+buyerFeeCents,sellerNetCents=subtotalCents-sellerFeeCents;
  if(buyerTotalCents>BigInt(Number.MAX_SAFE_INTEGER))throw invalid();
  const dollars=value=>Number(value)/100;
  return {...feePolicy,subtotal:dollars(subtotalCents),buyerFee:dollars(buyerFeeCents),sellerFee:dollars(sellerFeeCents),buyerTotal:dollars(buyerTotalCents),sellerNet:dollars(sellerNetCents),total:dollars(buyerTotalCents)};
}

module.exports={FEE_PERCENT,FEE_POLICY_VERSION,FEE_LABEL,feePolicy,transactionAmounts};
