import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {runCaptureSequence} from '../../lib/platform/capture-sequence.js';
import {readSequence,saveSequence,sha256} from '../../lib/platform/capture-checkpoint.js';
import {platformRequest} from '../../mcp/lib/platform-contracts.mjs';

function fixture(t,{pages=['a','b','c'],end='next_disabled',advance,ready}={}){
 const root=mkdtempSync(join(tmpdir(),'capture-unit-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 let index=0,clicks=0;
 const controller=new AbortController();
 const options={outputDir:join(root,'output'),next:{selector:'#next'},maxCaptures:3,stableMs:250,changeTimeoutMs:1000};
 const id=randomUUID();
 const observer={
  sample:async()=>ready&&!ready()?null:{png:Buffer.from(pages[index]),sha256:sha256(pages[index]),position:`${index+1}/${pages.length}`,url:'http://fixture/',width:10,height:10,geometry:{}},
  nextState:async()=>index===pages.length-1?end:null,
  advance:async()=>{clicks++;if(advance)await advance({controller,setIndex:i=>index=i,index});else index++;},
 };
 const args={profileDir:root,sessionId:'session',tabId:'tab',sequenceId:id,operationId:id,options,observer,signal:controller.signal};
 return {root,id,args,options,controller,get clicks(){return clicks;},setIndex:i=>index=i,read:()=>readSequence(root,id,'session'),run:extra=>runCaptureSequence({...args,...extra})};
}
test('numbered assets, bounded completion, metadata and manifest agree',async t=>{
 const f=fixture(t);const r=await f.run();assert.equal(r.reason,'max_captures');assert.equal(r.captured,3);assert.equal(f.clicks,2);assert.equal(r.assets[2].position,'3/3');
 assert(r.assets[0].path.endsWith('-0001.png'));assert.equal(readFileSync(r.assets[1].path,'utf8'),'b');assert.equal(JSON.parse(readFileSync(r.manifestPath)).assets.length,3);
});
test('explicit end, disabled next and missing next stop without another click',async t=>{
 for(const end of ['next_disabled','end_marker','next_missing']){const f=fixture(t,{pages:['a'],end});const r=await f.run();assert.equal(r.reason,end);assert.equal(f.clicks,0);assert.equal(r.captured,1);}
});
test('unchanged page is skipped and never clicked again',async t=>{
 const f=fixture(t,{advance:async()=>{}});const r=await f.run();assert.equal(r.reason,'no_page_change');assert.equal(r.skipped,1);assert.equal(r.captured,1);assert.equal(f.clicks,1);
 const resumed=await f.run({resume:true,operationId:randomUUID(),signal:new AbortController().signal});assert.equal(resumed.reason,'resume_ambiguous');assert.equal(f.clicks,1);
});
test('detects a nonconsecutive repeated page',async t=>{
 const f=fixture(t,{pages:['a','b','a']});const r=await f.run();assert.equal(r.reason,'repeated_page');assert.equal(r.captured,2);assert.equal(r.skipped,1);assert.equal(f.clicks,2);
});
test('waits for delayed page change and readiness',async t=>{
 let ready=true;
 const f=fixture(t,{pages:['a','b'],ready:()=>ready,advance:async({setIndex})=>{ready=false;setTimeout(()=>{setIndex(1);ready=true;},350);}});
 const r=await f.run();assert.equal(r.captured,2);assert.equal(r.reason,'next_disabled');assert.equal(f.clicks,1);
});
test('cancel during advance persists phase, resumes a changed page without replay',async t=>{
 const f=fixture(t,{advance:async({controller,setIndex,index})=>{setIndex(index+1);controller.abort(Object.assign(Error('cancel'),{code:'operation_cancelled'}));}});
 await assert.rejects(f.run());let m=f.read();assert.equal(m.state,'interrupted');assert.equal(m.phase,'advancing');assert.equal(m.assets.length,1);
 f.args.observer.advance=async()=>f.setIndex(2);
 const r=await f.run({resume:true,operationId:randomUUID(),signal:new AbortController().signal});assert.equal(r.captured,3);assert.equal(f.clicks,1);assert(r.events.some(e=>e.outcome==='recovered'));
});
test('uncertain advance is never retried; unchanged resume requires inspection',async t=>{
 const f=fixture(t,{advance:async()=>{throw Error('connection lost');}});
 await assert.rejects(f.run(),{code:'operation_outcome_unknown'});assert.equal(f.clicks,1);assert.equal(f.read().phase,'advancing');
 const r=await f.run({resume:true,operationId:randomUUID()});assert.equal(r.reason,'resume_ambiguous');assert.equal(f.clicks,1);
});
test('checkpoint recovers a published PNG, detects altered output and binds session/tab',async t=>{
 const f=fixture(t);await f.run();const m=f.read();const asset=m.assets.pop();m.checkpoint={last:m.assets.at(-1),pending:asset};m.phase='saving';m.state='running';saveSequence(f.root,m);
 const r=await f.run({resume:true,operationId:randomUUID()});assert.equal(r.captured,3);assert.equal(f.clicks,2);assert(r.events.some(e=>e.reason==='published_capture'));
 m.state='interrupted';m.phase='captured';m.checkpoint={last:asset};m.assets.push(asset);saveSequence(f.root,m);writeFileSync(asset.path,'altered');
 await assert.rejects(f.run({resume:true}),{code:'capture_output_collision'});
 await assert.rejects(f.run({resume:true,tabId:'other'}),{code:'invalid_request'});
 assert.throws(()=>readSequence(f.root,f.id,'other'),{code:'capture_not_found'});
});
test('existing numbered asset is never overwritten or followed',async t=>{
 const f=fixture(t);let made=false;
 const original=f.args.observer.sample;
 f.args.observer.sample=async(...args)=>{if(!made){made=true;writeFileSync(join(f.options.outputDir,`${f.id}-0001.png`),'reserved');}return original(...args);};
 await assert.rejects(f.run(),{code:'capture_output_collision'});assert.equal(f.clicks,0);assert.equal(readFileSync(join(f.options.outputDir,`${f.id}-0001.png`),'utf8'),'reserved');assert.equal(f.read().assets.length,0);
});
test('invalid bounds and incompatible target/resume arguments rejected at shared boundary',()=>{
 const valid={tabId:'t',options:{outputDir:'/tmp/captures',next:{selector:'#next'}}};
 assert.equal(platformRequest('camofox_capture_sequence',valid,{userId:'a'}).path,'/tabs/t/capture-sequence');
 for(const args of [{tabId:'t'},{...valid,sequenceId:randomUUID()},{...valid,options:{...valid.options,maxCaptures:31}},{...valid,options:{...valid.options,next:{selector:'a',coordinates:{x:1,y:1}}}},{...valid,options:{...valid.options,capture:{clip:{x:0,y:0,width:0,height:10}}}},{...valid,options:{...valid.options,next:{coordinates:{x:1,y:1},frameSelector:'iframe'}}}])assert.throws(()=>platformRequest('camofox_capture_sequence',args,{userId:'a'}));
});
test('resume reconciles a checkpointed but unpublished capture without skipping it',async t=>{
 const f=fixture(t);await f.run();const m=f.read();const pending=m.assets[1];rmSync(pending.path);rmSync(m.assets[2].path);
 m.assets=m.assets.slice(0,1);m.checkpoint={last:m.assets[0],pending};m.phase='saving';m.state='interrupted';saveSequence(f.root,m);f.setIndex(1);
 const r=await f.run({resume:true,operationId:randomUUID()});assert.equal(r.captured,3);assert.equal(readFileSync(r.assets[1].path,'utf8'),'b');assert.equal(f.clicks,3);
});
test('changed current page after a proven non-dispatch stops recovery',async t=>{
 const f=fixture(t);await f.run();const m=f.read();m.assets=m.assets.slice(0,1);m.checkpoint={last:m.assets[0]};m.phase='captured';m.state='interrupted';saveSequence(f.root,m);f.setIndex(1);
 const r=await f.run({resume:true,operationId:randomUUID()});assert.equal(r.reason,'resume_mismatch');assert.equal(r.captured,1);assert.equal(f.clicks,2);
});
