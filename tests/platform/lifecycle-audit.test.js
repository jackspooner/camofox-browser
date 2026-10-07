import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import { Supervisor } from '../../lib/platform/supervisor.js';
import { installPlatformRoutes } from '../../lib/platform/routes.js';
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'camofox-lifecycle-audit-'));
  const supervisor = new Supervisor({stateDir:dir,idleMs:1800000},{});
  t.after(async()=>{await supervisor.close();rmSync(dir,{recursive:true,force:true});});
  const profile=supervisor.store.createProfile('Audit');
  const session=supervisor.store.createSession(profile.id,'Audit','alice');
  return {dir,supervisor,profile,session};
}
test('failed resume preparation releases the profile reservation',async t=>{
  const {dir,supervisor,profile,session}=setup(t);
  const path=join(dir,'profiles',profile.id);mkdirSync(path,{recursive:true});writeFileSync(join(path,'checkpoint.json'),'{truncated');
  await assert.rejects(supervisor.resume(session.id,'alice'),SyntaxError);
  assert.equal(supervisor.store.session(session.id).state,'suspended');
  assert.equal(supervisor.workers.size,0);
  const second=supervisor.store.createSession(profile.id,'Other','bob');
  assert.doesNotThrow(()=>supervisor.store.claim(second.id,'bob'));
});
test('failed VPN cleanup still finalizes suspension and invalidates observations',async t=>{
  const {dir,supervisor,profile,session}=setup(t);
  const child=new EventEmitter();child.exitCode=0;child.signalCode=null;child.kill=()=>true;
  supervisor.store.update(session.id,{state:'active'});
  supervisor.workers.set(session.id,{child,socket:join(dir,'test.sock'),busy:0,humanControl:false,route:{namespace:'fixture'}});
  supervisor.checkpoint=async()=>({});supervisor.vpn.disconnect=async()=>{throw Error('cleanup failed');};
  supervisor.observations.set('old',{sessionId:session.id});
  await assert.rejects(supervisor.suspend(session.id,'alice'),/cleanup failed/);
  assert.equal(supervisor.store.session(session.id).state,'suspended');
  assert.equal(supervisor.workers.size,0);assert.equal(supervisor.observations.size,0);
  const second=supervisor.store.createSession(profile.id,'Other','bob');
  assert.doesNotThrow(()=>supervisor.store.claim(second.id,'bob'));
});
test('REST validation covers trailing slash and case-insensitive Express routes before side effects',async t=>{
  const {supervisor,session}=setup(t);let calls=0;
  const openViewer=()=>{};openViewer.watch=async()=>{calls++;return {state:'opening'};};
  const app=express();app.use(express.json());installPlatformRoutes(app,supervisor,{},openViewer);
  app.use((e,_req,res,_next)=>res.status(e.statusCode||500).json({code:e.code}));
  const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  for(const path of [`/agent-sessions/${session.id}/watch`,`/agent-sessions/${session.id}/watch/`,`/AGENT-SESSIONS/${session.id}/WATCH`]){
    for(const open of [undefined,'false',0]){
      const r=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'alice',open})});
      assert.equal(r.status,400,path);assert.equal((await r.json()).code,'invalid_request');
    }
  }
  assert.equal(calls,0);
  for(const path of [`/agent-sessions/${session.id}/watch/`,`/AGENT-SESSIONS/${session.id}/WATCH`]) {
    const r=await fetch(`http://127.0.0.1:${server.address().port}`+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'alice',open:true})});
    assert.equal(r.status,200);
  }
  assert.equal(calls,2);
});
