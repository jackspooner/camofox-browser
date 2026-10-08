import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { collectAccessibility } from '../../lib/accessibility-snapshot.js';
import { boundedRead } from '../../lib/bounded-read.js';
import { platformRequest, PLATFORM_TOOLS } from '../../mcp/lib/platform-contracts.mjs';
import { browserOperation } from '../../mcp/lib/operation-contracts.mjs';
import { applicationProblem } from '../../mcp/lib/problems.mjs';
const buttons = n => Array.from({length:n},(_,i)=>`- button "Control ${i}"`).join('\n');
function fixture(mainCount=500,childCounts=[1]) {
  const frame = (n,i) => ({url:()=>`https://site${i}.test/path?private=query`,name:()=>`frame${i}`,isDetached:()=>false,locator:()=>({ariaSnapshot:async()=>buttons(n)})});
  const frames = [frame(mainCount,0),...childCounts.map((n,i)=>frame(n,i+1))];
  const page = new EventEmitter();page.frames=()=>frames;page.mainFrame=()=>frames[0];page.isClosed=()=>false;
  return {page,frames};
}
test('499/500/501 main controls never starve child refs; annotation stays frame-scoped', async()=>{
  for(const count of [499,500,501]){
    const {page}=fixture(count,[2]);const r=await collectAccessibility(page);
    assert.equal(r.refs.size,Math.min(count,500)+2);
    assert.match(r.yaml,new RegExp(`Control 0" \\[e${Math.min(count,500)+1}\\]`));
    assert.equal(r.coverage.documents[0].reasons.includes('ref_limit'),count>500);
    assert.equal(r.coverage.documents[1].assigned,2);
    assert(!JSON.stringify(r.coverage).includes('private'));
  }
});
test('eight independent frame budgets, bounded labels and explicit limits/skips', async()=>{
  const {page,frames}=fixture(501,Array(10).fill(501));frames[1].name=()=> 'x'.repeat(100000);
  const r=await collectAccessibility(page);
  assert.equal(r.refs.size,4500);assert.equal(r.coverage.documents[1].name.length,256);
  assert(r.coverage.reasons.includes('frame_limit'));assert(r.coverage.reasons.includes('ref_limit'));
  frames[1].name=()=> '{"url":"https://ad.test/?tracking=private"}';
  const redacted=await collectAccessibility(page);assert(!JSON.stringify(redacted.coverage).includes('tracking'));assert(!redacted.yaml.includes('tracking'));
  frames[1].url=()=> 'about:srcdoc';const skipped=await collectAccessibility(page);assert(skipped.coverage.reasons.includes('skipped_frame'));
});
test('timeout, inaccessible and navigated frames are explicit and late completion cannot publish refs',async()=>{
  const {page,frames}=fixture(1,[1,1,1]);let resolve;
  frames[1].locator=()=>({ariaSnapshot:()=>new Promise(r=>resolve=r)});
  frames[2].locator=()=>({ariaSnapshot:async()=>{throw Error('inaccessible');}});
  frames[3].locator=()=>({ariaSnapshot:async()=>{page.emit('framenavigated',frames[3]);throw Error('Execution context destroyed');}});
  const r=await collectAccessibility(page,{timeoutMs:100,frameTimeoutMs:10});
  assert.equal(r.refs.size,1);for(const reason of ['timeout','inaccessible','frame_changed'])assert(r.coverage.reasons.includes(reason));
  const serialized=JSON.stringify(r.coverage);resolve(buttons(500));await delay(20);assert.equal(r.refs.size,1);assert.equal(JSON.stringify(r.coverage),serialized);
});
test('read is a strict read-only contract and stale refs retain their public code',()=>{
  const tool=PLATFORM_TOOLS.find(t=>t.name==='camofox_read');assert(tool.annotations.readOnlyHint);
  assert.equal(browserOperation('POST','/tabs/t/read').mutation,false);
  for(const args of [{fields:['value']},{fields:[]},{fields:['text','text']},{limit:101},{maxChars:64001},{expression:'alert(1)'}])assert.throws(()=>platformRequest('camofox_read',{tabId:'t',selector:'img',...args},{userId:'test'}));
  assert.equal(platformRequest('camofox_read',{tabId:'t',frameSelector:'#reader',selector:'img',fields:['src','alt']},{userId:'test'}).path,'/tabs/t/read');
  assert.equal(applicationProblem({code:'stale_refs',message:'Take a new snapshot',statusCode:422}).code,'stale_refs');
});
test('read discards results from replaced frames and has a bounded deadline',async()=>{
  const {page,frames}=fixture(1);frames[0].evaluate=async()=>{page.emit('framenavigated',frames[0]);return {items:[]};};
  await assert.rejects(boundedRead(page,{selector:'img'}),{code:'target_changed'});
  frames[0].evaluate=()=>new Promise(()=>{});await assert.rejects(boundedRead(page,{selector:'img'},10),{code:'read_timeout'});
});

test('duplicate accessible names keep distinct ordinal refs within each document', async()=>{
  const {page,frames}=fixture(0,[2,2]);
  for(const frame of frames.slice(1)) frame.locator=()=>({ariaSnapshot:async()=>'- button "Next"\n- button "Next"'});
  const result=await collectAccessibility(page);
  assert.deepEqual([...result.refs.values()].map(ref=>ref.nth),[0,1,0,1]);
  assert.equal((result.yaml.match(/\[e[1-4]\]/g)||[]).length,4);
  assert.notEqual(result.refs.get('e1').frameObject,result.refs.get('e3').frameObject);
});

test('frames attached during collection are reported as uninspected changes',async()=>{
  const {page,frames}=fixture(1,[1]);
  frames[1].locator=()=>({ariaSnapshot:async()=>{frames.push({...frames[1],name:()=> 'new-reader'});return buttons(1);}});
  const result=await collectAccessibility(page);
  assert.equal(result.coverage.status,'partial');
  assert.deepEqual(result.coverage.documents.at(-1).reasons,['frame_changed']);
  assert.equal(result.coverage.documents.at(-1).name,'new-reader');
});
