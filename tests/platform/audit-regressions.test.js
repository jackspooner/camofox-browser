import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { Supervisor } from '../../lib/platform/supervisor.js';
import { workerRequest } from '../../lib/platform/worker-launcher.js';
import { installPlatformRoutes } from '../../lib/platform/routes.js';
import { locate } from '../../lib/platform/media.js';

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'camofox-regression-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
async function listen(t, handler, address) {
  const server = createServer(handler);
  await new Promise(resolve => address ? server.listen(address, resolve) : server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  return server;
}
test('truncated worker response rejects promptly and releases the session queue', { timeout: 3000 }, async t => {
  const socket = join(temporary(t), 'worker.sock');
  await listen(t, (_req, res) => {
    res.writeHead(200, { 'Content-Length': '100' });
    res.write('{"tabs":');
    setTimeout(() => res.destroy(), 20);
  }, socket);
  const holder = { locks: new Map(), serial: Supervisor.prototype.serial };
  const request = holder.serial('session', () => workerRequest(socket, 'test', 'GET', '/internal/checkpoint'));
  const queued = holder.serial('session', async () => 'next operation');
  await assert.rejects(request, /aborted|closed|reset/i);
  assert.equal(await queued, 'next operation');
  assert.equal(holder.locks.size, 0);
});
test('complete worker responses still resolve', async t => {
  const socket = join(temporary(t), 'worker.sock');
  await listen(t, (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); }, socket);
  const r = await workerRequest(socket, 'test', 'GET', '/internal/checkpoint');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.bytes), { ok: true });
});
test('gateway collection routes use session ownership without interpreting reserved names as tabs', async t => {
  const supervisor = new Supervisor({ stateDir: temporary(t), idleMs: 1800000 }, {});
  t.after(() => supervisor.close());
  const profile = supervisor.store.createProfile('Regression');
  const session = supervisor.store.createSession(profile.id, 'Regression', 'alice');
  supervisor.store.update(session.id, { checkpoint: { tabs: [{ id: 'real-tab' }] } });
  supervisor.defaultSession = async owner => { assert.equal(owner, 'alice'); return session.id; };
  supervisor.proxy = async (id, owner, method, path) => ({ status: 200, type: 'application/json', bytes: Buffer.from(JSON.stringify({ id, owner, method, path })) });
  const app = express(); app.use(express.json());
  installPlatformRoutes(app, supervisor, {}, () => {});
  app.use((e, _req, res, _next) => res.status(e.statusCode || 500).json({ code: e.code }));
  const server = await listen(t, app);
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const explicit of [true, false]) {
    for (const [method, path] of [['POST', '/tabs/open'], ['DELETE', '/tabs/group/default'], ['DELETE', '/tabs/group/default/']]) {
      const query = new URLSearchParams({ userId: 'alice', ...(explicit ? { sessionId: session.id } : {}) });
      const r = await fetch(`${base}${path}?${query}`, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify({ userId: 'alice', url: 'https://example.test', ...(explicit ? { sessionId: session.id } : {}) }) } : {}) });
      assert.equal(r.status, 200, `${method} ${path}`);
      assert.equal((await r.json()).id, session.id);
    }
  }
  const tab = await fetch(`${base}/tabs/real-tab/snapshot?userId=alice`);
  assert.equal(tab.status, 200);
  const missing = await fetch(`${base}/tabs/missing/snapshot?userId=alice`);
  assert.equal(missing.status, 404);
  const conflict = await fetch(`${base}/tabs/group/default?userId=bob&sessionId=${session.id}`, { method: 'DELETE' });
  assert.equal(conflict.status, 409);
});
test('LocateAnything removes captures when credentials cannot be loaded', async t => {
  const stateDir = temporary(t);
  const invalidToken = join(stateDir, 'directory-token');
  // A directory is unreadable as a token file even when tests run as root.
  const { mkdirSync } = await import('node:fs'); mkdirSync(invalidToken);
  for (const mediaTokenFile of [join(stateDir, 'missing'), invalidToken]) {
    await assert.rejects(locate({ stateDir, mediaTokenFile }, { png: Buffer.from('fixture').toString('base64') }, 'button'));
    assert.deepEqual(readdirSync(join(stateDir, 'screenshots')), []);
  }
});
