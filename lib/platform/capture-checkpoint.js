// Private native-profile checkpoint is authoritative; the output manifest is a
// portable projection. OperationRegistry continues to own scheduling/cancellation.
import {existsSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,readFileSync,lstatSync,realpathSync,linkSync,unlinkSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {problem} from './store.js';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export function checkpointPath(profileDir,id){
  if(!uuid.test(id))throw problem('invalid_request','Invalid capture sequence ID',400);
  return join(profileDir,'capture-sequences',`${id}.json`);
}
function syncDirectory(dir){const fd=openSync(dir,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
function writeDurable(file,bytes,exclusive=false){
  const tmp=`${file}.${randomUUID()}.tmp`;
  try{
    const fd=openSync(tmp,'wx',0o600);
    try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
    if(exclusive)linkSync(tmp,file);else renameSync(tmp,file);
  }catch(e){
    if(e.code==='EEXIST')throw problem('capture_output_collision','Capture output already exists; nothing was overwritten');
    throw e;
  }finally{if(existsSync(tmp))unlinkSync(tmp);}

  syncDirectory(join(file,'..'));
}
export function outputDirectory(dir){
  if(!isAbsolute(dir))throw problem('invalid_request','outputDir must be an absolute service-host directory',400);
  mkdirSync(dir,{recursive:true,mode:0o700});
  if(!lstatSync(dir).isDirectory())throw problem('invalid_request','outputDir must be a directory, not a symlink',400);
  return realpathSync(dir);
}
export function readSequence(profileDir,id,sessionId){
  let m;
  try{m=JSON.parse(readFileSync(checkpointPath(profileDir,id),'utf8'));}
  catch(e){if(e.code==='ENOENT')throw problem('capture_not_found','Capture checkpoint not found; inspect the original operation',404);throw e;}
  if(m.schemaVersion!==1)throw problem('capture_resume_required','Unsupported capture checkpoint version; use its owning service version');
  if(m.sequenceId!==id||m.sessionId!==sessionId)throw problem('capture_not_found','Capture sequence does not belong to this session',404);
  return m;
}
export function saveSequence(profileDir,m,{initial=false}={}){
  m.updated=Date.now();
  const file=checkpointPath(profileDir,m.sequenceId);
  mkdirSync(join(file,'..'),{recursive:true,mode:0o700});
  writeDurable(file,JSON.stringify(m),initial);
  // Refuse replaced directories; do not silently follow a later output symlink.
  if(realpathSync(m.outputDir)!==m.outputDir||!lstatSync(m.outputDir).isDirectory())throw problem('capture_output_collision','Output directory changed; inspect saved assets');
  writeDurable(m.manifestPath,JSON.stringify(m,null,2)+'\n',initial);
}
export function saveAsset(file,bytes){writeDurable(file,bytes,true);}
export function verifyAsset(asset){
  try{return lstatSync(asset.path).isFile()&&!lstatSync(asset.path).isSymbolicLink()&&sha256(readFileSync(asset.path))===asset.sha256;}
  catch(e){if(e.code==='ENOENT')return false;throw e;}
}
export function sequenceSummary(m){
  const {options,...summary}=m;
  return {...summary,maxCaptures:options.maxCaptures,captured:m.assets.length,skipped:m.events.filter(e=>e.outcome==='skipped').length,failed:m.events.filter(e=>e.outcome==='failed').length};
}
