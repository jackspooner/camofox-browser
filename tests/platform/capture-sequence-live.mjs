// Local-only acceptance: disposable profile, ports and output; installed cache required.
import assert from 'node:assert/strict';
import {mkdtempSync,symlinkSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import express from 'express';
import sharp from 'sharp';
import {Supervisor} from '../../lib/platform/supervisor.js';
import {installPlatformRoutes} from '../../lib/platform/routes.js';
import {loadPlatformConfig} from '../../lib/config.js';
import {terminalOperation} from '../../mcp/lib/operation-contracts.mjs';
import {runTool} from '../../mcp/lib/tool-contracts.mjs';
const stateDir=mkdtempSync(join(tmpdir(),'camofox-capture-live-'));
symlinkSync(resolve(process.argv[2]),join(stateDir,'cache'));
const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0}#page{width:300px;height:220px;background:#efc}<\/style><div id="page" data-ready="yes">Page 1</div><span id="position">1 of 3</span><button id="next">Next</button><div id="end" hidden>End</div><script>let n=1;document.querySelector('#next').onclick=()=>{if(document.body.dataset.noChange)return;document.querySelector('#page').removeAttribute('data-ready');setTimeout(()=>{n++;const p=document.querySelector('#page');p.textContent='Page '+n;p.style.background=['#efc','#cef','#fec'][n-1];p.dataset.ready='yes';document.querySelector('#position').textContent=n+' of 3';if(n===3){document.querySelector('#next').disabled=true;document.querySelector('#end').hidden=false;}},700);};<\/script>`;
const inner=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
await new Promise(r=>inner.listen(0,'127.0.0.1',r));
const fixture=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><style>body{margin:0}iframe{border:0;width:500px;height:400px}</style><iframe id="reader" src="http://127.0.0.1:${inner.address().port}"></iframe>`);});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const supervisor=new Supervisor({...loadPlatformConfig(),stateDir},{});
const profile=supervisor.store.createProfile('Capture fixture');
const session=supervisor.store.createSession(profile.id,'Isolated capture','test');
const app=express();app.use(express.json());installPlatformRoutes(app,supervisor,supervisor.config,()=>{});
app.use((e,_req,res,_next)=>res.status(e.statusCode||500).json({code:e.code,error:e.message}));
const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
async function call(path,body,method=body?'POST':'GET'){
 const r=await fetch(base+path+(path.includes('?')?'&':'?')+'userId=test',{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify({...body,userId:'test'})}:{})});
 return {httpStatus:r.status,...await r.json()};
}
async function settled(value){
 if(!value.pending)return value;
 for(let i=0;i<200;i++){await delay(100);const s=await call('/operations/'+value.operation.id);if(terminalOperation(s.operation.state))return {...s.result,operation:s.operation};}
 throw Error('Operation failed to settle');
}
const key=()=>`v1.${Date.now()}.${randomUUID()}`;
let tab;
const status=id=>call(`/agent-sessions/${session.id}/capture-sequences/${id}`);
const action=(kind,body)=>call(`/tabs/${tab}/${kind}`,body).then(settled);
const create=async(url)=>{const r=await settled(await call('/tabs',{sessionId:session.id,url}));assert(r.tabId,JSON.stringify(r));tab=r.tabId;};
const options=()=>({outputDir:join(stateDir,'output'),maxCaptures:30,capture:{selector:'#page',frameSelector:'#reader'},next:{selector:'#next',frameSelector:'#reader'},frameSelector:'#reader',positionSelector:'#position',readySelector:'#page[data-ready]',stableMs:250,changeTimeoutMs:2500,budgetMs:20000});
try{
 await supervisor.resume(session.id,'test');
 await create(`http://127.0.0.1:${fixture.address().port}`);
 const retry=key(),opts=options();
 let r=await call(`/tabs/${tab}/capture-sequence`,{options:opts,idempotencyKey:retry});
 assert.equal(r.pending,true,JSON.stringify(r));const first=r.operation.id;
 const duplicate=await call(`/tabs/${tab}/capture-sequence`,{options:opts,idempotencyKey:retry});assert.equal(duplicate.operation.id,first);
 r=await settled(r);assert.equal(r.operation.state,'completed',JSON.stringify(r));assert.equal(r.sequence.reason,'next_disabled');assert.equal(r.sequence.captured,3);assert.deepEqual(r.sequence.assets.map(a=>a.position),['1 of 3','2 of 3','3 of 3']);
 assert.equal(new Set(r.sequence.assets.map(a=>a.sha256)).size,3);for(const a of r.sequence.assets){const m=await sharp(a.path).metadata();assert.equal(m.width,300);assert.equal(m.height,220);}
 assert.equal((await status(first)).sequence.captured,3);
 console.log('PASS pending/idempotent dispatch, delayed iframe readiness, geometry, metadata, disabled end, saved assets');
 // MCP uses the same descriptor, operation envelope and service-host output path.
 const mcp=await runTool('camofox_capture_sequence_status',{sessionId:session.id,sequenceId:first},{userId:'test'},base,{cookiesDir:stateDir});assert.equal(mcp.payload.sequence.captured,3);
 await create(`http://127.0.0.1:${inner.address().port}`);
 await action('evaluate',{expression:"document.body.dataset.noChange='yes'"});
 r=await settled(await call(`/tabs/${tab}/capture-sequence`,{options:{outputDir:join(stateDir,'unchanged'),next:{selector:'#next'},capture:{clip:{x:0,y:0,width:300,height:220}},stableMs:250,changeTimeoutMs:1000}}));
 assert.equal(r.sequence.reason,'no_page_change');assert.equal(r.sequence.captured,1);const unchanged=r.sequence.sequenceId;
 r=await settled(await call(`/tabs/${tab}/capture-sequence`,{sequenceId:unchanged}));assert.equal(r.sequence.reason,'resume_ambiguous');
 console.log('PASS unchanged-page stop, viewport crop and safe ambiguous resume');
 // Cancellation uses the real operation endpoint; no second loop remains alive.
 await create(`http://127.0.0.1:${fixture.address().port}`);
 r=await call(`/tabs/${tab}/capture-sequence`,{options:{...options(),stableMs:1500,changeTimeoutMs:5000}});assert(r.pending);const cancelled=r.operation.id;
 await call(`/operations/${cancelled}/cancel`,{});r=await settled(r);assert.equal(r.operation.state,'cancelled',JSON.stringify(r));
 let checkpoint=(await status(cancelled)).sequence;assert.equal(checkpoint.state,'interrupted');const before=checkpoint.captured;await delay(500);assert.equal((await status(cancelled)).sequence.captured,before);
 // Resume explicitly from a safe phase, including a changed page after advance.
 r=await settled(await call(`/tabs/${tab}/capture-sequence`,{sequenceId:cancelled}));assert.equal(r.operation.state,'completed',JSON.stringify(r));assert(['next_disabled','resume_ambiguous'].includes(r.sequence.reason));
 console.log('PASS operation cancellation, durable partial result and explicit resume');
 // A killed worker leaves a write-ahead phase and a terminal unknown operation.
 await create(`http://127.0.0.1:${fixture.address().port}`);
 r=await call(`/tabs/${tab}/capture-sequence`,{options:{...options(),stableMs:1000,changeTimeoutMs:5000}});
 assert(r.pending);const interrupted=r.operation.id;
 supervisor.workers.get(session.id).child.kill('SIGKILL');
 r=await settled(r);assert.equal(r.operation.state,'outcome_unknown',JSON.stringify(r));
 checkpoint=(await status(interrupted)).sequence;assert.equal(checkpoint.state,'interrupted');
 await supervisor.resume(session.id,'test');
 r=await settled(await call(`/tabs/${tab}/capture-sequence`,{sequenceId:interrupted}));
 assert.equal(r.operation.state,'completed',JSON.stringify(r));
 assert(['next_disabled','resume_ambiguous','resume_mismatch'].includes(r.sequence.reason));
 console.log('PASS killed-worker checkpoint recovery without uncertain replay');
 // Operation deadline stops a batch while it is waiting for readiness.
 await create(`http://127.0.0.1:${fixture.address().port}`);
 r=await settled(await call(`/tabs/${tab}/capture-sequence`,{options:{...options(),readySelector:'#never-ready',budgetMs:1000}}));
 assert.equal(r.operation.state,'cancelled',JSON.stringify(r));assert.equal((await status(r.operation.id)).sequence.state,'interrupted');
 console.log('PASS deadline cancellation');
 // Persistent viewer Stop blocks starting/resuming even when no viewer is open.
 await supervisor.pauseAutomation(session.id);
 r=await call(`/tabs/${tab}/capture-sequence`,{options:options()});assert.equal(r.code,'automation_paused');supervisor.resumeAutomation(session.id);
 const worker=supervisor.workers.get(session.id);worker.humanControl=true;
 r=await call(`/tabs/${tab}/capture-sequence`,{options:options()});assert.equal(r.code,'human_control');worker.humanControl=false;
 console.log('PASS persistent automation pause and human-control admission');
 // Durable reads remain available after result eviction and worker suspension.
 supervisor.operations.results.clear();await supervisor.suspend(session.id,'test');
 assert.equal((await status(first)).sequence.captured,3);
 console.log('PASS manifest access after result eviction and suspension');
}finally{await supervisor.close();server.close();fixture.close();inner.close();rmSync(stateDir,{recursive:true,force:true});}
