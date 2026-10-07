// Uses disposable state and the installed browser cache. No production session access.
// node tests/platform/checkpoint-live.mjs /path/to/browser/cache
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
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
  await call('/tabs', { url: base + '/A', sessionKey: 'default' });
  const results = await Promise.all(Array.from({length:20}, () => internal('/internal/checkpoint')));
  assert.ok(results.every(r => JSON.stringify(r.tabs) === JSON.stringify(results[0].tabs)));
  const checkpoint = JSON.parse(readFileSync(join(stateDir, 'profiles', profile.id, 'checkpoint.json'), 'utf8'));
  assert.ok(results.some(r => JSON.stringify(r) === JSON.stringify(checkpoint)));
  assert.equal(checkpoint.tabs.length, 1);
  assert.equal(checkpoint.tabs[0].url, base + '/A');
  console.log(JSON.stringify({passed:true, simultaneousCheckpoints:results.length, persistedTabs:checkpoint.tabs.length}));
} finally {
  gateway.closeAllConnections(); await new Promise(r => gateway.close(r));
  await supervisor.close();
  fixture.closeAllConnections(); await new Promise(r => fixture.close(r));
  rmSync(stateDir, { recursive: true, force: true });
}
