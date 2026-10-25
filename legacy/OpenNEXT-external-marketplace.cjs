'use strict';

const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const countries=require('./OpenNEXT-countries.js');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=(value,max=200,required=false)=>{const result=String(value??'').trim();if(result.length>max||(required&&!result)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result))throw fail(400,'An external record field is missing or too long.');return result;};
const stamp=value=>{const at=Date.parse(value);if(!Number.isFinite(at))throw fail(400,'Use a valid source timestamp.');return new Date(at).toISOString();};
const country=value=>{const row=countries.list.find(row=>row.code===value||row.name===value);if(!row)throw fail(400,'Use a recognized country or territory.');return row.name;};
const europe=new Set('AL AD AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM TR UA VA'.split(' ').map(country));
const europeanUnion=new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' ').map(country));
function scope(input){
  if(!input||typeof input!=='object'||!['worldwide','flexible','europe','countries'].includes(input.type))throw fail(400,'Provide an explicit geographic scope.');
  const result={type:input.type};
  if(input.type==='europe'&&input.unionOnly===true)result.unionOnly=true;
  for(const key of ['countries','excludedCountries'])if(input[key]!==undefined){if(!Array.isArray(input[key])||input[key].length>250)throw fail(400,'Invalid country scope.');result[key]=[...new Set(input[key].map(country))];}
  if(result.type==='countries'&&!result.countries?.length)throw fail(400,'Country-scoped records require at least one country.');
  return result;
}
function numericObject(input,keys,{integer=true,max=1e9}={}){
  const result={};if(input===undefined)return result;if(!input||typeof input!=='object'||Array.isArray(input))throw fail(400,'Invalid quantity or duration.');
  for(const key of keys)if(input[key]!==undefined){const value=Number(input[key]);if(!Number.isFinite(value)||value<=0||value>max||(integer&&!Number.isInteger(value)))throw fail(400,'A quantity or duration is outside the allowed range.');result[key]=value;}
  return result;
}
function sourceUrl(value){
  let url;try{url=new URL(text(value,2000,true));}catch{throw fail(400,'Provide a valid public HTTPS source URL.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname)||url.hostname.startsWith('['))throw fail(400,'Provide a public HTTPS source URL without credentials.');
  url.hash='';return url.href;
}
function normalize(input,context){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail(400,'Invalid external record.');
  const externalId=text(input.externalId||input.sourceRecordId,200,true),side=input.side||'demand';
  if(!['demand','supply'].includes(side))throw fail(400,'Choose demand or supply.');
  const id='EXT-'+hash([context.sourceId,externalId,side]).slice(0,24).toUpperCase();
  if(input.removed===true)return {id,externalId,side,removed:true};
  const model=text(input.model,100,true),modelOptions=[...new Set([model,...(Array.isArray(input.modelOptions)?input.modelOptions:[])].map(value=>text(value,100,true)))];
  if(modelOptions.length>12)throw fail(400,'Too many alternative models.');
  const quantity=numericObject(input.quantity,['nodes','minNodes','maxNodes','gpusPerNode','totalGpus','totalGpusMin','totalGpusMax','racks']);
  if(input.quantity?.sourceMinimum===true)quantity.sourceMinimum=true;
  const rentalMonths=numericObject(input.rentalMonths,['min','max','preferred'],{integer:false,max:120});
  if(input.rentalMonths?.notes)rentalMonths.notes=text(input.rentalMonths.notes,1000);
  if(input.rentalMonths?.options!==undefined){if(!Array.isArray(input.rentalMonths.options)||input.rentalMonths.options.length>24)throw fail(400,'Invalid rental term options.');rentalMonths.options=[...new Set(input.rentalMonths.options.map(value=>{const n=Number(value);if(!Number.isFinite(n)||n<=0||n>120)throw fail(400,'Invalid rental term options.');return n;}))];}
  if(quantity.minNodes&&quantity.maxNodes&&quantity.minNodes>quantity.maxNodes||rentalMonths.min&&rentalMonths.max&&rentalMonths.min>rentalMonths.max)throw fail(400,'Minimum values cannot exceed maximum values.');
  const targetPrice=input.targetPrice==null?null:Number(input.targetPrice),modelBudgets={};
  if(targetPrice!==null&&(!Number.isFinite(targetPrice)||targetPrice<=0||targetPrice>1e9))throw fail(400,'Invalid source price.');
  if(input.modelBudgets!==undefined){if(!input.modelBudgets||typeof input.modelBudgets!=='object'||Array.isArray(input.modelBudgets))throw fail(400,'Invalid per-model prices.');for(const [name,value] of Object.entries(input.modelBudgets)){if(!modelOptions.includes(name)||!Number.isFinite(Number(value))||Number(value)<=0||Number(value)>1e9)throw fail(400,'Invalid per-model price.');modelBudgets[name]=Number(value);}}
  const value={externalId,side,kind:'gpu_rental',model,modelOptions,modelBudgets,title:text(input.title,200,true),description:text(input.description||input.notes,6000,true),region:text(input.regionLabel||input.region,160,true),regionScope:scope(input.regionScope),quantity,rentalMonths,targetPrice,currency:'USD',priceUnit:'GPU-hour',urgency:input.urgency==='High urgency'?'High urgency':'Standard',commercialTerms:text(input.commercialTerms,2000),deliveryRequirements:text(input.deliveryRequirements,2000),paymentTerms:text(input.paymentTerms,2000),sourceUrl:sourceUrl(input.sourceUrl),observedAt:stamp(input.observedAt||context.observedAt)};
  if(input.currency&&input.currency!=='USD'||input.priceUnit&&input.priceUnit!=='GPU-hour')throw fail(400,'This rental import accepts USD per GPU-hour source prices only.');
  if(input.expiresAt)value.expiresAt=stamp(input.expiresAt);
  return {id,...value,externalIdKind:text(input.externalIdKind||'unspecified',80),sourcedUrgency:text(input.sourcedUrgency,80)};
}
function regionMatches(row,region){
  if(!region||region==='All regions')return true;
  let selected;try{selected=country(region);}catch{return region===row.region;}
  const area=row.regionScope;if(area.excludedCountries?.includes(selected))return false;
  if(area.type==='worldwide'||area.type==='flexible')return true;
  return area.type==='europe'?(area.unionOnly?europeanUnion:europe).has(selected):area.countries.includes(selected);
}

function createExternalMarketplace({dataDir,now=()=>Date.now(),checkedBatch=null}={}){
  if(!dataDir)throw Error('A private external-marketplace directory is required.');
  const file=path.join(dataDir,'external-marketplace.json');let loaded,pending=Promise.resolve();
  const time=()=>new Date(now()).toISOString();
  const fresh=()=>({version:1,records:[],batches:[],audit:[]});
  async function persist(db){await fs.mkdir(dataDir,{recursive:true});const temp=file+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';try{await fs.writeFile(temp,JSON.stringify(db),{mode:0o600,flag:'wx'});await fs.rename(temp,file);}catch(error){await fs.unlink(temp).catch(()=>{});throw error;}}
  function event(db,row,action,actor,detail=''){const entry={at:time(),recordId:row.id,action,actor,detail,revision:row.reviewRevision};row.audit||=[];row.audit.push(entry);db.audit.push(entry);if(db.audit.length>10000)db.audit.splice(0,db.audit.length-10000);}
  function expire(db){let changed=false;for(const row of db.records)if(row.expiresAt&&Date.parse(row.expiresAt)<=now()&&['Approved','Reviewing'].includes(row.status)){row.status=row.reviewStatus='Expired';row.updatedAt=time();event(db,row,'Expired','Source expiry');changed=true;}return changed;}
  function applyImport(db,input,operator,approval=null){
    const sourceId=text(input.sourceId,80,true),sourceName=text(input.sourceName,120,true),batchId=text(input.batchId,160,true);
    if(!/^[a-z0-9][a-z0-9_-]*$/.test(sourceId)||!Array.isArray(input.records)||input.records.length<1||input.records.length>100)throw fail(400,'Use a stable source identifier and between 1 and 100 records.');
    if(db.records.length+input.records.length>20000)throw fail(429,'The external import store has reached its capacity.');
    const normalized=input.records.map(row=>normalize(row,{sourceId,observedAt:input.observedAt}));
    if(new Set(normalized.map(row=>row.id)).size!==normalized.length)throw fail(400,'An import batch contains duplicate source records.');
    const seenBatch=db.batches.some(row=>row.sourceId===sourceId&&row.batchId===batchId),results=[];
    for(const incoming of normalized){
      const old=db.records.find(row=>row.id===incoming.id);
      if(incoming.removed){if(old&&old.status!=='Withdrawn'){old.status=old.reviewStatus='Withdrawn';old.updatedAt=time();old.reviewedAt=time();old.reviewedBy=operator;old.reviewReason='Removed by source import.';old.reviewRevision++;event(db,old,'Source removed',operator);}results.push({id:incoming.id,outcome:old?'withdrawn':'absent'});continue;}
      const {observedAt,...content}=incoming,contentHash=hash({...content,sourceName});
      if(old?.contentHash===contentHash){old.provenance.observedAt=observedAt;old.provenance.importedAt=time();old.provenance.batchId=batchId;results.push({id:old.id,outcome:'unchanged',status:old.status});continue;}
      const approved=!!approval&&!seenBatch&&!old;
      const provenance={kind:'external',sourceId,sourceName,sourceUrl:incoming.sourceUrl,sourceRecordId:incoming.externalId,sourceRecordIdKind:incoming.externalIdKind,observedAt,importedAt:time(),batchId};
      const record={...content,provenance,contentHash,external:true,executable:false,responseMode:'operations',status:approved?'Approved':'Reviewing',reviewStatus:approved?'Approved':'Reviewing',reviewRevision:(old?.reviewRevision||0)+1,reviewedAt:approved?time():null,reviewedBy:approved?operator:null,reviewReason:approved?approval.reason:'Operations approval is required before publication.',createdAt:old?.createdAt||time(),updatedAt:time(),audit:old?.audit||[]};
      delete record.sourceUrl;
      if(old)db.records[db.records.indexOf(old)]=record;else db.records.push(record);
      event(db,record,approved?'Approved checked import':old?'Source changed; review required':'Imported; review required',operator,approved?approval.reason:'');
      results.push({id:record.id,outcome:old?'updated':'created',status:record.status});
    }
    if(!seenBatch)db.batches.push({sourceId,batchId,importedAt:time(),actor:operator,approval:approval?.reason||null});
    expire(db);return {received:normalized.length,results};
  }
  async function read(){if(!loaded)loaded=(async()=>{let db;try{db=JSON.parse(await fs.readFile(file,'utf8'));if(db.version!==1||!Array.isArray(db.records)||!Array.isArray(db.batches)||!Array.isArray(db.audit))throw Error('Invalid external marketplace store.');}catch(error){if(error.code!=='ENOENT')throw error;db=fresh();}let changed=expire(db);if(checkedBatch&&!db.batches.some(row=>row.sourceId===checkedBatch.sourceId&&row.batchId===checkedBatch.batchId)){if(checkedBatch.expectedCount!==undefined&&checkedBatch.records?.length!==checkedBatch.expectedCount)throw Error('The approved source batch has an unexpected record count.');applyImport(db,checkedBatch,'User-approved source import',{reason:text(checkedBatch.approvalReason,2000,true)});changed=true;}if(changed)await persist(db);return db;})();return loaded;}
  async function change(fn){const operation=pending.then(async()=>{const db=clone(await read()),result=await fn(db);expire(db);await persist(db);loaded=Promise.resolve(db);return clone(result);});pending=operation.catch(()=>{});return operation;}
  async function importRecords(input,operator='Administrator'){return change(db=>applyImport(db,input,text(operator,160,true)));}
  async function review(id,input,operator='Administrator'){return change(db=>{const row=db.records.find(row=>row.id===id);if(!row)throw fail(404,'External record not found.');if(!Number.isInteger(input.expectedRevision)||input.expectedRevision!==row.reviewRevision)throw fail(409,'The source record changed. Refresh before reviewing.');if(!['Approved','Rejected','Withdrawn'].includes(input.status))throw fail(400,'Choose Approve, Reject or Withdraw.');if(['Approved','Rejected'].includes(input.status)&&(row.status!=='Reviewing'||row.expiresAt&&Date.parse(row.expiresAt)<=now()))throw fail(409,'Only a current record awaiting review may be approved or rejected.');if(row.status===input.status)throw fail(409,'This record already has that decision.');row.status=row.reviewStatus=input.status;row.reviewedAt=time();row.updatedAt=time();row.reviewedBy=text(operator,160,true);row.reviewReason=text(input.reason,2000,input.status!=='Approved');row.reviewRevision++;event(db,row,'Operations '+input.status.toLowerCase(),row.reviewedBy,row.reviewReason);return row;});}
  function publicRow(row,model){const selected=model||row.model,price=row.modelBudgets[selected]??(selected===row.model?row.targetPrice:null);return {id:row.id,kind:'rental',side:row.side,external:true,executable:false,responseMode:'operations',provider:row.side==='demand'?'Sourced requirement':'Sourced offer',model:selected,modelOptions:row.modelOptions,modelBudgets:row.modelBudgets,title:row.title,description:row.description,region:row.region,regionScope:row.regionScope,quantity:row.quantity,rentalMonths:row.rentalMonths,...(row.quantity.totalGpus?{count:row.quantity.totalGpus}:{}),price,priceUnit:row.priceUnit,currency:row.currency,priceLabel:row.side==='demand'?'Buyer target price':'Source offer price before fees',urgency:row.urgency,commercialTerms:row.commercialTerms,deliveryRequirements:row.deliveryRequirements,paymentTerms:row.paymentTerms,status:'Approved',reviewStatus:'Approved',sourceNotice:'Externally sourced; availability and terms require operations confirmation.',created:row.createdAt,serverRecord:true};}
  async function publicRows(filters={}){await pending;const db=await read();return clone(db.records.filter(row=>row.status==='Approved'&&(!row.expiresAt||Date.parse(row.expiresAt)>now())&&(!filters.side||row.side===filters.side)&&(!filters.model||row.modelOptions.includes(filters.model))&&regionMatches(row,filters.region)).map(row=>publicRow(row,filters.model)));}
  async function admin(){return change(db=>{expire(db);return {records:db.records.map(row=>({...row,notes:row.description,...(row.quantity.totalGpus?{count:row.quantity.totalGpus}:{}),...(row.side==='demand'?{budget:row.targetPrice}:{netPrice:row.targetPrice,buyerPrice:row.targetPrice})})),audit:db.audit.slice(-500).reverse(),generatedAt:time()};});}
  return {importRecords,review,publicRows,admin};
}

module.exports={createExternalMarketplace,regionMatches};
