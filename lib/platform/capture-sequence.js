import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import sharp from 'sharp';
import {coordinateClick} from '../coordinate-click.js';
import {captureOptions} from '../../mcp/lib/capture-contracts.mjs';
import {problem} from './store.js';
import {outputDirectory,readSequence,saveSequence,saveAsset,verifyAsset,sequenceSummary,sha256} from './capture-checkpoint.js';

const scope = (page,frameSelector) => frameSelector ? page.frameLocator(frameSelector) : page;
async function single(page,selector,frameSelector){
  const locator=scope(page,frameSelector).locator(selector);
  const n=await locator.count();
  if(n>1)throw problem('ambiguous_target','Capture sequence selector matches multiple elements; choose one explicit target');
  return n===1 ? locator : null;
}
export function createCaptureObserver(page,geometry){
  return {
    async sample(options,signal){
      signal.throwIfAborted();
      if(options.readySelector){const ready=await single(page,options.readySelector,options.frameSelector);if(!ready||!await ready.isVisible())return null;}
      if(await page.evaluate(()=>document.readyState==='loading'))return null;
      const before=await geometry(page);
      let clip=options.capture?.clip,captureTarget;
      if(options.capture?.selector){
        const target=captureTarget=await single(page,options.capture.selector,options.capture.frameSelector);
        if(!target||!await target.isVisible())return null;
        clip=await target.boundingBox({timeout:1000});
        if(!clip)return null;
      }
      clip ||= {x:0,y:0,width:before.width,height:before.height};
      if(clip.x<0||clip.y<0||clip.width<=0||clip.height<=0||clip.x+clip.width>before.width||clip.y+clip.height>before.height)throw problem('invalid_request','Capture region must fit entirely inside the visible viewport',400);
      // Capture the viewport, then convert CSS geometry to actual raster pixels.
      // Playwright page clips otherwise use document coordinates after scrolling.
      const viewport=await page.screenshot({fullPage:false,animations:'disabled',timeout:2000});
      signal.throwIfAborted();
      const after=await geometry(page);
      if(JSON.stringify(before)!==JSON.stringify(after))return null;
      if(captureTarget&&JSON.stringify(await captureTarget.boundingBox({timeout:1000}))!==JSON.stringify(clip))return null;
      const meta=await sharp(viewport).metadata();
      const left=Math.floor(clip.x*meta.width/before.width),top=Math.floor(clip.y*meta.height/before.height);
      const width=Math.ceil((clip.x+clip.width)*meta.width/before.width)-left,height=Math.ceil((clip.y+clip.height)*meta.height/before.height)-top;
      const png=await sharp(viewport).extract({left,top,width,height}).png().toBuffer();
      let position=null;
      if(options.positionSelector){const p=await single(page,options.positionSelector,options.frameSelector);if(p)position=(await p.textContent({timeout:1000})||'').trim().slice(0,1024);}
      return {png,sha256:sha256(png),width,height,position,url:after.url,geometry:{...after,clip,raster:{left,top,width,height},viewportRaster:{width:meta.width,height:meta.height}}};
    },
    async nextState(options){
      if(options.endSelector){const end=await single(page,options.endSelector,options.frameSelector);if(end&&await end.isVisible())return 'end_marker';}
      if(options.next.coordinates)return null;
      const next=await single(page,options.next.selector,options.next.frameSelector);
      if(!next||!await next.isVisible())return 'next_missing';
      if(!await next.isEnabled()||await next.getAttribute('aria-disabled')==='true')return 'next_disabled';
      return null;
    },
    async advance(options,signal){
      signal.throwIfAborted();
      if(options.next.coordinates)await coordinateClick(page,options.next.coordinates);
      else {
        const next=await single(page,options.next.selector,options.next.frameSelector);
        if(!next)throw problem('target_changed','Next target disappeared before dispatch');
        // One native click only. A timeout may occur after dispatch; never force,
        // fall back to DOM events, or repeat an uncertain mutation here.
        await next.click({timeout:2000});
      }
      signal.throwIfAborted();
    },
  };
}

async function stableSample(observer,options,signal,previous){
  const until=Date.now()+options.changeTimeoutMs;
  let candidate=null,since=0;
  while(Date.now()<until){
    signal.throwIfAborted();
    const sample=await observer.sample(options,signal);
    if(sample&&sample.sha256!==previous){
      const identity=JSON.stringify([sample.sha256,sample.geometry,sample.position]);
      if(candidate?.identity!==identity){candidate={...sample,identity};since=Date.now();}
      else if(Date.now()-since>=options.stableMs)return sample;
    }else{candidate=null;since=0;}
    await delay(150,undefined,{signal});
  }
  return null;
}

export async function runCaptureSequence({profileDir,sessionId,tabId,sequenceId,operationId,options,resume=false,observer,signal,onProgress=()=>{}}){
  let m;
  const persist=()=>saveSequence(profileDir,m);
  const event=(outcome,reason)=>{m.events.push({at:Date.now(),phase:m.phase,outcome,reason});};
  const stop=(reason,outcome='stopped')=>{m.state='stopped';m.reason=reason;event(outcome,reason);persist();return sequenceSummary(m);};
  if(resume){
    m=readSequence(profileDir,sequenceId,sessionId);
    if(m.tabId!==tabId)throw problem('invalid_request','Resume requires the original logical tab',400);
    if(m.events.length>=256)throw problem('capture_resume_required','Sequence recovery limit reached; inspect the manifest and start a new sequence');
    if(m.state==='stopped'&&!['resume_ambiguous','resume_mismatch','no_page_change','not_ready'].includes(m.reason))return sequenceSummary(m);
    for(const asset of m.assets)if(!verifyAsset(asset))throw problem('capture_output_collision','Saved capture is missing or changed; restore it before resuming');
    m.operationId=operationId;m.state='running';m.reason=null;
    // A crash between PNG publication and checkpoint commit is reconciled by
    // its recorded digest. No browser mutation occurs during reconciliation.
    if(m.phase==='saving'){
      const pending=m.checkpoint.pending;
      if(existsSync(pending.path)){
        if(!verifyAsset(pending))throw problem('capture_output_collision','Pending capture differs from the checkpoint');
        m.assets.push(pending);m.checkpoint={last:pending};m.phase='captured';
        event('recovered','published_capture');
      }else m.phase='capturing';
    }
    persist();
  }else{
    options=captureOptions(options);
    const outputDir=outputDirectory(options.outputDir);
    m={schemaVersion:1,sequenceId,sessionId,tabId,operationId,options:{...options,outputDir},outputDir,manifestPath:join(outputDir,`${sequenceId}.manifest.json`),state:'running',phase:'capturing',reason:null,updated:Date.now(),assets:[],events:[],checkpoint:{}};
    saveSequence(profileDir,m,{initial:true});
  }
  options=m.options;
  const progress=()=>onProgress({completed:m.assets.length,total:options.maxCaptures});
  try{
    progress();
    let sample;
    if(resume&&m.checkpoint.pending){
      sample=await stableSample(observer,options,signal);
      if(!sample)return stop('not_ready');
      if(sample.sha256!==m.checkpoint.pending.sha256)return stop('resume_mismatch');
    }else if(resume&&m.checkpoint.last){
      sample=await stableSample(observer,options,signal);
      if(!sample)return stop('not_ready');
      if(['advancing','awaiting_change'].includes(m.phase)){
        if(sample.sha256===m.checkpoint.last.sha256)return stop('resume_ambiguous');
        event('recovered','observed_changed_page_without_replaying_advance');m.phase='capturing';persist();
      }else if(sample.sha256!==m.checkpoint.last.sha256)return stop('resume_mismatch');
      else sample=null;
    }
    while(m.assets.length<options.maxCaptures){
      signal.throwIfAborted();
      if(m.phase!=='captured'){
        sample ||= await stableSample(observer,options,signal,m.phase==='awaiting_change'?m.checkpoint.last?.sha256:undefined);
        if(!sample)return stop(m.phase==='awaiting_change'?'no_page_change':'not_ready',m.phase==='awaiting_change'?'skipped':'stopped');
        if(m.assets.some(a=>a.sha256===sample.sha256))return stop('repeated_page','skipped');
        const {png,...metadata}=sample;
        const asset={index:m.assets.length+1,path:join(m.outputDir,`${sequenceId}-${String(m.assets.length+1).padStart(4,'0')}.png`),...metadata,capturedAt:Date.now()};
        m.phase='saving';m.checkpoint.pending=asset;persist();
        signal.throwIfAborted();
        saveAsset(asset.path,png);
        m.assets.push(asset);m.checkpoint={last:asset};m.phase='captured';persist();progress();sample=null;
      }
      if(m.assets.length>=options.maxCaptures)return stop('max_captures');
      signal.throwIfAborted();
      const end=await observer.nextState(options);
      if(end)return stop(end);
      // Write-ahead checkpoint precedes native input, including any attempt
      // whose result could be lost. Resume cannot replay this phase unchanged.
      m.phase='advancing';persist();
      signal.throwIfAborted();
      try{await observer.advance(options,signal);signal.throwIfAborted();}
      catch(e){if(signal.aborted)throw e;throw problem('operation_outcome_unknown','Advance outcome is uncertain; inspect session and capture checkpoint before explicit resume');}
      m.phase='awaiting_change';persist();
    }
    return stop('max_captures');
  }catch(error){
    m.state=signal.aborted?'interrupted':'failed';m.reason=signal.aborted?'operation_cancelled':error.code||'worker_error';
    event(signal.aborted?'stopped':'failed',m.reason);
    // Preserve the last durable phase even when the destination has become
    // unwritable. A persistence error must not mask an uncertain native action.
    try{persist();}catch(persistError){error.checkpointError=persistError.code||'write_failed';}
    throw error;
  }
}
