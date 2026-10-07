import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
const root=process.env.CAMOFOX_AGENT_STATE_DIR;
if(!root?.endsWith('camofox-watch-test'))throw Error('Isolated staging required');
const env=Object.fromEntries(readFileSync(root+'/service.env','utf8').trim().split('\n').map(l=>l.split(/=(.*)/s).slice(0,2)));
const s=JSON.parse(readFileSync(root+'/acceptance.json'));
async function call(path,body){const r=await fetch(`http://127.0.0.1:${env.CAMOFOX_PORT}`+path,{method:body?'POST':'GET',headers:{authorization:`Bearer ${env.CAMOFOX_ACCESS_KEY}`,'content-type':'application/json'},body:body?JSON.stringify({userId:s.owner,...body}):undefined});const j=await r.json();if(!r.ok)throw Error(JSON.stringify(j));return j;}
const path=`/agent-sessions/${s.sessionId}`;
const watch=()=>call(path+'/watch',{open:true});
const status=()=>call(path);
async function until(predicate){for(let i=0;i<200;i++){const value=await status();if(predicate(value))return value;await new Promise(r=>setTimeout(r,100));}throw Error('Lifecycle status timed out');}
await watch();await call(path+'/release',{});assert.equal((await status()).viewer.state,'closed');assert.equal((await status()).owner,null);
await call(path+'/resume',{});await watch();await call(path+'/suspend',{});assert.equal((await status()).viewer.state,'closed');
await call(path+'/resume',{});await watch();await call(path+'/route',{country:null});assert.equal((await status()).viewer.state,'closed');assert.equal((await status()).state,'active');
console.log('Watching permits release, suspension and routing restart; each closes the viewer');
await watch();const record=JSON.parse(readFileSync(`${root}/profiles/${s.profileId}/worker-process.json`));process.kill(record.pid,'SIGKILL');
assert.equal((await until(v=>v.state==='suspended')).viewer.state,'closed');
await call(path+'/resume',{});await watch();console.log('Worker crash revokes viewer; session and watch window can be reopened');
const db=new Database(root+'/sessions.sqlite');const age=Date.now()-31*60000;
// This session had human interaction earlier. Move its checkpoint activity forward
// only after starting a new worker, whose in-memory human timestamp starts at zero.
db.prepare('UPDATE sessions SET lastActivity=? WHERE id=?').run(age,s.sessionId);db.close();
assert.equal((await status()).lastActivity,age);
assert.equal((await until(v=>v.state==='suspended')).viewer.state,'closed');
console.log('Passive viewing and status polling do not prevent 30-minute idle suspension');
await call(path+'/watch',{open:false});
