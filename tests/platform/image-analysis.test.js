import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import sharp from 'sharp';
import {ImageCaptures} from '../../lib/platform/image-captures.js';
import {analyseImage} from '../../lib/platform/image-analysis.js';
import {acquireImage,readImageBody} from '../../lib/platform/image-source.js';
import {platformRequest} from '../../mcp/lib/platform-contracts.mjs';
import {adaptResponse} from '../../mcp/lib/tool-contracts.mjs';

const png=()=>sharp({create:{width:80,height:60,channels:3,background:'red'}}).png().toBuffer();
test('capture storage owns immutable pixels, enforces identity, expiry, pins and byte/count bounds',async()=>{
 let now=0;const bytes=await png(),store=new ImageCaptures({now:()=>now,ttlMs:100,maxCount:1,maxBytes:10000});
 const item=await store.add('session','tab',bytes,'viewport'),original=Buffer.from(bytes);bytes.fill(0);
 assert.deepEqual(item.bytes,original);
 assert.throws(()=>store.pin(item.provenance.captureId,'other','tab'),{code:'capture_not_found'});
 store.pin(item.provenance.captureId,'session','tab');
 await assert.rejects(store.add('session','tab',original,'viewport'),{code:'operation_limit'});
 now=101;store.prune();assert.equal(store.items.size,1);store.release(item);assert.equal(store.items.size,0);
 assert.throws(()=>store.pin(item.provenance.captureId,'session','tab'),{code:'capture_not_found'});
 await assert.rejects(store.add('session','tab',Buffer.from('bad'),'original'),{code:'invalid_request'});
});
async function fixture(t){
 const stateDir=await mkdtemp(join(tmpdir(),'camofox-analysis-'));t.after(()=>rm(stateDir,{recursive:true,force:true}));
 const item=await new ImageCaptures().add('session','tab',await png(),'viewport');
 return {stateDir,item,operation:{id:'operation-fixture',deadline:Date.now()+10000}};
}
test('one MediaTools call attaches the private file, forwards selection/JSON and removes settled staging',async t=>{
 const f=await fixture(t);let calls=0;
 const data={text:'red',json:{colour:'red'},selection:{mode:'quick',provider:'local'},accounting:{complete:true},structuredOutput:{validated:true}};
 const result=await analyseImage(f,f.item,{prompt:'Read this',output:{type:'json_object'},maxOutputTokens:32},f.operation,new AbortController().signal,{connect:async()=>({close:async()=>{},callTool:async request=>{
  calls++;assert.equal(request.name,'text_infer');assert.equal(request.arguments.request.maxOutputTokens,32);assert.deepEqual(request.arguments.request.output,{type:'json_object'});
  const path=request.arguments.request.input[0].content[1].image_file;assert.deepEqual(await readFile(path),f.item.bytes);
  return {structuredContent:data};
 }})});
 assert.equal(calls,1);assert.deepEqual(result.inference,data);assert.deepEqual(await readdir(join(f.stateDir,'screenshots')),[]);assert(!JSON.stringify(result).includes(f.stateDir));
});
test('uncertain inference preserves staging and original operation without replay',async t=>{
 const f=await fixture(t);let calls=0;
 const result=await analyseImage(f,f.item,{prompt:'Read'},f.operation,new AbortController().signal,{connect:async()=>({close:async()=>{},callTool:async()=>{calls++;throw Error('transport lost');}})});
 assert.equal(result.code,'operation_outcome_unknown');assert.equal(calls,1);assert.equal((await readdir(join(f.stateDir,'screenshots'))).length,2);assert(!JSON.stringify(result).includes(f.stateDir));
});
test('structured owner rejection remains a failure with its original identity and settled staging cleanup',async t=>{
 const f=await fixture(t),data={ok:false,status:400,error:{code:'invalid_request',requestId:'original-request'},problem:{execution:{submission:'not_submitted',generation:'not_started'}}};
 const r=await analyseImage(f,f.item,{prompt:'Read'},f.operation,new AbortController().signal,{connect:async()=>({close:async()=>{},callTool:async()=>({isError:true,structuredContent:data})})});
 assert.equal(r.ok,false);assert.deepEqual(r.inference,data);assert.equal(r.code,'image_analysis_failed');assert.deepEqual(await readdir(join(f.stateDir,'screenshots')),[]);
});
test('uncertain owner response persists safe upstream recovery IDs',async t=>{
 const f=await fixture(t),data={ok:false,status:502,error:{requestId:'upstream-request'},problem:{requestId:'facade-request',diagnosticId:'diagnostic',execution:{submission:'accepted',generation:'unknown'}}};
 const result=await analyseImage(f,f.item,{prompt:'Read'},f.operation,new AbortController().signal,{connect:async()=>({close:async()=>{},callTool:async()=>({isError:true,structuredContent:data})})});
 assert.equal(result.code,'operation_outcome_unknown');
 const receipt=JSON.parse(await readFile(join(f.stateDir,'screenshots',`${f.operation.id}.analysis.json`),'utf8'));
 assert.equal(receipt.upstream.requestId,'upstream-request');assert.equal(receipt.upstream.diagnosticId,'diagnostic');
});
test('cancellation before dispatch does not call inference',async t=>{
 const f=await fixture(t),controller=new AbortController();controller.abort();let connected=false;
 const r=await analyseImage(f,f.item,{prompt:'Read'},f.operation,controller.signal,{connect:async()=>{connected=true;}});
 assert.equal(r.code,'operation_cancelled');assert.equal(connected,false);
});
test('viewport CSS regions map to actual raster pixels and changed geometry is rejected',async()=>{
 const bytes=await png(),g={url:'http://fixture/',width:40,height:30};
 const page={screenshot:async()=>bytes};
 const result=await acquireImage({page,source:{type:'region',clip:{x:5,y:5,width:10,height:10}},geometry:async()=>g});
 const m=await sharp(result.bytes).metadata();assert.equal(m.width,20);assert.equal(m.height,20);
 let n=0;await assert.rejects(acquireImage({page,source:{type:'viewport'},geometry:async()=>({...g,x:n++})}),{code:'target_changed'});
});
test('original HTTP images use scoped session cookies and verified element identity',async t=>{
 const bytes=await png();let requests=0;
 const server=createServer((req,res)=>{requests++;assert.equal(req.headers.cookie,'login=fixture');res.setHeader('Content-Type','image/png');res.end(bytes);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}/image`,handle={evaluate:async(fn,arg)=>arg?true:url,dispose:async()=>{}};
 const locator={count:async()=>1,elementHandle:async()=>handle};
 const page={url:()=> 'http://fixture/',locator:()=>locator,context:()=>({cookies:async u=>{assert.equal(u,url);return[{name:'login',value:'fixture'}];}})};
 const options={page,source:{type:'original',selector:'img'},geometry:async()=>({url:page.url()}),validateUrl:()=>null};
 assert.deepEqual((await acquireImage(options)).bytes,bytes);assert.equal(requests,1);
 await assert.rejects(acquireImage({...options,source:{...options.source,url:url+'/different',screenshotFallback:true}}),{code:'invalid_target'});assert.equal(requests,1);
});
test('bounded source reads and public source selectors reject invalid inputs',async()=>{
 await assert.rejects(readImageBody(new Response('x',{headers:{'content-length':'25000001'}}),new AbortController().signal),{code:'invalid_target'});
 assert(platformRequest('camofox_analyse_image',{tabId:'t',prompt:'Read'},{userId:'a'}));
 for(const source of [{type:'element',ref:'e1',selector:'img'},{type:'capture'},{type:'region',clip:{x:0,y:0,width:0,height:1}},{type:'viewport',url:'http://example.com'}])assert.throws(()=>platformRequest('camofox_analyse_image',{tabId:'t',prompt:'Read',source},{userId:'a'}));
 const blocks=adaptResponse({responseKind:'image'},{type:'image',data:'image-bytes',mimeType:'image/png',capture:{captureId:'id'}});
 assert.equal(blocks.length,2);assert.equal(blocks[1].type,'image');assert.equal(JSON.parse(blocks[0].text).capture.captureId,'id');assert(!('capture'in blocks[1]));
});
