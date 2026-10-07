// Run only with a separate CAMOFOX_AGENT_STATE_DIR containing service.env.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
const runtime = process.env.CAMOFOX_AGENT_STATE_DIR;
if (!runtime || !runtime.endsWith('camofox-watch-test')) throw new Error('Use the isolated camofox-watch-test runtime');
const env = Object.fromEntries(readFileSync(join(runtime, 'service.env'), 'utf8').trim().split('\n').map(l => l.split(/=(.*)/s).slice(0, 2)));
const owner = 'watch-acceptance', base = `http://127.0.0.1:${env.CAMOFOX_PORT}`;
async function call(path, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${env.CAMOFOX_ACCESS_KEY}`, 'content-type': 'application/json' }, body: body ? JSON.stringify({ userId: owner, ...body }) : undefined });
  const result = await r.json(); if (!r.ok) throw new Error(JSON.stringify(result)); return result;
}
const fixture = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>Watch acceptance</title><style>body{font:24px system-ui;margin:60px;background:#f7f8fa}button{background:#1266df;color:white;border:0;border-radius:8px;font:22px system-ui;padding:20px;margin:25px}</style><h1>Choose a workspace</h1><input aria-label="Project name"><div><button onclick="document.body.dataset.clicked=1">Open workspace</button><button onclick="document.body.dataset.clicked=2">Open workspace</button><button onclick="document.body.dataset.clicked=3">Open workspace</button></div><p>Ready to watch</p><div style="height:1800px"></div>`); });
await new Promise(r => fixture.listen(23161, '127.0.0.1', r));
let sessionId;
try {
  const profile = await call('/profiles', { name: 'Watch acceptance ' + Date.now() });
  const session = await call('/agent-sessions', { profileId: profile.id, name: 'Live watch' }); sessionId = session.id;
  const tab = await call('/tabs', { sessionId, url: 'http://127.0.0.1:23161' });
  writeFileSync(join(runtime, 'acceptance.json'), JSON.stringify({ sessionId, tabId: tab.tabId, profileId: profile.id, owner }));
  const first = await call(`/agent-sessions/${sessionId}/watch`, { open: true }); assert.equal(first.mode, 'watch'); assert.equal(first.state, 'connected');
  await call(`/agent-sessions/${sessionId}/watch`, { open: true });
  await call(`/tabs/${tab.tabId}/type`, { selector: 'input', text: 'The agent is working' });
  await call(`/tabs/${tab.tabId}/click`, { selector: 'button:nth-child(2)' });
  assert.equal((await call(`/tabs/${tab.tabId}/evaluate`, { expression: 'document.body.dataset.clicked' })).result, '2');
  const other = await call('/tabs', { sessionId, url: 'http://127.0.0.1:23161/second' });
  await call(`/tabs/${tab.tabId}/click`, { selector: 'input' });
  assert.equal((await call(`/tabs/${tab.tabId}/evaluate`, { expression: 'document.hasFocus()' })).result, true);
  await call(`/tabs/${tab.tabId}/scroll`, { direction: 'down', amount: 300 });
  await call(`/tabs/${tab.tabId}/scroll`, { direction: 'up', amount: 300 });
  await call(`/tabs/${other.tabId}?userId=${owner}`, undefined, 'DELETE');
  await call(`/agent-sessions/${sessionId}/watch`, { open: false });
  await call(`/agent-sessions/${sessionId}/watch`, { open: false });
  assert.equal((await call(`/agent-sessions/${sessionId}`)).state, 'active');
  await call(`/agent-sessions/${sessionId}/watch`, { open: true });
  console.log('Native desktop connected; agent typing/clicking/scrolling, multi-tab focus, idempotent open/close and reopening passed.');
  if (process.argv.includes('--hold')) await new Promise(resolve => { process.on('SIGTERM', resolve); process.on('SIGINT', resolve); });
} finally {
  if (sessionId) { await call(`/agent-sessions/${sessionId}/watch`, { open: false }).catch(() => {}); await call(`/agent-sessions/${sessionId}/suspend`, {}).catch(() => {}); }
  fixture.close();
}
