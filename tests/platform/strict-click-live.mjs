// One disposable gateway, one browser worker, a loopback-only fixture and its own profile.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadPlatformConfig } from '../../lib/config.js';
import { Supervisor } from '../../lib/platform/supervisor.js';
import { installPlatformRoutes } from '../../lib/platform/routes.js';
import { workerJson } from '../../lib/platform/worker-launcher.js';
import { terminalOperation } from '../../mcp/lib/operation-contracts.mjs';
import { applicationProblem } from '../../mcp/lib/problems.mjs';

const cache = resolve(process.argv[2]);
const stateDir = mkdtempSync(join(tmpdir(), 'strict-click-'));
symlinkSync(cache, join(stateDir, 'cache'));
const config = { ...loadPlatformConfig(), stateDir, operations: {initialWaitMs:150} };
const supervisor = new Supervisor(config, {});
const profile = supervisor.store.createProfile('Strict click fixture');
const session = supervisor.store.createSession(profile.id, 'Strict clicks', 'test');
const app = express();
app.use(express.json());
const receivedClicks = [];
app.post('/fixture-event/:id', (req, res) => {
  receivedClicks.push(req.params.id);
  res.sendStatus(204);
});
app.get('/fixture', (_req, res) => res.type('html').send(`<!doctype html>
  <section><button id="first">Save</button><button id="second">Save</button></section>
  <output></output><div id="cover" hidden style="position:fixed;inset:0;background:gray"></div>
  <iframe src="/child" name="child"></iframe>
  <script>document.onclick = e => {
    document.querySelector('output').textContent += e.target.id + ',';
    navigator.sendBeacon('/fixture-event/' + e.target.id);
  };</script>`));
app.get('/child', (_req, res) => res.type('html').send('<button id="child" onclick="this.textContent=123">Child</button>'));
installPlatformRoutes(app, supervisor, config, () => {});
app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({problem: applicationProblem(error)}));
const gateway = createServer(app);
await new Promise(done => gateway.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${gateway.address().port}`;
const client = new Client({name:'strict-click-fixture', version:'1'});
const http = async (path, body) => {
  const response = await fetch(base + path + '?userId=test', body && {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({...body, userId:'test'}),
  });
  return response.json();
};
async function settled(result) {
  if (!result.pending) return result;
  for (let i = 0; i < 400; i++) {
    await delay(100);
    const state = await http('/operations/' + result.operation.id);
    if (terminalOperation(state.operation.state)) return {...state.result, operation: state.operation};
  }
  assert.fail('Operation deadline exceeded');
}
try {
  await supervisor.resume(session.id, 'test');
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ['mcp/server.mjs'], stderr: 'pipe',
    env: {PATH:process.env.PATH, HOME:stateDir, CAMOFOX_BASE_URL:base, CAMOFOX_USER_ID:'test'},
  }));
  const createTab = async () => (await settled(await http('/tabs', {sessionId: session.id, url: base + '/fixture'}))).tabId;
  const tabId = await createTab();
  assert.ok(tabId);
  async function initialTool(name, args) {
    const result = await client.callTool({name:'camofox_' + name, arguments:{tabId, ...args}});
    return result.structuredContent ?? JSON.parse(result.content[0].text);
  }
  const tool = (name, args) => initialTool(name, args).then(settled);
  const evaluate = async expression => {
    const value = await settled(await http('/tabs/' + tabId + '/evaluate', {expression}));
    assert.equal(value.operation.state, 'completed', JSON.stringify(value));
  };
  const observed = async (name = 'Save', index = 0) => {
    const snap = await tool('snapshot', {strictRefs:true});
    assert.match(snap.strictObservationId, /^strict-/);
    const refs = [...snap.snapshot.matchAll(new RegExp('button "' + name + '" \\[(e\\d+)\\]', 'g'))];
    assert.ok(refs[index], snap.snapshot);
    return {strictObservationId: snap.strictObservationId, ref: refs[index][1]};
  };
  const events = async () => (await tool('read', {selector:'output', fields:['text']})).items[0].text;
  const code = r => r.problem?.code || r.operation?.problem?.code;
  let target = await observed();
  await evaluate("document.querySelector('section').append(document.querySelector('#first')); true");
  const retry = { ...target, idempotencyKey: 'v1.' + Date.now() + '.' + randomUUID() };
  let result = await tool('click', retry);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal((await tool('click', retry)).operation.id, result.operation.id);
  assert.equal(code(await tool('click', target)), 'stale_observation');
  assert.equal(await events(), 'first,');
  target = await observed();
  await evaluate("const n=document.querySelector('#second'); n.replaceWith(n.cloneNode(true)); true");
  assert.equal(code(await tool('click', target)), 'stale_observation');
  target = await observed();
  await evaluate("document.querySelector('#cover').hidden=false; true");
  assert.equal(code(await tool('click', target)), 'target_changed');
  assert.equal(await events(), 'first,');
  await evaluate("document.querySelector('#cover').hidden=true; true");
  target = await observed();
  await evaluate("document.querySelector('#second').disabled=true; true");
  assert.equal(code(await tool('click', target)), 'target_changed');
  assert.equal(await events(), 'first,');
  await evaluate("document.querySelector('#second').disabled=false; true");
  target = await observed();
  await observed();
  assert.equal(code(await tool('click', target)), 'stale_observation');
  target = await observed('Child');
  await evaluate("new Promise(done=>{const f=document.querySelector('iframe'); f.onload=()=>done(true); f.src=f.src;})");
  assert.equal(code(await tool('click', target)), 'stale_observation');
  assert.equal((await tool('click', await observed('Child'))).ok, true);
  assert.equal((await tool('read', {frameSelector:'iframe', selector:'button', fields:['text']})).items[0].text, '123');
  const textOnly = await tool('snapshot', {delta:true, includeScreenshot:false});
  assert.match(textOnly.changes.revision, /^text-/);
  target = await observed();
  const secondTab = await createTab();
  assert.equal(code(await tool('click', {...target, tabId:secondTab})), 'stale_observation');
  assert.equal(code(await tool('click', {...target, strictObservationId:textOnly.changes.revision})), 'invalid_click_target');
  const worker = supervisor.workers.get(session.id);
  worker.humanControl = true;
  assert.equal(code(await tool('click', target)), 'human_control');
  await workerJson(worker.socket, supervisor.config.workerKey, 'POST', '/internal/viewer-mode', {humanControl:false, invalidate:true});
  worker.humanControl = false;
  assert.equal(code(await tool('click', target)), 'stale_observation');
  const ordinary = await tool('snapshot', {});
  assert.equal(ordinary.strictObservationId, undefined);
  assert.equal((await tool('click', {ref: ordinary.snapshot.match(/button "Save" \[(e\d+)\]/)[1]})).ok, true);
  assert.equal(await events(), 'first,second,');
  target = await observed();
  await evaluate("document.querySelector('#cover').hidden=false; true");
  const pending = await initialTool('click', target);
  assert.equal(pending.pending, true, JSON.stringify(pending));
  await http('/operations/' + pending.operation.id + '/cancel', {});
  assert.equal((await settled(pending)).operation.state, 'cancelled');
  // The existing click cancellation cleanup may close the tab. The fixture
  // server owns this event ledger independently of that lifecycle.
  assert.deepEqual(receivedClicks, ['first', 'second']);
  console.log('PASS exact reorder, single dispatch and retry, replacement, obstruction, cancellation, same-URL iframe, tab and handoff isolation, legacy input');
} finally {
  await client.close();
  await supervisor.close();
  gateway.close();
  rmSync(stateDir, {recursive:true, force:true});
}
