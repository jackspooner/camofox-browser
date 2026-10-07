// Isolated real-browser acceptance. Pass the installed browser cache.
import assert from 'node:assert/strict';
import {mkdtempSync,symlinkSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import express from 'express';
import {Supervisor} from '../../lib/platform/supervisor.js';
import {workerJson} from '../../lib/platform/worker-launcher.js';
import {installPlatformRoutes} from '../../lib/platform/routes.js';
import {loadPlatformConfig} from '../../lib/config.js';
import {terminalOperation} from '../../mcp/lib/operation-contracts.mjs';
const stateDir=mkdtempSync(join(tmpdir(),'camofox-operations-live-'));
symlinkSync(resolve(process.argv[2]),join(stateDir,'cache'));
const fixture=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta charset="utf-8"><title>Operation acceptance</title><h1>Camofox paced typing</h1><input id="text" value="old"><input id="password" type="password"><textarea id="multi"></textarea><div id="edit" contenteditable="true"></div><input id="mask" oninput="this.value=this.value.toUpperCase()"><input id="rerender" oninput="this.outerHTML=this.outerHTML"><input id="blur" oninput="document.querySelector('#text').focus()"><input id="email" type="email"><script>document.body.dataset.enters='0';window.events=[];document.addEventListener('keydown',e=>{if(e.key==='Enter')document.body.dataset.enters=Number(document.body.dataset.enters)+1});document.querySelector('#text').addEventListener('input',()=>events.push(performance.now()));</script>`);});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const supervisor=new Supervisor({...loadPlatformConfig(),stateDir},{});
const profile=supervisor.store.createProfile('Operations acceptance');
const session=supervisor.store.createSession(profile.id,'Isolated typing','test');
const app=express();app.use(express.json());installPlatformRoutes(app,supervisor,supervisor.config,()=>{});
app.use((e,_req,res,_next)=>res.status(e.statusCode||500).json({code:e.code,error:e.message}));
const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
async function call(path,body,method=body?'POST':'GET'){
 const r=await fetch(base+path+(path.includes('?')?'&':'?')+'userId=test',{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify({...body,userId:'test'})}:{})});
 return {status:r.status,...await r.json()};
}
async function settled(value){
 if(value.pending){let until=Date.now()+610000;while(Date.now()<until){await delay(200);const s=await call('/operations/'+value.operation.id);if(terminalOperation(s.operation.state))return {...s.result,operation:s.operation};}throw Error('Operation did not terminate');}
 return value;
}
let tab;
const action=(kind,body)=>call(`/tabs/${tab}/${kind}`,body).then(settled);
const evaluate=async expression=>{const r=await action('evaluate',{expression});assert.equal(r.operation.state,'completed',JSON.stringify(r));return r.result;};
try{
 await supervisor.resume(session.id,'test');
 const created=await settled(await call('/tabs',{sessionId:session.id,url:`http://127.0.0.1:${fixture.address().port}`}));tab=created.tabId;assert(tab,JSON.stringify(created));
 let r=await action('type',{selector:'#text',text:'Exact 👩‍💻 café é'});assert.equal(r.operation.state,'completed',JSON.stringify(r));assert.equal(await evaluate("document.querySelector('#text').value"),'Exact 👩‍💻 café é');
 r=await action('type',{selector:'#text',text:' appended',append:true});assert.equal(r.operation.state,'completed',JSON.stringify(r));
 assert.equal(await evaluate("document.querySelector('#text').value"),'Exact 👩‍💻 café é appended');
 await action('type',{selector:'#text',text:'instant',mode:'fill'});await action('type',{selector:'#text',text:' keyboard',mode:'keyboard',delay:1});assert.equal(await evaluate("document.querySelector('#text').value"),'instant keyboard');
 for(const selector of ['#multi','#edit']){r=await action('type',{selector,text:'First line\nSecond line',wpm:300});assert.equal(r.operation.state,'completed',JSON.stringify(r));}
 for(const selector of ['#password','#email']){r=await action('type',{selector,text:'abc',wpm:300});assert.equal(r.operation.state,'completed',JSON.stringify(r));r=await action('type',{selector,text:'d',append:true});assert.equal(r.operation.state,'completed',JSON.stringify(r));}
 for(const [selector,code]of [['#mask','typing_mismatch'],['#rerender','target_changed'],['#blur','focus_changed']]){r=await action('type',{selector,text:'abcdefgh'});assert.equal(r.operation.problem.code,code,JSON.stringify(r));}
 r=await action('type',{selector:'#text',text:'',wpm:150});assert.equal(r.operation.state,'completed');assert.equal(await evaluate("document.querySelector('#text').value"),'');
 r=await action('type',{selector:'#text',text:'bad\nline'});assert.equal(r.operation.state,'failed');assert.equal(await evaluate("document.querySelector('#text').value"),'');
 console.log('PASS exact Unicode, append, fill, keyboard, password/email, multiline/contenteditable, empty, target/focus/mask failures');
 const retryKey=`v1.${Date.now()}.${randomUUID()}`;
 const pending=await call(`/tabs/${tab}/type`,{selector:'#text',text:'long '.repeat(100),pressEnter:true,idempotencyKey:retryKey});assert.equal(pending.status,202);assert(pending.operation.progress.completed>0);
 const queued=await call(`/tabs/${tab}/type`,{selector:'#text',text:'must not run'});assert.equal(queued.operation.state,'queued');
 const before=Date.now();await supervisor.pauseAutomation(session.id);assert(Date.now()-before<2000,'responsive Stop exceeded two seconds');
 for(const p of [pending,queued])assert.equal(supervisor.operations.get(p.operation.id).state,'cancelled');
 const paused=await call(`/tabs/${tab}/type`,{selector:'#text',text:'blocked'});assert.equal(paused.code,'automation_paused');
 const retry=await call(`/tabs/${tab}/type`,{selector:'#text',text:'long '.repeat(100),pressEnter:true,idempotencyKey:retryKey});assert.equal(retry.operation.id,pending.operation.id);
 supervisor.resumeAutomation(session.id);assert.equal(await evaluate('Number(document.body.dataset.enters)'),2); // multiline Enter only; cancelled submit suppressed
 console.log('PASS pending/progress, Stop current+queued, persistent pause, retry identity, suppressed submit');
 for(const length of (process.argv.includes("--quick")?[]:[500,1500])){
  await evaluate('window.events=[]');const text='abcde '.repeat(Math.ceil(length/6)).slice(0,length),started=Date.now();
  r=await action('type',{selector:'#text',text});assert.equal(r.operation.state,'completed',JSON.stringify(r));assert.equal(await evaluate("document.querySelector('#text').value"),text);
  const elapsed=Date.now()-started;assert(elapsed>length*60&&elapsed<length*130,`Cadence out of range: ${length} units ${elapsed}ms`);
  console.log(`PASS ${length} characters at default 150 WPM: ${elapsed}ms, exact output`);
 }
 // Recovery metadata and pause persist without retaining raw text or replaying it.
 supervisor.store.update(session.id,{automationPaused:true});await supervisor.suspend(session.id,'test');await supervisor.resume(session.id,'test');assert(supervisor.publicSession(session.id).automationPaused);
 console.log('PASS suspension/restoration retains Stop pause');
 supervisor.resumeAutomation(session.id);
 await evaluate(`document.body.innerHTML='<button id="target" onclick="this.dataset.count=Number(this.dataset.count||0)+1">Target</button>';true`);
 const geometry=await evaluate(`(()=>{const r=document.querySelector('#target').getBoundingClientRect();return {x1:r.x,y1:r.y,x2:r.right,y2:r.bottom};})()`);
 const w=supervisor.workers.get(session.id),capture=await workerJson(w.socket,supervisor.config.workerKey,'POST','/internal/capture',{tabId:tab});
 const observationId=randomUUID();supervisor.observations.set(observationId,{sessionId:session.id,tabId:tab,captureId:capture.captureId,boxes:[{targetNumber:1,...geometry}],created:Date.now()});
 const one=await settled(await call(`/observations/${observationId}/click`,{targetNumber:1}));
 assert.equal(one.operation.state,'completed',JSON.stringify(one));
 const two=await settled(await call(`/observations/${observationId}/click`,{targetNumber:1}));
 assert.equal(one.operation.id,two.operation.id);assert.equal(await evaluate("document.querySelector('#target').dataset.count"),'1');
 console.log('PASS captured visual-target retries share one operation and native click');
 const hung=await call(`/tabs/${tab}/evaluate`,{expression:'new Promise(()=>{})'});assert(hung.pending);
 await call('/operations/'+hung.operation.id+'/cancel',{});
 const unknown=await settled(hung);assert.equal(unknown.operation.state,'outcome_unknown');
 assert.equal(supervisor.publicSession(session.id).state,'suspended');
 console.log('PASS unresponsive native evaluation is quarantined, worker stopped and outcome unknown');
} catch(error){console.error(error);const log=readFileSync(join(stateDir,'profiles',profile.id,'worker.log'),'utf8');console.error(log.split('\n').slice(-12).join('\n'));process.exitCode=1;}
finally{server.closeAllConnections();await new Promise(r=>server.close(r));await supervisor.close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));rmSync(stateDir,{recursive:true,force:true});}
