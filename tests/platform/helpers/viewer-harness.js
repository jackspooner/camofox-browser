import express from 'express';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { installViewer } from '../../../lib/platform/viewer.js';
import { Supervisor } from '../../../lib/platform/supervisor.js';
import { problem } from '../../../lib/platform/store.js';

export async function harness(t, hooks = {}) {
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
    async cancelSessionOperations(){}, resumeAutomation(){session.automationPaused=false;}, async pauseAutomation(){session.automationPaused=true;}, viewerOperations(){return {automationPaused:!!session.automationPaused,operations:[]};},
    async submitOperation(id,owner,policy,args,key,dispatch){return this.run(id,owner,w=>{policy.validate?.(w);return dispatch(w);});},
    serial: Supervisor.prototype.serial, run: Supervisor.prototype.run, touch() {},
    async checkpoint() { checkpoints++; }, async suspendUnlocked() { supervisor.workers.delete('s'); },
  };
  const app = express(); app.use(express.json()); const server = createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const open = installViewer(app, server, supervisor, { port: server.address().port, stateDir: dir, novncDir: dir }, {
    async startViewer(_dir, _id, _display, mode, options) {
      const v = { socket: hooks.socket, child: new EventEmitter(), async stop() { await hooks.stop?.(); this.stopped = true; } };
      launches.push({ v, mode, options });
      await hooks.start?.(options);
      return v;
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
  return { origin, w, open, supervisor, launches, desktops, modes, post, checkpoints: () => checkpoints };
}

