// Uses disposable state and the installed browser cache. No production session access.
// node tests/platform/audit-live.mjs /path/to/browser/cache
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { workerJson } from '../../lib/platform/worker-launcher.js';
import { Supervisor } from '../../lib/platform/supervisor.js';
import express from 'express';
import { installPlatformRoutes } from '../../lib/platform/routes.js';
import { loadPlatformConfig } from '../../lib/config.js';
assert.ok(process.argv[2], 'Pass an installed browser cache');
const stateDir = mkdtempSync(join(tmpdir(), 'camofox-audit-live-'));
symlinkSync(resolve(process.argv[2]), join(stateDir, 'cache'));
const fixture = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><title>Audit ${req.url.slice(1)}</title><h1>Page</h1><button>Click</button>`);
});
await new Promise(r => fixture.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${fixture.address().port}`;
const supervisor = new Supervisor({ ...loadPlatformConfig(), stateDir }, {});
const profile = supervisor.store.createProfile('Isolated audit regressions');
const session = supervisor.store.createSession(profile.id, 'Audit', 'audit');
const app = express(); app.use(express.json());
installPlatformRoutes(app, supervisor, supervisor.config, () => {});
app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));
const gateway = createServer(app);
await new Promise(r => gateway.listen(0, '127.0.0.1', r));
const gatewayUrl = `http://127.0.0.1:${gateway.address().port}`;
async function call(path, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(gatewayUrl + path + (path.includes('?') ? '&' : '?') + 'userId=audit&sessionId=' + session.id, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify({ ...body, userId: 'audit', sessionId: session.id }) } : {}),
  });
  assert.ok(r.ok, await (r.ok ? Promise.resolve('') : r.text()));
  return r.headers.get('content-type')?.startsWith('image/') ? Buffer.from(await r.arrayBuffer()) : r.json();
}
const internal = (path, body) => workerJson(supervisor.workers.get(session.id).socket, supervisor.config.workerKey, body ? 'POST' : 'GET', path, body);
try {
  await supervisor.resume(session.id, 'audit');
  const a = await call('/tabs', { url: base + '/A', sessionKey: 'default' });
  const b = await call('/tabs', { url: base + '/B', sessionKey: 'default' });
  const { display } = await internal('/internal/display');
  const front = () => execFileSync('/usr/bin/xwininfo', ['-display', display, '-root', '-tree'], { encoding: 'utf8' }).split('\n').find(l => l.includes('Navigator'));
  const shows = async title => { await delay(150); assert.ok(front().includes('Audit ' + title), front()); };
  await shows('B');
  await call(`/tabs/${a.tabId}/snapshot`); await shows('A');
  await call(`/tabs/${b.tabId}/screenshot`); await shows('B');
  await call(`/tabs/${a.tabId}/snapshot?offset=1`); await shows('A');
  // Check the worker's human-control guard directly, without opening a viewer.
  await internal('/internal/viewer-mode', { humanControl: true });
  await call(`/tabs/${b.tabId}/snapshot`); await shows('A');
  await call(`/tabs/${b.tabId}/screenshot`); await shows('A');
  await internal('/internal/viewer-mode', { humanControl: false });
  console.log('PASS snapshot, cached snapshot and screenshot follow; human focus is preserved');
  await call(`/tabs/${a.tabId}/evaluate`, { expression: "sessionStorage.setItem('large','x'.repeat(200000));true" });
  await supervisor.suspend(session.id, 'audit');
  assert.ok(JSON.stringify(supervisor.store.session(session.id).checkpoint).length > 200000);
  await supervisor.resume(session.id, 'audit');
  const restored = await call(`/tabs/${a.tabId}/evaluate`, { expression: "sessionStorage.getItem('large').length" });
  assert.equal(restored.result, 200000);
  const env = JSON.parse(readFileSync(join(stateDir, 'profiles', profile.id, 'worker-env.json'), 'utf8'));
  assert.equal(env.CAMOFOX_WORKER_CHECKPOINT, undefined);
  assert.ok(env.CAMOFOX_WORKER_CHECKPOINT_FILE);
  console.log('PASS >200 KB checkpoint resumes and restores sessionStorage without environment payload');
  await call('/tabs/open', { url: base + '/Alias', listItemId: 'alias-group' });
  assert.ok(supervisor.store.session(session.id).checkpoint.tabs.some(t => t.url === base + '/Alias'));
  await call('/tabs/group/alias-group', undefined, 'DELETE');
  assert.ok(!supervisor.store.session(session.id).checkpoint.tabs.some(t => t.url === base + '/Alias'));
  console.log('PASS gateway legacy open and group close dispatch to a real worker');
} finally {
  gateway.closeAllConnections(); await new Promise(r => gateway.close(r));
  await supervisor.close();
  fixture.closeAllConnections(); await new Promise(r => fixture.close(r));
  rmSync(stateDir, { recursive: true, force: true });
}
