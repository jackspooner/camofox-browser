// Run from the repo root with the installed browser cache as the sole argument.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import express from 'express';
import { Supervisor } from '../../lib/platform/supervisor.js';
import { installPlatformRoutes } from '../../lib/platform/routes.js';
import { workerJson } from '../../lib/platform/worker-launcher.js';
import { loadPlatformConfig } from '../../lib/config.js';
import { terminalOperation } from '../../mcp/lib/operation-contracts.mjs';

const cache = resolve(process.argv[2]);
const stateDir = mkdtempSync(join(tmpdir(), 'camofox-revisions-'));
symlinkSync(cache, join(stateDir, 'cache'));
const owner = 'revision-fixture';
const config = { ...loadPlatformConfig(), stateDir };
const supervisor = new Supervisor(config, {});
const profile = supervisor.store.createProfile('Revision fixture');
const session = supervisor.store.createSession(profile.id, 'Text revisions', owner);
const app = express();
app.use(express.json());
installPlatformRoutes(app, supervisor, config, () => {});
app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code, error: error.message }));
const gateway = createServer(app);
const fixture = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><h1>Basket</h1><ul><li id="a">Apple</li><li id="b">Berry</li></ul><button>Save</button><iframe></iframe>');
});
async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}
const client = new Client({ name: 'snapshot-revision-fixture', version: '1' });
try {
  const base = await listen(gateway);
  const url = await listen(fixture);
  await supervisor.resume(session.id, owner);
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ['mcp/server.mjs'],
    env: { PATH: process.env.PATH, HOME: stateDir, CAMOFOX_USER_ID: owner, CAMOFOX_BASE_URL: base },
  }));
  async function http(path, body, userId = owner) {
    const target = new URL(path, base);
    target.searchParams.set('userId', userId);
    return fetch(target, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, userId }) });
  }
  async function action(path, body) {
    const response = await http(path, body);
    const initial = await response.json();
    assert(response.ok, JSON.stringify(initial));
    if (!initial.pending) return initial;
    for (let i = 0; i < 400; i++) {
      await delay(100);
      const status = await (await http('/operations/' + initial.operation.id)).json();
      if (terminalOperation(status.operation.state)) {
        assert.equal(status.operation.state, 'completed', JSON.stringify(status.operation.problem));
        return status.result;
      }
    }
    throw new Error('Fixture operation did not settle');
  }
  const { tabId } = await action('/tabs', { sessionId: session.id, url });
  assert(tabId);
  const snapshot = async (args = {}, textOnly = true) => {
    const result = await client.callTool({ name: 'camofox_snapshot', arguments: { tabId, ...(textOnly && { includeScreenshot: false }), ...args } });
    assert(!result.isError, result.content[0]?.text);
    assert.deepEqual(result.content.map(block => block.type), textOnly ? ['text'] : ['text', 'image']);
    const data = JSON.parse(result.content[0].text);
    assert.equal(data.screenshot, undefined);
    return data;
  };
  const evaluate = expression => action('/tabs/' + tabId + '/evaluate', { expression: expression + '; true' });
  const ordinary = await snapshot({}, false);
  assert.equal(ordinary.changes, undefined);
  let result = await snapshot({ delta: true });
  let text = result.snapshot;
  let revision = result.changes.revision;
  assert.equal(result.changes.reason, 'initial');
  assert.equal(text, ordinary.snapshot);
  assert.match(text, /Apple/);
  assert(result.refCoverage.reasons.includes('skipped_frame'));
  assert.equal((await snapshot({ delta: true, baseRevision: revision })).changes.kind, 'unchanged');
  for (const expression of [
    "document.querySelector('ul').insertAdjacentHTML('beforeend', '<li id=c>Cherry</li>')",
    "document.querySelector('#b').remove()",
    "document.querySelector('ul').prepend(document.querySelector('#c'))",
    "document.querySelector('button').setAttribute('aria-label', 'Save basket 🍐')",
  ]) {
    await evaluate(expression);
    result = await snapshot({ delta: true, baseRevision: revision });
    assert.equal(result.changes.kind, 'delta');
    assert.equal(result.changes.baseRevision, revision);
    assert.equal(result.snapshot, undefined);
    const { start, deleteCount, insert } = result.changes.edit;
    text = text.slice(0, start) + insert + text.slice(start + deleteCount);
    const fresh = await snapshot();
    assert.equal(text, fresh.snapshot);
    assert.deepEqual(result.refCoverage, fresh.refCoverage);
    revision = result.changes.revision;
  }
  console.log('PASS stdio MCP image default, text only, unchanged, four exact text edits and partial frame coverage');

  const other = await action('/tabs', { sessionId: session.id, url });
  const foreign = await snapshot({ tabId: other.tabId, delta: true, baseRevision: revision });
  assert.equal(foreign.changes.reason, 'base_unavailable');
  assert.equal(foreign.snapshot, ordinary.snapshot);
  const path = '/tabs/' + tabId + '/snapshot';
  assert(!(await http(path + '?delta=true&baseRevision=' + revision, undefined, 'another-owner')).ok);
  assert.equal((await http(path + '?delta=true&offset=1')).status, 400);
  await action('/tabs/' + tabId + '/navigate', { url });
  result = await snapshot({ delta: true, baseRevision: revision });
  assert.equal(result.changes.reason, 'base_unavailable');
  assert.equal(result.snapshot, ordinary.snapshot);
  const worker = supervisor.workers.get(session.id);
  for (const humanControl of [true, false]) {
    worker.humanControl = humanControl;
    await workerJson(worker.socket, supervisor.config.workerKey, 'POST', '/internal/viewer-mode', { humanControl, invalidate: !humanControl });
    result = await snapshot({ delta: true, baseRevision: result.changes.revision });
    assert.equal(result.changes.reason, 'base_unavailable');
  }
  console.log('PASS foreign tab and owner, same-URL navigation, human handoff/return and read during human control');

  const beforeRestore = result.changes.revision;
  await supervisor.suspend(session.id, owner);
  await supervisor.resume(session.id, owner);
  result = await snapshot({ delta: true, baseRevision: beforeRestore });
  assert.equal(result.changes.reason, 'base_unavailable');
  assert.equal(result.snapshot, ordinary.snapshot);
  const click = await client.callTool({ name: 'camofox_click', arguments: { tabId, ref: result.changes.revision } });
  assert.equal(click.isError, true);
  assert.match(click.content[0].text, /stale_refs/);
  console.log('PASS restored tab discards revisions; text revision rejected as an input ref');

  await evaluate("document.body.insertAdjacentHTML('beforeend','<p>'+'basket item '.repeat(9000)+'</p>')");
  result = await snapshot({ delta: true, baseRevision: result.changes.revision });
  assert.deepEqual(result.changes, { kind: 'reset', reason: 'text_limit', revision: null });
  assert.equal(result.truncated, true);
  assert.equal(result.hasMore, true);
  assert.equal(result.snapshot, (await snapshot()).snapshot);
  assert(result.totalChars > result.snapshot.length);
  const next = await snapshot({ offset: result.nextOffset });
  assert.deepEqual(result.refCoverage, next.refCoverage);
  console.log('PASS oversized reset retains canonical first window, pagination and omission evidence');
} finally {
  await client.close();
  await supervisor.close();
  gateway.close();
  fixture.close();
  rmSync(stateDir, { recursive: true, force: true });
}
