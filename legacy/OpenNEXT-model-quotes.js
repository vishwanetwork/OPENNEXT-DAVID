/* Customer-facing indications transcribed from a supplier-provided quote sheet.
 * Prices are final customer rates, not upstream costs or independently verified
 * current official rates. A SKU identifies both model and the quoted price tier.
 */
(() => {
  'use strict';
  const confirmContext = 'Not specified — confirm in quote';
  const text = 'Text';
  // Final input / output / cache rates, followed by the sheet's reference columns.
  // References are not a claim about current official pricing or savings.
  const rows = [
    ['claude-sonnet-5','claude-sonnet-5','Claude Sonnet 5','Anthropic',confirmContext,text,1.3,6.5,0.13,2,10,.2],
    ['gpt-5.6-sol-short','gpt-5.6-sol','GPT-5.6 Sol · short context','OpenAI','Short context — threshold requires quote confirmation','Not specified — confirm in quote',2.55,15.3,0.255,5,30,.5],
    ['gemini-3.6-flash','gemini-3.6-flash','Gemini 3.6 Flash','Google',confirmContext,'Multimodal',0.765,3.825,0.0765,1.5,7.5,.15],
    ['claude-sonnet-4-6','claude-sonnet-4-6','Claude Sonnet 4.6','Anthropic',confirmContext,text,1.95,9.75,0.195,3,15,.3],
    ['gemini-3.5-flash-lite','gemini-3.5-flash-lite','Gemini 3.5 Flash-Lite','Google',confirmContext,'Text / image / video / audio',0.153,1.275,0.0153,.3,2.5,.03],
    ['gpt-5.6-sol-long','gpt-5.6-sol','GPT-5.6 Sol · long context','OpenAI','Long context — threshold requires quote confirmation','Not specified — confirm in quote',5.1,22.95,0.51,10,45,1],
    ['gpt-5.6-terra-short','gpt-5.6-terra','GPT-5.6 Terra · short context','OpenAI','Short context — threshold requires quote confirmation','Not specified — confirm in quote',1.275,7.65,0.1275,2.5,15,.25],
    ['gpt-5.6-terra-long','gpt-5.6-terra','GPT-5.6 Terra · long context','OpenAI','Long context — threshold requires quote confirmation','Not specified — confirm in quote',2.55,11.475,0.255,5,22.5,.5],
    ['gpt-5.6-luna-short','gpt-5.6-luna','GPT-5.6 Luna · short context','OpenAI','Short context — threshold requires quote confirmation','Not specified — confirm in quote',0.51,3.06,0.051,1,6,.1],
    ['gpt-5.6-luna-long','gpt-5.6-luna','GPT-5.6 Luna · long context','OpenAI','Long context — threshold requires quote confirmation','Not specified — confirm in quote',1.02,4.59,0.102,2,9,.2],
    ['claude-sonnet-4-5','claude-sonnet-4-5','Claude Sonnet 4.5','Anthropic',confirmContext,text,1.95,9.75,0.195,3,15,.3],
    ['claude-haiku-4-5','claude-haiku-4-5','Claude Haiku 4.5','Anthropic',confirmContext,text,0.65,3.25,0.065,1,5,.1],
    ['claude-opus-4-5','claude-opus-4-5','Claude Opus 4.5','Anthropic',confirmContext,text,3.25,16.25,0.325,5,25,.5],
    ['gpt-5.4-mini','gpt-5.4-mini','GPT-5.4 Mini','OpenAI',confirmContext,text,0.3825,2.295,0.03825,.75,4.5,.075],
    ['gpt-5.4-nano','gpt-5.4-nano','GPT-5.4 Nano','OpenAI',confirmContext,text,0.102,0.6375,0.0102,.2,1.25,.02],
    ['gemini-2.5-pro-up-to-200k','gemini-2.5-pro','Gemini 2.5 Pro · ≤200K','Google','Input ≤200K tokens','Multimodal',0.6375,5.1,0.06375,1.25,10,.125],
    ['gemini-2.5-pro-over-200k','gemini-2.5-pro','Gemini 2.5 Pro · >200K','Google','Input >200K tokens','Multimodal',1.275,7.65,0.1275,2.5,15,.25],
    ['gemini-2.5-flash','gemini-2.5-flash','Gemini 2.5 Flash','Google',confirmContext,'Text / image / video',0.153,1.275,0.0153,.3,2.5,.03],
    ['gemini-2.5-flash-lite','gemini-2.5-flash-lite','Gemini 2.5 Flash-Lite','Google',confirmContext,'Text / image / video',0.051,0.204,0.0051,.1,.4,.01],
    ['gemini-3.5-flash','gemini-3.5-flash','Gemini 3.5 Flash','Google',confirmContext,'Multimodal',0.765,4.59,0.0765,1.5,9,.15],
    ['gemini-3.1-flash-lite','gemini-3.1-flash-lite','Gemini 3.1 Flash-Lite','Google',confirmContext,'Text / image / video',0.1275,0.765,0.01275,.25,1.5,.025],
    ['claude-fable-5','claude-fable-5','Claude Fable 5','Anthropic',confirmContext,text,6.5,32.5,0.65,10,50,1],
    ['claude-opus-4-8','claude-opus-4-8','Claude Opus 4.8','Anthropic',confirmContext,text,3.25,16.25,0.325,5,25,.5],
    ['claude-opus-4-7','claude-opus-4-7','Claude Opus 4.7','Anthropic',confirmContext,text,3.25,16.25,0.325,5,25,.5],
    ['claude-opus-4-6','claude-opus-4-6','Claude Opus 4.6','Anthropic',confirmContext,text,3.25,16.25,0.325,5,25,.5],
    ['gpt-5.5-short','gpt-5.5','GPT-5.5 · short context','OpenAI','Short context — threshold requires quote confirmation','Not specified — confirm in quote',2.55,15.3,0.255,5,30,.5],
    ['gpt-5.5-long','gpt-5.5','GPT-5.5 · long context','OpenAI','Long context — threshold requires quote confirmation','Not specified — confirm in quote',5.1,22.95,0.51,10,45,1],
    ['gpt-5.4-short','gpt-5.4','GPT-5.4 · short context','OpenAI','Short context — threshold requires quote confirmation','Not specified — confirm in quote',1.275,7.65,0.1275,2.5,15,.25],
    ['gpt-5.4-long','gpt-5.4','GPT-5.4 · long context','OpenAI','Long context — threshold requires quote confirmation','Not specified — confirm in quote',2.55,11.475,0.255,5,22.5,.5],
  ];
  const terms = 'Quote confirmation required: availability, validity, context limits, input modalities, cache billing, taxes, fees, minimum spend and service terms. Supplier-sheet references are not independently verified current official prices.';
  const list = Object.freeze(rows.map(([sku,modelId,name,brand,context,inputType,input,output,cache,referenceInput,referenceOutput,referenceCachedInput]) => Object.freeze({
    sku, modelId, name, brand, context, inputType, outputType:text,
    input, output, cache, cachedInput:cache,
    cacheBilling:'quote-confirm', unit:'USD / 1M tokens',
    sourceKind:'supplier_indication', priceKind:'supplier_quote', sourceLabel:'Supplier quote',
    referenceInput, referenceOutput, referenceCachedInput,
    referenceKind:'supplier_sheet_reference', referenceVerified:false,
    recordedAt:'2026-10-14',
    remarks:'Supplier-provided price indication; not a firm availability or routing commitment.',
    terms, note:'Text output · supplier indication. Availability and terms require confirmation.',
  })));
  const quotes = Object.fromEntries(list.map(item => [item.sku,item]));
  window.OpenNEXTModelQuotes = Object.freeze({
    get: sku => Object.hasOwn(quotes, sku) ? quotes[sku] : undefined,
    list: () => list.slice(),
    all: list,
  });
})();
