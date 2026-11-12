// Local fixtures and disposable browser state. --real-local uses existing MediaTools quick inference.
import assert from 'node:assert/strict';
import {mkdtempSync,symlinkSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
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
import {runTool,adaptResponse} from '../../mcp/lib/tool-contracts.mjs';

const real=process.argv.includes('--real-local'),rootFlag=process.argv.indexOf('--state-root');
const stateRoot=rootFlag<0?(real?process.cwd():tmpdir()):resolve(process.argv[rootFlag+1]);
const stateDir=mkdtempSync(join(stateRoot,'camofox-analysis-live-'));
symlinkSync(resolve(process.argv[2]),join(stateDir,'cache'));
const png=await sharp({create:{width:160,height:120,channels:3,background:'red'}}).png().toBuffer();
let inferenceCalls=0,slow=false,framePort,retainState=false;
const observations=[];
const mock=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const message=JSON.parse(raw||'{}');
 if(message.id===undefined){res.writeHead(202);res.end();return;}
 let result;
 if(message.method==='initialize')result={protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'image-fixture',version:'1'}};
 else if(message.method==='tools/call'){
  inferenceCalls++;
  const args=message.params.arguments,image=args.request.input[0].content[1];
  assert.equal(image.type,'image_file');assert(readFileSync(image.image_file).length>0);
  if(slow)await delay(3500);
  result={content:[{type:'text',text:JSON.stringify({text:'red',json:{colour:'red'},selection:{mode:'quick',provider:'fixture'}})}]};
 }else result={tools:[]};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:message.id,result}));
});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));
const fixture=createServer((req,res)=>{
 if(req.url==='/image'){if(!req.headers.cookie?.includes('fixture=allowed')){res.writeHead(403);res.end();return;}res.setHeader('Content-Type','image/png');res.end(png);return;}
 res.setHeader('Set-Cookie','fixture=allowed; Path=/');res.setHeader('Content-Type','text/html');
 res.end(`<!doctype html><style>body{margin:0}img,canvas{width:160px;height:120px}iframe{border:0;width:200px;height:150px}</style><img id="image" alt="Red square" src="/image"><canvas id="canvas" width="160" height="120"></canvas><img id="data" src="data:image/png;base64,${png.toString('base64')}"><img id="blob"><iframe id="frame" src="http://127.0.0.1:${framePort}/"></iframe><script>const c=document.querySelector('canvas');c.getContext('2d').fillStyle='red';c.getContext('2d').fillRect(0,0,160,120);fetch('/image').then(r=>r.blob()).then(b=>document.querySelector('#blob').src=URL.createObjectURL(b));</script>`);
});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const frame=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<style>body{margin:0}img{width:160px;height:120px}</style><img id="frame-image" src="data:image/png;base64,${png.toString('base64')}">`);});
await new Promise(r=>frame.listen(0,'127.0.0.1',r));framePort=frame.address().port;
const token=join(stateDir,'mock.token');writeFileSync(token,'fixture',{mode:0o600});
const config={...loadPlatformConfig(),stateDir,...(real?{}:{mediaUrl:`http://127.0.0.1:${mock.address().port}/mcp`,mediaTokenFile:token})};
const supervisor=new Supervisor(config,{}),profile=supervisor.store.createProfile('Analysis fixture'),session=supervisor.store.createSession(profile.id,'Image analysis','fixture');
const app=express();app.use(express.json());installPlatformRoutes(app,supervisor,config,()=>{});app.use((e,_req,res,_next)=>res.status(e.statusCode||500).json({code:e.code,error:e.message}));
const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
async function call(path,body){const r=await fetch(base+path+(path.includes('?')?'&':'?')+'userId=fixture',{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify({...body,userId:'fixture'})}:{})});return {httpStatus:r.status,...await r.json()};}
async function settled(value){for(let i=0;value.pending&&i<1500;i++){await delay(100);const status=await call('/operations/'+value.operation.id);if(terminalOperation(status.operation.state))return {...status.result,operation:status.operation};}return value;}
let tabId;
const args=source=>({tabId,prompt:'What is the dominant colour? Return JSON with exactly one key colour and a simple English colour name.',source,output:real?{type:'json_object'}:{type:'json_schema',schema:{type:'object',properties:{colour:{type:'string'}},required:['colour'],additionalProperties:false}},maxOutputTokens:real?1024:128});
try{
 await supervisor.resume(session.id,'fixture');
 const created=await settled(await call('/tabs',{sessionId:session.id,url:`http://127.0.0.1:${fixture.address().port}/`}));tabId=created.tabId;assert(tabId,JSON.stringify(created));
 await delay(500);
 const screenshot=await runTool('camofox_screenshot',{tabId},{userId:'fixture'},base,{});
 const blocks=adaptResponse(screenshot.spec,screenshot.payload);assert.equal(blocks.at(-1).type,'image');
 const capture=JSON.parse(blocks[0].text).capture;assert(capture.captureId);
 const sources=real?[{type:'element',selector:'#image'},{type:'original',selector:'#image'}]:[{type:'viewport'},{type:'region',clip:{x:0,y:0,width:160,height:120}},{type:'capture',captureId:capture.captureId},{type:'original',selector:'#image'},{type:'original',selector:'#data'},{type:'original',selector:'#blob'},{type:'original',selector:'#canvas',screenshotFallback:true},{type:'element',selector:'#frame-image',frameSelector:'#frame'},{type:'original',selector:'#frame-image',frameSelector:'#frame'}];
 for(const source of sources){
  const result=await settled(await call(`/tabs/${tabId}/analyse-image`,args(source)));
  if(result.operation.state==='outcome_unknown')retainState=true;
  assert.equal(result.operation.state,'completed',JSON.stringify({source,result}));assert.equal(result.ok,true,JSON.stringify(result));assert(result.image.sha256);
  if(source.type==='original'&&source.selector==='#canvas')assert(result.image.fallback);
  if(source.type==='capture')assert.equal(result.image.sha256,capture.sha256);
  assert.equal(typeof result.inference.json.colour,'string');
  const semanticMatch=result.inference.json.colour.toLowerCase()==='red';
  if(!real)assert(semanticMatch);
  observations.push({source:source.type,colour:result.inference.json.colour,semanticMatch,sha256:result.image.sha256});
 }
 const invalid=await settled(await call(`/tabs/${tabId}/analyse-image`,args({type:'capture',captureId:randomUUID()})));assert.equal(invalid.operation.state,'failed');assert.equal(invalid.code,'capture_not_found');
 if(!real){
  slow=true;const before=inferenceCalls,idempotencyKey=`v1.${Date.now()}.${randomUUID()}`,input={...args({type:'viewport'}),idempotencyKey};
  const first=await call(`/tabs/${tabId}/analyse-image`,input);assert(first.pending);
  const duplicate=await call(`/tabs/${tabId}/analyse-image`,input);assert.equal(duplicate.operation.id,first.operation.id);
  await settled(first);assert.equal(inferenceCalls,before+1);
  const pending=await call(`/tabs/${tabId}/analyse-image`,args({type:'viewport'}));assert(pending.pending);
  await call(`/operations/${pending.operation.id}/cancel`,{});
  const cancelled=await settled(pending);assert.equal(cancelled.operation.state,'outcome_unknown',JSON.stringify(cancelled));
  assert.equal(supervisor.workers.get(session.id).humanControl,false);
 }
 console.log(JSON.stringify({ok:true,mode:real?'real-local':'mocked-media',sources:sources.length,inferenceCalls:real?sources.length:inferenceCalls,paidHostedCalls:0,observations}));
}finally{
 await supervisor.close();await Promise.all([server,fixture,frame,mock].map(s=>new Promise(r=>s.close(r))));
 if(retainState)console.error('Uncertain acceptance state retained at '+stateDir);else rmSync(stateDir,{recursive:true,force:true});
}
