// Isolated regressions: no production profiles, routes, or credentials.
import assert from 'node:assert/strict';
import {mkdtempSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import express from 'express';
import {Supervisor} from '../../lib/platform/supervisor.js';
import {workerJson} from '../../lib/platform/worker-launcher.js';
import {installPlatformRoutes} from '../../lib/platform/routes.js';
import {loadPlatformConfig} from '../../lib/config.js';
const stateDir=mkdtempSync(join(tmpdir(),'camofox-audit4-'));
assert(process.argv[2], 'Pass an existing browser cache');
symlinkSync(process.argv[2],join(stateDir,'cache'));
const fixture=createServer((req,res)=>{
  if(req.url==='/download') {res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="audit.txt"'});res.end('disposable audit file');return;}
  res.setHeader('Content-Type','text/html');
  res.end(req.url==='/frame' ? '<button onclick="parent.document.body.dataset.frameClicked=1">Approve</button>' : `<!doctype html><title>Isolated audit</title><script>addEventListener("keydown",e=>{if(e.key==="Enter")document.body.dataset.entered="yes"})</script><label>First<input id="one"></label><label>Second<input id="two"></label><button onclick="document.body.dataset.topClicked=1">Approve</button><iframe name="audit-frame" src="/frame"></iframe><a id="download" href="/download">Download</a>`);
});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const supervisor=new Supervisor({...loadPlatformConfig(),stateDir},{});
const p=supervisor.store.createProfile('Disposable audit');
const s=supervisor.store.createSession(p.id,'Audit','audit');
const app=express();app.use(express.json());
installPlatformRoutes(app,supervisor,supervisor.config,()=>{});
app.use((e,_req,res,_next)=>res.status(e.statusCode||500).json({error:e.message,code:e.code}));
const gateway=createServer(app);await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${gateway.address().port}`;
async function call(path,body,method=body?'POST':'GET'){
 const r=await fetch(base+path+(path.includes('?')?'&':'?')+'userId=audit&sessionId='+s.id,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify({...body,userId:'audit',sessionId:s.id})}:{})});
 return {status:r.status,data:await r.json()};
}
let tab;
const evaluate=async expression=>(await call(`/tabs/${tab}/evaluate`,{expression})).data.result;
async function human(value){const w=supervisor.workers.get(s.id);w.humanControl=value;await workerJson(w.socket,supervisor.config.workerKey,'POST','/internal/viewer-mode',{humanControl:value});}
try{
 await supervisor.resume(s.id,'audit');
 const created=await call('/tabs',{url:`http://127.0.0.1:${fixture.address().port}`,sessionKey:'default'});assert.equal(created.status,200);tab=created.data.tabId;
 const snap=await call(`/tabs/${tab}/snapshot`);assert.equal(snap.status,200);
 assert.match(snap.data.snapshot, /button "Approve" \[e3\]/);
 assert.match(snap.data.snapshot, /button "Approve" \[e5\]/);
 const frameRef=`e${snap.data.refsCount}`; // buildRefs appends the sole iframe button after main-document refs.
 await call(`/tabs/${tab}/click`,{ref:frameRef});
 assert.equal(await evaluate('document.body.dataset.frameClicked'), '1');
 await evaluate("document.querySelector('iframe').remove();true");
 const staleClick=await call(`/tabs/${tab}/click`,{ref:frameRef});
 const topClicked=await evaluate("document.body.dataset.topClicked||null");
 console.log('REMOVED_FRAME',JSON.stringify({status:staleClick.status,topClicked}));
 assert.equal(staleClick.status,422);assert.equal(staleClick.data.code,'stale_refs');assert.equal(topClicked,null);
 console.log('PASS removed iframe ref rejected without a top-level click');
 await call(`/tabs/${tab}/click`,{selector:'#download'});
 let downloads;
 for(let i=0;i<30;i++){downloads=await call(`/tabs/${tab}/downloads`);if(downloads.data.downloads?.length)break;await delay(100);}
 assert.equal(downloads.data.downloads.length,1);
 await human(true);
 const blocked=await call(`/tabs/${tab}/type`,{selector:'#one',text:'blocked'});
 assert.equal(blocked.data.code,'human_control');
 const consume=await call(`/tabs/${tab}/downloads?consume=true`);
 const after=await call(`/tabs/${tab}/downloads`);
 console.log('HUMAN_DOWNLOAD_DELETE',JSON.stringify({mutationBlocked:blocked.data.code,consumeStatus:consume.status,before:downloads.data.downloads.length,after:after.data.downloads.length,humanControl:supervisor.publicSession(s.id).humanControl}));
 assert.equal(consume.data.code,'human_control');assert.equal(after.data.downloads.length,1);
 assert.equal((await call(`/tabs/${tab}/downloads`,undefined,'DELETE')).data.code,'human_control');
 console.log('PASS human control blocks legacy consumption and explicit deletion');
 await human(false);
 assert.equal((await call(`/tabs/${tab}/downloads`,undefined,'DELETE')).status,200);
 assert.equal((await call(`/tabs/${tab}/downloads`)).data.downloads.length,0);
 const start=Date.now();
 const typing=await call(`/tabs/${tab}/type`,{selector:'#one',mode:'keyboard',delay:100,text:'a'.repeat(430),pressEnter:true});
 const elapsed=Date.now()-start;
 const immediately=await evaluate('document.querySelector("#one").value.length');
 const next=await call(`/tabs/${tab}/type`,{selector:'#two',text:'NEXT'});
 await human(true);
 await delay(1800);
 // Direct worker read observes state while respecting the public human mutation block.
 const w=supervisor.workers.get(s.id);
 const leaked=await workerJson(w.socket,supervisor.config.workerKey,'POST',`/tabs/${tab}/evaluate`,{userId:s.id,expression:'({one:document.querySelector("#one").value.length,two:document.querySelector("#two").value.length,entered:document.body.dataset.entered||null})'});
 console.log('TIMEOUT_INPUT_LEAK',JSON.stringify({status:typing.status,error:typing.data.code,elapsedMs:elapsed,firstLengthAtFailure:immediately,secondOperationStatus:next.status,afterHumanTakeover:leaked.result}));
 assert.equal(typing.status,409);assert.equal(typing.data.code,'operation_cancelled');assert.equal(typing.data.retryable,false);assert.equal(leaked.result.two,4);assert.equal(leaked.result.one,immediately);assert.equal(leaked.result.entered,null);
 console.log('PASS timed-out input stops before next operation and human takeover');
 await human(false);
}finally{
 const w=supervisor.workers.get(s.id);if(w)w.humanControl=false;
 gateway.closeAllConnections();await new Promise(r=>gateway.close(r));
 await supervisor.close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));
 rmSync(stateDir,{recursive:true,force:true});
}
