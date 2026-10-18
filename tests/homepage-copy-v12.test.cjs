'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function landing(){
  const context={window:{OpenNEXTListings:{render:()=>'<div>Existing marketplace</div>'},openNEXTPreviewTicker:()=>'<div>Existing ticker</div>'}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../OpenNEXT-original-homepage.js'),'utf8'),context);
  return context.window.renderOriginalLanding();
}
test('homepage descriptions break only at the requested sentence boundaries',()=>{
  const html=landing();
  const descriptions=[...html.matchAll(/<p class="public-section-description public-description-lines">([\s\S]*?)<\/p>/g)].map(match=>match[1]);
  assert.deepEqual(descriptions,[
    'Two sides of the same market.<br>Explore supply to buy, or respond to buyers looking for capacity you can deliver.',
    'Market intelligence and procurement in the same workspace.<br>Keep every specification, quote and decision connected.',
  ]);
  const css=fs.readFileSync(path.join(__dirname,'../OpenNEXT-original-homepage.css'),'utf8');
  assert.match(css,/\.public-page \.public-heading-lines,\.public-page \.public-description-lines\{max-width:none\}/);
  assert.doesNotMatch(css,/public-description-lines[^}]*white-space:\s*nowrap/);
});
test('Model capacity CTA is Coming Soon, disabled and has no navigation action',()=>{
  const html=landing();
  const row=[...html.matchAll(/<div class="public-market-row">([\s\S]*?)<\/div>/g)].find(match=>match[1].includes('<h3>Model capacity</h3>'))[1];
  assert.match(row,/<button type="button" class="on-button on-button-text on-button-coming-soon" disabled aria-disabled="true">Coming Soon<\/button>/);
  assert.doesNotMatch(row,/Explore models|data-public-action|data-target|href=|aria-hidden/);
  assert.match(html,/data-target="gpus">Explore GPUs/);
  assert.match(html,/Existing marketplace/);
});
