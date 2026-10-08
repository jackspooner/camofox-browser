// Disposable gateway and cross-origin fixture; never uses live profiles or services.
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { Supervisor } from '../../lib/platform/supervisor.js';
import { workerJson } from '../../lib/platform/worker-launcher.js';
import { installPlatformRoutes } from '../../lib/platform/routes.js';
import { loadPlatformConfig } from '../../lib/config.js';
import { terminalOperation } from '../../mcp/lib/operation-contracts.mjs';
import { applicationProblem } from '../../mcp/lib/problems.mjs';
import { runTool } from '../../mcp/lib/tool-contracts.mjs';
const stateDir=mkdtempSync(join(tmpdir(),'camofox-frame-live-'));
symlinkSync(resolve(process.argv[2]),join(stateDir,'cache'));
const reader=`<!doctype html><button id="similar">Next page settings</button><button id="next" onclick="document.querySelector('#position').textContent='Location '+(++n)+' of 17'">Next page</button><p id="position" role="status">Location 1 of 17</p><img alt="Sample" width="10" height="12" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='12'/%3E"><div id="long">${'X'.repeat(3000)}</div><div id="form"><textarea>PRIVATE VALUE</textarea><input value="SECRET"><span>Public</span></div>${'<span class="many">abc</span>'.repeat(120)}<script>let n=1;</script>`;
const inner=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(reader);});
await new Promise(r=>inner.listen(0,'127.0.0.1',r));
const fixture=createServer((req,res)=>{const count=Number(new URL(req.url,'http://fixture').searchParams.get('n')||500);res.setHeader('Content-Type','text/html');res.end(`<!doctype html>${Array.from({length:count},(_,i)=>`<button>Parent ${i}</button>`).join('')}<p>${'tail text '.repeat(10000)}</p><iframe id="reader" name="reader" src="http://127.0.0.1:${inner.address().port}" style="width:700px;height:300px"></iframe>`);});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const config={...loadPlatformConfig(),stateDir},supervisor=new Supervisor(config,{});
const profile=supervisor.store.createProfile('Iframe fixture'),session=supervisor.store.createSession(profile.id,'Isolated iframe reads','test');
const app=express();app.use(express.json());installPlatformRoutes(app,supervisor,config,()=>{});
app.use((error,_req,res,_next)=>res.status(error.statusCode||500).json({code:error.code,problem:applicationProblem(error)}));
const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
async function call(path,body){const r=await fetch(base+path+(path.includes('?')?'&':'?')+'userId=test',{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify({...body,userId:'test'})}:{})});return {httpStatus:r.status,...await r.json()};}
async function settled(value){if(!value.pending)return value;for(let i=0;i<200;i++){await delay(100);const r=await call('/operations/'+value.operation.id);if(terminalOperation(r.operation.state))return {...r.result,operation:r.operation};}throw Error('Operation did not settle');}
let tab;const action=(kind,body)=>call(`/tabs/${tab}/${kind}`,body).then(settled);
const snapshot=()=>call(`/tabs/${tab}/snapshot`);
const read=options=>action('read',{frameSelector:'#reader',selector:'#position',...options});
try {
 await supervisor.resume(session.id,'test');
 for(const count of [499,500,501]){
  const created=await settled(await call('/tabs',{sessionId:session.id,url:`http://127.0.0.1:${fixture.address().port}/?n=${count}`}));tab=created.tabId;assert(tab,JSON.stringify(created));
  const snap=await snapshot();assert.equal(snap.refCoverage.documents[0].assigned,Math.min(count,500));
  const ref=snap.snapshot.match(/button "Next page" \[(e\d+)\]/)?.[1];assert(ref,JSON.stringify(snap.refCoverage));
  assert(snap.hasMore);const next=await call(`/tabs/${tab}/snapshot?offset=${snap.nextOffset}`);assert.deepEqual(next.refCoverage,snap.refCoverage);
  await action('evaluate',{expression:"document.querySelector('#reader').style.marginLeft='50px';true"});
  assert.equal((await action('click',{ref})).ok,true);assert.equal((await read({})).items[0].text,'Location 2 of 17');
 }
 console.log('PASS native cross-origin ref clicks at 499/500/501, layout movement, pagination coverage');
 const main=await action('read',{selector:'button',fields:['text'],limit:2});assert.equal(main.frame.main,true);assert.equal(main.returned,2);assert(main.omittedItems>0);
 let r=await read({selector:'img',fields:['src','currentSrc','alt','width','height','naturalWidth','naturalHeight','complete']});assert.equal(r.items[0].alt,'Sample');assert.equal(r.items[0].src,null);assert(r.omissions.some(o=>o.reason==='data_url'));assert.equal(r.items[0].width,10);
 r=await read({selector:'#long'});assert.equal(r.items[0].text.length,2048);assert.equal(r.omissions[0].reason,'string_limit');
 r=await read({selector:'.many',limit:100,maxChars:7});assert.equal(r.returned,100);assert.equal(r.omittedItems,20);assert.equal(r.items.reduce((n,i)=>n+i.text.length,0),7);assert(r.omissions.some(o=>o.reason==='character_budget'));
 assert.equal((await read({selector:'#form'})).items[0].text,'Public');assert.equal((await read({selector:'textarea'})).items[0].text,null);
 assert.equal((await read({selector:'#absent'})).returned,0);
 for(const [args,code] of [[{selector:'['},'invalid_selector'],[{frameSelector:'['},'invalid_selector'],[{frameSelector:'#none'},'invalid_target'],[{frameSelector:'button'},'ambiguous_target'],[{fields:['value']},'invalid_request']]){r=await read(args);assert.equal(r.problem?.code||r.code,code,JSON.stringify(r));}
 const mcp=await runTool('camofox_read',{tabId:tab,frameSelector:'#reader',selector:'#position',fields:['text']},{userId:'test'},base,{cookiesDir:stateDir});assert.equal(mcp.payload.items[0].text,'Location 2 of 17');
 console.log('PASS bounded main/frame reads, CSS validation, allowed fields, redaction, empty matches, MCP parity');
 let snap=await snapshot(),ref=snap.snapshot.match(/button "Next page" \[(e\d+)\]/)[1];
 await action('evaluate',{expression:"new Promise(resolve=>{const f=document.querySelector('#reader'),next=f.cloneNode();next.onload=()=>resolve(true);f.replaceWith(next);})"});
 r=await action('click',{ref});assert.equal(r.problem.code,'stale_refs',JSON.stringify(r));assert.equal(r.operation.problem.code,'stale_refs');assert.match(r.operation.problem.detail,/snapshot/);
 const stored=await call('/operations/'+r.operation.id);assert.equal(stored.operation.problem.code,'stale_refs');
 snap=await snapshot();ref=snap.snapshot.match(/button "Next page" \[(e\d+)\]/)[1];await action('click',{ref});assert.equal((await read({})).items[0].text,'Location 2 of 17');
 await action('evaluate',{expression:"new Promise(resolve=>{const f=document.querySelector('#reader');f.onload=()=>resolve(true);f.src += '?new-document';})"});r=await action('click',{ref});assert.equal(r.problem.code,'stale_refs');
 snap=await snapshot();ref=snap.snapshot.match(/button "Next page" \[(e\d+)\]/)[1];
 await action('evaluate',{expression:"document.querySelector('#reader').remove();true"});r=await action('click',{ref});assert.equal(r.problem.code,'stale_refs');
 await action('evaluate',{expression:`document.querySelector('body > p').remove();const f=document.createElement('iframe');f.id='reader';f.src='http://127.0.0.1:${inner.address().port}';const other=f.cloneNode();other.id='reader2';Promise.all([f,other].map(frame=>new Promise(resolve=>{frame.onload=()=>resolve(true);document.body.append(frame);})))`});
 snap=await snapshot();const duplicateRefs=[...snap.snapshot.matchAll(/button "Next page" \[(e\d+)\]/g)].map(m=>m[1]);assert.equal(duplicateRefs.length,2);
 await action('click',{ref:duplicateRefs[1]});assert.equal((await read({frameSelector:'#reader2'})).items[0].text,'Location 2 of 17');assert.equal((await read({})).items[0].text,'Location 1 of 17');
 console.log('PASS replacement/navigation/removal stale errors, retained operation code, multiple frames and snapshot recovery');
 const worker=supervisor.workers.get(session.id);worker.humanControl=true;await workerJson(worker.socket,supervisor.config.workerKey,'POST','/internal/viewer-mode',{humanControl:true});r=await read({});assert.equal(r.items[0].text,'Location 1 of 17');worker.humanControl=false;await workerJson(worker.socket,supervisor.config.workerKey,'POST','/internal/viewer-mode',{humanControl:false});
 console.log('PASS read-only access during human control without input');
 await action('evaluate',{expression:`document.body.innerHTML='<button onclick="this.textContent=123">Untouched</button>';true`});
 await action('click',{coordinates:{x:1,y:1}});
 r=await action('click',{ref:'e1'});assert.equal(r.problem?.code,'stale_refs',JSON.stringify(r));assert.equal((await action('read',{selector:'button'})).items[0].text,'Untouched');
 console.log('PASS absent refs cannot be rebuilt and dispatched against new controls');
} finally {await supervisor.close();server.close();fixture.close();inner.close();rmSync(stateDir,{recursive:true,force:true});}
