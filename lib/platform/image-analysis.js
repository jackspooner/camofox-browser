import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {problem} from './store.js';

/** The gateway owns private staging; the worker never receives MediaTools credentials. */
export async function analyseImage(config,item,args,operation,signal,{onPhase=()=>{},connect}={}){
 const dir=join(config.stateDir,'screenshots');await mkdir(dir,{recursive:true,mode:0o700});
 const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[item.mimeType];
 const path=join(dir,`${operation.id}.${extension}`),receipt=join(dir,`${operation.id}.analysis.json`);
 let client,dispatched=false,settled=false;
 try{
  signal.throwIfAborted();
  await writeFile(path,item.bytes,{mode:0o600,flag:'wx'});
  if(connect)client=await connect();
  else{
   const token=(await readFile(config.mediaTokenFile,'utf8')).trim();
   client=new Client({name:'camofox-agent',version:'1.0.0'});
   await client.connect(new StreamableHTTPClientTransport(new URL(config.mediaUrl),{requestInit:{headers:{Authorization:`Bearer ${token}`}}}),{signal,timeout:Math.min(15000,Math.max(1,operation.deadline-Date.now()))});
  }
  signal.throwIfAborted();onPhase('inference');
  const{mode,...selection}=args.inference||{};
  const input={errorProfile:2,...(mode?{mode}:{}),request:{...selection,input:[{role:'user',content:[{type:'text',text:args.prompt},{type:'image_file',image_file:path}]}],...(args.output?{output:args.output}:{}),...(args.maxOutputTokens?{maxOutputTokens:args.maxOutputTokens}:{})}};
  // Write continuity evidence before the call; a lost reply never authorizes replay.
  await writeFile(receipt,JSON.stringify({operationId:operation.id,capture:item.provenance,state:'dispatching',created:Date.now()}),{mode:0o600,flag:'wx'});
  signal.throwIfAborted();dispatched=true;
  const response=await client.callTool({name:'text_infer',arguments:input},undefined,{timeout:Math.max(1,operation.deadline-Date.now()),signal});
  const data=response.structuredContent||JSON.parse(response.content.find(c=>c.type==='text').text);
  if(!data||typeof data!=='object')throw Error('Unusable inference response');
  if(!response.isError&&data.ok!==false&&!data.problem&&typeof data.text!=='string'&&!Object.hasOwn(data,'json'))throw Error('Missing inference output');
  const execution=data.problem?.execution;
  const unknown=data.error?.code==='ROUTER_TEXT_UNAVAILABLE'||execution?.submission==='unknown'||['unknown','running','queued'].includes(execution?.generation)||(response.isError&&!execution&&!(data.status>=400&&data.status<500));
  if(unknown){
   await writeFile(receipt,JSON.stringify({operationId:operation.id,capture:item.provenance,state:'outcome_unknown',upstream:{requestId:data.error?.requestId||data.requestId||data.problem?.requestId,diagnosticId:data.problem?.diagnosticId,ids:data.problem?.ids,owner:data.problem?.owner}}),{mode:0o600});
   return {ok:false,code:'operation_outcome_unknown',error:'Inference outcome is uncertain; inspect original MediaTools/RouterText evidence before retrying',image:item.provenance,inference:data};
  }
  settled=true;
  const failed=response.isError||data.ok===false||!!data.problem;
  return {ok:!failed,...(failed?{code:'image_analysis_failed',error:'MediaTools rejected or failed the image analysis'}:{}),image:item.provenance,inference:data};
 }catch(error){
  if(dispatched)return {ok:false,code:'operation_outcome_unknown',error:'Inference may still be running; preserve this operation and inspect MediaTools before retrying',image:item.provenance};
  if(signal.aborted)return {ok:false,code:'operation_cancelled',error:'Image analysis cancelled before inference dispatch',image:item.provenance};
  throw problem('image_analysis_failed','MediaTools image analysis could not be prepared',502);
 }finally{
  await client?.close().catch(()=>{});
  if(!dispatched||settled){await unlink(path).catch(()=>{});await unlink(receipt).catch(()=>{});}
 }
}
