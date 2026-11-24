import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { Supervisor } from '../../lib/platform/supervisor.js';
import { installPlatformRoutes } from '../../lib/platform/routes.js';
import { loadPlatformConfig } from '../../lib/config.js';
import { workerJson } from '../../lib/platform/worker-launcher.js';
import { applicationProblem } from '../../mcp/lib/problems.mjs';
import { terminalOperation } from '../../mcp/lib/operation-contracts.mjs';
import { runTool } from '../../mcp/lib/tool-contracts.mjs';

const stateDir = mkdtempSync(join(tmpdir(), 'camofox-search-live-'));
symlinkSync(resolve(process.argv[2]), join(stateDir, 'cache'));
const servers = [];
async function listen(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}
function html(markup) {
  return (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(markup); };
}
const config = { ...loadPlatformConfig(), stateDir };
const supervisor = new Supervisor(config, {});
try {
  const child = await listen(html('<button>Save</button>'));
  const fixture = await listen(html(`<!doctype html>
    <form aria-label="Billing"><button type="button" aria-label="Save">Commit invoice</button></form>
    <form aria-label="Shipping"><button type="button" onclick="document.querySelector('output').textContent='shipping saved'">Save</button></form>
    <output>unchanged</output><p>A literal [e999] marker.</p>
    <iframe name="editor" src="${child}"></iframe><iframe srcdoc="<button>Excluded</button>"></iframe>`));
  const app = express();
  app.use(express.json());
  installPlatformRoutes(app, supervisor, config, () => {});
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ problem: applicationProblem(error) }));
  const base = await listen(app);
  const userId = 'fixture';
  async function call(path, body, owner = userId) {
    const response = await fetch(base + path + '?userId=' + owner, { method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify({ ...body, userId: owner }) });
    return { status: response.status, payload: await response.json() };
  }
  async function action(path, body) {
    const response = await call(path, body);
    assert(response.status < 300, JSON.stringify(response));
    if (!response.payload.pending) return response.payload;
    for (let i = 0; i < 300; i++) {
      await delay(100);
      const { payload } = await call('/operations/' + response.payload.operation.id);
      if (terminalOperation(payload.operation.state)) {
        assert.equal(payload.operation.state, 'completed', JSON.stringify(payload));
        return payload.result;
      }
    }
    throw new Error('Fixture operation timed out');
  }
  const profile = supervisor.store.createProfile('Search fixture');
  const session = supervisor.store.createSession(profile.id, 'Search test', userId);
  await supervisor.resume(session.id, userId);
  const { tabId } = await action('/tabs', { sessionId: session.id, url: fixture });
  assert(tabId);
  const path = '/tabs/' + tabId;
  const search = async options => (await runTool('camofox_search_snapshot', { tabId, ...options }, { userId }, base, { cookiesDir: stateDir })).payload;
  const snapshot = (await call(path + '/snapshot')).payload;
  const refs = [...snapshot.snapshot.matchAll(/button "Save" \[(e\d+)\]/g)].map(m => m[1]);
  assert.equal(refs.length, 3, snapshot.snapshot);
  const result = await search({ query: 'sAvE', role: 'BUTTON' });
  assert.equal(result.matched, 3, JSON.stringify(result));
  assert.deepEqual(result.items.map(hit => hit.ref), refs);
  assert.deepEqual(result.items.slice(0, 2).map(hit => hit.ancestors.at(-1).name), ['Billing', 'Shipping']);
  assert.equal(result.items[2].frame.name, 'editor');
  assert.equal(result.items[2].frame.origin, child);
  assert.equal(result.items[2].frame.main, false);
  assert.equal(result.items[0].text, 'Commit invoice');
  assert.deepEqual((await search({ query: 'invoice' })).items.map(hit => hit.ref), [refs[0]]);
  assert.equal((await search({ query: 'literal [e999]' })).items[0].ref, null);
  assert.equal((await search({ query: 'Save.*' })).matched, 0);
  assert.equal((await search({ role: 'button', limit: 1 })).omittedMatches, 2);
  assert(result.partial && result.refCoverage.reasons.includes('skipped_frame'));
  assert.equal((await call(path + '/search-snapshot', {})).status, 400);
  assert((await call(path + '/search-snapshot', { query: 'Save' }, 'another-owner')).status >= 400);
  const worker = supervisor.workers.get(session.id);
  worker.humanControl = true;
  await workerJson(worker.socket, supervisor.config.workerKey, 'POST', '/internal/viewer-mode', { humanControl: true });
  assert.deepEqual((await search({ query: 'Save', role: 'button' })).items, result.items);
  worker.humanControl = false;
  await workerJson(worker.socket, supervisor.config.workerKey, 'POST', '/internal/viewer-mode', { humanControl: false });
  assert.equal((await action(path + '/click', { ref: refs[1] })).ok, true);
  assert.equal((await action(path + '/read', { selector: 'output' })).items[0].text, 'shipping saved');
  await call(path + '/snapshot');
  await action(path + '/evaluate', { expression: "document.querySelector('iframe').remove();true" });
  const afterRemoval = await search({ role: 'button' });
  assert.equal(afterRemoval.changedFrames, 1);
  assert(afterRemoval.items.every(hit => hit.frame.main));
  await workerJson(worker.socket, supervisor.config.workerKey, 'POST', '/internal/viewer-mode', { humanControl: true, invalidate: true });
  const invalidated = await search({ role: 'button' });
  assert.deepEqual(invalidated.items, []);
  assert(invalidated.partial && invalidated.refCoverage.reasons.includes('not_inspected'));
  console.log('PASS supervised accessibility search and MCP adapter, duplicate names, frame and ancestor context, literal text, refs, limits, ownership, human control and frame removal');
} finally {
  await supervisor.close();
  for (const server of servers) server.close();
  rmSync(stateDir, { recursive: true, force: true });
}
