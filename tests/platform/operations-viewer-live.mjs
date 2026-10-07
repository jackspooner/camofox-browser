// Visible, isolated acceptance through the maintained stdio adapter with distinct host identities.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import express from 'express';
import assert from 'node:assert/strict';
import {Supervisor} from '../../lib/platform/supervisor.js';
import {installViewer} from '../../lib/platform/viewer.js';
import {installPlatformRoutes} from '../../lib/platform/routes.js';
import {loadPlatformConfig} from '../../lib/config.js';
import {terminalOperation} from '../../mcp/lib/operation-contracts.mjs';
const stateDir=mkdtempSync(join(tmpdir(),'camofox-operation-viewer-'));
symlinkSync(resolve(process.argv[2]),join(stateDir,'cache'));
const config={...loadPlatformConfig(),stateDir,accessKey:randomUUID()},supervisor=new Supervisor(config,{});
const fixture=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><style>body{font:22px system-ui;background:#112633;color:#dff;padding:4rem}textarea{font:20px system-ui;width:80%;height:16rem;padding:1rem}</style><h1>Live operation tracking</h1><p>The toolbar shows progress. Stop cancels typing and pauses automation.</p><textarea aria-label="Demo draft"></textarea>');});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const app=express();app.use(express.json());const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));config.port=server.address().port;
const openViewer=installViewer(app,server,supervisor,config);
app.use((req,res,next)=>req.headers.authorization===`Bearer ${config.accessKey}`?next():res.sendStatus(401));
installPlatformRoutes(app,supervisor,config,openViewer);
app.use((err,_req,res,_next)=>res.status(err.statusCode||500).json({code:err.code,error:err.message}));
const exec=promisify(execFile),activate=async label=>{const r=await exec('/usr/bin/python3',['tests/platform/control-ui.py',label,String([...supervisor.workers.values()].find(w=>w.viewer)?.viewer.desktop.child.pid)]);return r.stdout;};
try{
 for(const identity of ['codex-operation-demo','hermes-operation-demo']){
  const client=new Client({name:identity,version:'1'});let sessionId;
  const call=async(name,args)=>{const r=await client.callTool({name,arguments:args},undefined,{timeout:120000});if(r.isError)throw Error(r.content[0].text);return r.structuredContent||JSON.parse(r.content[0].text);};
  const ready=async predicate=>{for(let i=0;i<100;i++){const s=await call('camofox_session_status',{sessionId});if(s.viewer.state==='connected'&&(!predicate||predicate(s)))return s;await delay(100);}throw Error('Viewer state timeout');};
  const terminal=async id=>{for(let i=0;i<100;i++){const s=await call('camofox_operation_status',{operationId:id});if(terminalOperation(s.operation.state))return s;await delay(100);}throw Error('Operation state timeout');};
  try{
   await client.connect(new StdioClientTransport({command:process.execPath,args:['mcp/server.mjs'],cwd:process.cwd(),env:{PATH:process.env.PATH,HOME:process.env.HOME,CAMOFOX_BASE_URL:`http://127.0.0.1:${config.port}`,CAMOFOX_ACCESS_KEY:config.accessKey,CAMOFOX_API_KEY:config.accessKey,CAMOFOX_USER_ID:identity},stderr:'pipe'}));
   assert.equal((await client.listTools()).tools.length,30);
   const p=await call('camofox_profile_create',{name:identity});sessionId=(await call('camofox_session_create',{profileId:p.id,name:'Control handoff acceptance '+identity})).id;
   let created=await call('camofox_create_tab',{sessionId,url:`http://127.0.0.1:${fixture.address().port}`});if(created.pending)created=(await terminal(created.operation.id)).result;
   const tabId=created.tabId;await call('camofox_session_watch',{sessionId,open:true});await ready();
   const text=`${identity}: This text is typed locally at about 150 words per minute. ` .repeat(8);
   const active=await call('camofox_type',{tabId,selector:'textarea',text});assert(active.pending);assert(active.operation.progress.completed>0);
   const queued=await call('camofox_type',{tabId,selector:'textarea',text:'This queued action must never run.'});assert.equal(queued.operation.state,'queued');
   const tree=await activate('inspect');assert(tree.includes('Stop'),tree);
   await activate('Stop');assert.equal((await terminal(active.operation.id)).operation.state,'cancelled');assert.equal((await terminal(queued.operation.id)).operation.state,'cancelled');await ready(s=>s.automationPaused);
   await call('camofox_session_watch',{sessionId,open:false});await call('camofox_session_watch',{sessionId,open:true});await ready(s=>s.automationPaused);
   await activate('Resume automation');await ready(s=>!s.automationPaused);
   const takeover=await call('camofox_type',{tabId,selector:'textarea',text});assert(takeover.pending);
   const start=Date.now();await activate('Take control');await ready(s=>s.humanControl);assert(Date.now()-start<2500,'Responsive takeover exceeded 2.5s');assert.equal((await terminal(takeover.operation.id)).operation.state,'cancelled');
   await activate('Return to agent');await ready(s=>!s.humanControl);await call('camofox_snapshot',{tabId});
   const give=call('camofox_session_control',{sessionId,action:'give'});await activate('Accept control');assert.equal((await give).outcome,'accepted');await ready(s=>s.humanControl);
   const back=call('camofox_session_control',{sessionId,action:'request'});await activate('Return control');assert.equal((await back).outcome,'accepted');await ready(s=>!s.humanControl);
   const final=await call('camofox_type',{tabId,selector:'textarea',text:'Automation resumed. Cancelled work did not restart.'});if(final.pending)assert.equal((await terminal(final.operation.id)).operation.state,'completed');
   console.log(`PASS ${identity}: 30-tool discovery, visible progress, Stop current+queued, reopen pause, explicit Resume, safe takeover, timed accepted handoffs, new typing`);
  }finally{if(sessionId){await call('camofox_session_watch',{sessionId,open:false}).catch(()=>{});await call('camofox_session_suspend',{sessionId}).catch(()=>{});}await client.close();}
 }
}finally{await supervisor.close();server.closeAllConnections();await new Promise(r=>server.close(r));fixture.closeAllConnections();await new Promise(r=>fixture.close(r));rmSync(stateDir,{recursive:true,force:true});}
