import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { installViewer } from '../../lib/platform/viewer.js';
import { Supervisor } from '../../lib/platform/supervisor.js';
import { problem } from '../../lib/platform/store.js';
import { platformRequest } from '../../mcp/lib/platform-contracts.mjs';

async function harness(t) {
  const dir = mkdtempSync(join(tmpdir(), 'camofox-viewer-'));
  const modes = [], launches = [], desktops = [];
  const worker = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    if (req.url === '/internal/viewer-mode') modes.push(JSON.parse(body));
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ display: ':99', tabIds: ['tab'] }));
  });
  await new Promise(r => worker.listen(join(dir, 'worker.sock'), r));
  const w = { socket: join(dir, 'worker.sock'), busy: 0, viewer: null, humanControl: false };
  const session = { id: 's', profileId: 'p', name: 'Test', state: 'active', owner: 'a' };
  let checkpoints = 0;
  const supervisor = {
    workers: new Map([['s', w]]), locks: new Map(), observations: new Map(), config: { workerKey: 'key' },
    store: { checkOwner(id, owner) { if (id !== 's' || owner !== 'a') throw problem('session_owned', 'Wrong owner'); return session; }, profiles: () => [{ id: 'p', name: 'Profile' }], session: () => session },
    serial: Supervisor.prototype.serial, run: Supervisor.prototype.run, touch() {},
    async checkpoint() { checkpoints++; }, async suspendUnlocked() { supervisor.workers.delete('s'); },
  };
  const app = express(); app.use(express.json()); const server = createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const open = installViewer(app, server, supervisor, { port: server.address().port, stateDir: dir, novncDir: dir }, {
    async startViewer(_dir, _id, _display, mode) {
      const v = { child: new EventEmitter(), stop() { this.stopped = true; } }; launches.push({ v, mode }); return v;
    },
    async startDesktop(_config, url, _title, onClose) {
      const d = { url, onClose, present() { this.presented = true; }, close() { this.closed = true; } }; desktops.push(d); return d;
    },
  });
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ code: err.code }));
  const post = async (path, body, capability, requestOrigin = origin) => {
    const r = await fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: requestOrigin, authorization: 'Bearer ' + capability }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  t.after(async () => { await w.viewer?.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); await new Promise(r => worker.close(r)); rmSync(dir, { recursive: true, force: true }); });
  return { w, open, supervisor, launches, desktops, modes, post, checkpoints: () => checkpoints };
}

test('watch is idempotent, allows mutations, preserves control mode and isolates owners', async t => {
  const h = await harness(t);
  assert.deepEqual(await h.open.watch('s', 'a', true), { sessionId: 's', state: 'opening', mode: 'watch' });
  await h.supervisor.run('s', 'a', async () => 'allowed');
  await h.open.watch('s', 'a', true); assert.equal(h.desktops.length, 1); assert(h.desktops[0].presented);
  await assert.rejects(h.open.watch('s', 'b', false), { code: 'session_owned' });
  await assert.rejects(h.open('s', 'a'), { code: 'viewer_busy' });
  const token = h.desktops[0].url.split('#')[1];
  const { body } = await h.post('/viewer/connect', { ticket: token });
  assert.equal((await h.post('/viewer/connect', { ticket: token })).status, 403);
  assert.equal((await h.post('/viewer/control', { action: 'control' }, body.capability, 'http://evil.test')).status, 403);
  await h.post('/viewer/control', { action: 'control' }, body.capability);
  assert.equal(h.w.humanControl, true);
  assert.equal((await h.open.watch('s', 'a', true)).mode, 'control');
  await assert.rejects(h.supervisor.run('s', 'a', async () => {}), { code: 'human_control' });
  await h.open.watch('s', 'a', false);
  assert.equal(h.w.humanControl, false); assert(h.desktops[0].closed);
  assert(h.modes.some(m => m.invalidate));
  assert(h.w.requireFreshSnapshot.has('tab'));
  h.supervisor.proxy = Supervisor.prototype.proxy;
  await assert.rejects(h.supervisor.proxy('s', 'a', 'POST', '/tabs/tab/click', {ref:'e1'}), {code:'stale_observation'});
  await h.supervisor.proxy('s','a','GET','/tabs/tab/snapshot');
  await h.supervisor.proxy('s','a','POST','/tabs/tab/click',{ref:'e1'});
  assert.equal((await h.post('/viewer/control', { action: 'watch' }, body.capability)).status, 403);
  assert.equal((await h.open.watch('s', 'a', false)).state, 'closed');
});

test('takeover immediately blocks queued mutations and waits for the in-flight action', async t => {
  const h = await harness(t); await h.open.watch('s', 'a', true);
  const { body } = await h.post('/viewer/connect', { ticket: h.desktops[0].url.split('#')[1] });
  let release, entered;
  const started = new Promise(r => entered = r);
  const running = h.supervisor.run('s', 'a', async () => { entered(); await new Promise(r => release = r); });
  await started;
  const queued = h.supervisor.run('s', 'a', async () => assert.fail('Queued mutation ran'));
  const rejected = assert.rejects(queued, { code: 'human_control' });
  const takeover = h.post('/viewer/control', { action: 'control' }, body.capability);
  for (let i = 0; i < 100 && !h.w.humanControl; i++) await new Promise(r => setTimeout(r, 5));
  assert(h.w.humanControl); assert.equal(h.launches.length, 1);
  release(); await running; await rejected;
  assert.equal((await takeover).status, 200);
  h.supervisor.observations.set('old', { sessionId: 's' });
  assert.equal((await h.post('/viewer/control', { action: 'watch' }, body.capability)).status, 200);
  assert.equal(h.w.humanControl, false); assert.equal(h.supervisor.observations.size, 0);
  await h.supervisor.run('s', 'a', async () => {});
  assert.deepEqual(h.launches.map(v => v.mode), ['watch', 'control', 'watch']);
});

test('window exit and backend failure release control, allow reopening; legacy link conflicts', async t => {
  const h = await harness(t); await h.open.watch('s', 'a', true);
  h.desktops[0].onClose(); assert.equal(h.w.viewer, null);
  await h.open.watch('s', 'a', true);
  h.launches.at(-1).v.child.emit('exit'); assert.equal(h.w.viewer, null);
  const link = await h.open('s', 'a'); assert(link.humanControl);
  await assert.rejects(h.open.watch('s', 'a', true), { code: 'viewer_busy' });
  await assert.rejects(h.open.watch('s', 'a', false), { code: 'viewer_busy' });
  await h.w.viewer.close(); assert.equal(h.w.humanControl, false);
});

test('watch contract requires a boolean and describes idempotence', () => {
  for (const open of [undefined, 'true', 1, null]) assert.throws(() => platformRequest('camofox_session_watch', { sessionId: 's', open }, { userId: 'a' }));
  assert.deepEqual(platformRequest('camofox_session_watch', { sessionId: 's', open: false }, { userId: 'a' }).body, { userId: 'a', open: false });
});

test('expired viewer tickets and missing Origin are rejected', async t => {
  const h = await harness(t); await h.open.watch('s','a',true);
  const ticket=h.desktops[0].url.split('#')[1];
  assert.equal((await h.post('/viewer/connect',{ticket},undefined,'')).status,403);
  h.w.viewer.expires=Date.now()-1;
  assert.equal((await h.post('/viewer/connect',{ticket})).status,403);
});

test('desktop launch reports missing graphical session without spawning', async () => {
  const { startDesktop } = await import('../../lib/platform/viewer-launcher.js');
  await assert.rejects(startDesktop({desktopEnv:{}},'http://127.0.0.1/viewer','Test',()=>{}),{code:'desktop_unavailable',statusCode:503});
});

test('browser capture excludes empty desktop and retains displaced browser windows', async () => {
  const { browserRegion } = await import('../../lib/platform/viewer-launcher.js');
  const root = '  Width: 1920\n  Height: 1080\n';
  assert.equal(browserRegion('  0x20001 "Demo — Camoufox": ("Navigator" "camoufox")  1600x900+0+0  +0+0\n',root),'1600x900+0+0');
  assert.equal(browserRegion('  0x20001 "Demo": ("Navigator" "camoufox")  1000x700+100+50  +100+50\n',root),'1000x700+100+50');
  assert.equal(browserRegion('  0x20001 "Demo": ("Navigator" "camoufox")  1600x900+400+300  +400+300\n',root),'1520x780+400+300');
  assert.equal(browserRegion('  0x20001 "Other": ("other" "other")  1600x900+0+0  +0+0\n',root),null);
});

async function connectedWatch(h) {
  await h.open.watch('s', 'a', true);
  const { body } = await h.post('/viewer/connect', { ticket: h.desktops.at(-1).url.split('#')[1] });
  h.w.viewer.state = 'connected'; // The unit launcher has no framebuffer; live acceptance covers its connection.
  return body.capability;
}

test('agent offers and requests control with explicit viewer acceptance, checkpointing and fresh refs', async t => {
  const h = await harness(t), cap = await connectedWatch(h);
  const offer = h.open.control('s', 'a', 'give');
  assert.equal(h.w.humanControl, false);
  await h.supervisor.run('s', 'a', async () => {});
  const pending = (await h.post('/viewer/handoff', { action: 'status' }, cap)).body.pending;
  assert.equal(pending.action, 'give'); assert(pending.remainingMs > 14000 && pending.remainingMs <= 15000);
  await assert.rejects(h.open.control('s', 'a', 'give'), { code: 'viewer_busy' });
  assert.equal((await h.post('/viewer/handoff', { action: 'respond', requestId: pending.requestId, accept: true }, cap, 'http://evil.test')).status, 403);
  assert.equal((await h.post('/viewer/handoff', { action: 'respond', requestId: 'different', accept: true }, cap)).status, 409);
  assert.equal((await h.post('/viewer/handoff', { action: 'respond', requestId: pending.requestId, accept: true }, cap)).status, 200);
  assert.equal((await offer).outcome, 'accepted'); assert.equal(h.w.humanControl, true);
  assert.equal((await h.post('/viewer/handoff', { action: 'respond', requestId: pending.requestId, accept: true }, cap)).status, 409);
  h.w.viewer.state = 'connected';
  assert.equal((await h.open.control('s', 'a', 'give')).outcome, 'already_in_mode');
  const request = h.open.control('s', 'a', 'request');
  await assert.rejects(h.supervisor.run('s', 'a', async () => {}), { code: 'human_control' });
  h.supervisor.observations.set('old', { sessionId: 's' });
  const back = (await h.post('/viewer/handoff', { action: 'status' }, cap)).body.pending;
  await h.post('/viewer/handoff', { action: 'respond', requestId: back.requestId, accept: true }, cap);
  const result = await request;
  assert.equal(result.outcome, 'accepted'); assert.equal(result.mode, 'watch');
  assert.equal(h.w.humanControl, false); assert(h.checkpoints() > 0);
  assert.equal(h.supervisor.observations.size, 0); assert(h.w.requireFreshSnapshot.has('tab'));
});

test('accepting an offer reserves control immediately but lets the active operation finish', async t => {
  const h = await harness(t), cap = await connectedWatch(h);
  let release, entered;
  const started = new Promise(r => entered = r);
  const work = h.supervisor.run('s','a',async () => { entered(); await new Promise(r => release = r); });
  await started;
  const offer = h.open.control('s','a','give');
  const id = h.w.viewer.handoff.id;
  const accepted = h.post('/viewer/handoff', { action:'respond', requestId:id, accept:true },cap);
  for(let i=0;i<100&&!h.w.humanControl;i++) await new Promise(r=>setTimeout(r,5));
  assert(h.w.humanControl); assert.equal(h.w.viewer.handoff.phase,'switching');
  assert.equal(h.launches.length,1);
  const blocked = assert.rejects(h.supervisor.run('s','a',async()=>assert.fail('mutation ran')), {code:'human_control'});
  release(); await work; await blocked; assert.equal((await accepted).status,200);
  assert.equal((await offer).outcome,'accepted');
});

test('declining in either direction preserves control; closing cancels the pending request', async t => {
  const h = await harness(t), cap = await connectedWatch(h);
  for(const action of ['give','request']) {
    if(action==='request') { await h.post('/viewer/control',{action:'control'},cap); h.w.viewer.state='connected'; }
    const before=h.w.humanControl;
    const result=h.open.control('s','a',action), requestId=h.w.viewer.handoff.id;
    await h.post('/viewer/handoff',{action:'respond',requestId,accept:false},cap);
    assert.equal((await result).outcome,'declined'); assert.equal(h.w.humanControl,before);
  }
  const result=h.open.control('s','a','request');
  await h.open.watch('s','a',false);
  assert.equal((await result).outcome,'cancelled'); assert.equal(h.w.humanControl,false);
});

test('15-second server deadline times out both directions without changing control or accepting late input', async t => {
  const h = await harness(t), cap = await connectedWatch(h);
  for(const action of ['give','request']) {
    if(action==='request') { await h.post('/viewer/control',{action:'control'},cap); h.w.viewer.state='connected'; }
    const before=h.w.humanControl, start=Date.now();
    const response=h.open.control('s','a',action), requestId=h.w.viewer.handoff.id;
    const result=await response;
    assert.equal(result.outcome,'timed_out'); assert(Date.now()-start>=14900);
    assert.equal(h.w.humanControl,before); assert.equal(h.w.viewer.handoff,null);
    assert.equal((await h.post('/viewer/handoff',{action:'respond',requestId,accept:true},cap)).status,409);
  }
});

test('handoffs require ownership and connected viewer; manual mode change cancels and stale deadlines are enforced', async t => {
  const h = await harness(t);
  await assert.rejects(h.open.control('s','b','give'),{code:'session_owned'});
  await assert.rejects(h.open.control('s','a','give'),{code:'viewer_not_connected'});
  await h.open.watch('s','a',true);
  await assert.rejects(h.open.control('s','a','give'),{code:'viewer_not_connected'});
  const {body}=await h.post('/viewer/connect',{ticket:h.desktops[0].url.split('#')[1]});
  h.w.viewer.state='connected';
  const expired=h.open.control('s','a','give');
  const id=h.w.viewer.handoff.id; h.w.viewer.handoff.deadline=Date.now()-1;
  assert.equal((await h.post('/viewer/handoff',{action:'respond',requestId:id,accept:true},body.capability)).status,409);
  assert.equal((await expired).outcome,'timed_out'); assert.equal(h.w.humanControl,false);
  const cancelled=h.open.control('s','a','give');
  await h.post('/viewer/control',{action:'control'},body.capability);
  assert.equal((await cancelled).outcome,'cancelled');
  for(const action of ['control','watch',true,null]) assert.throws(()=>platformRequest('camofox_session_control',{sessionId:'s',action},{userId:'a'}));
});
