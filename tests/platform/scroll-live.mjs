import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import express from 'express';
import { loadPlatformConfig } from '../../lib/config.js';
import { Supervisor } from '../../lib/platform/supervisor.js';
import { installPlatformRoutes } from '../../lib/platform/routes.js';
import { applicationProblem } from '../../mcp/lib/problems.mjs';
import { terminalOperation } from '../../mcp/lib/operation-contracts.mjs';

assert(process.argv[2], 'Pass the installed Camoufox cache root');
const stateDir = mkdtempSync(join(tmpdir(), 'camofox-scroll-'));
symlinkSync(resolve(process.argv[2]), join(stateDir, 'cache'));
const owner = 'scroll-fixture';
const config = { ...loadPlatformConfig(), stateDir, browserDir: '' };
const supervisor = new Supervisor(config, {});
const app = express();
app.use(express.json());
app.get('/fixture', (_req, res) => res.send(`<!doctype html><title>Warehouse bins</title>
  <style>body{min-height:5000px;padding:120px}.pane{overflow:auto;width:200px;height:120px;scroll-behavior:smooth}
  .pane div{width:1000px;height:800px}</style>
  <section class="pane" id="bins"><div>Bins</div></section>
  <section class="pane" id="spares"><div>Spares</div></section>
  <script>window.addEventListener('wheel',()=>document.body.dataset.wheel='yes');</script>`));
installPlatformRoutes(app, supervisor, config, () => {});
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({problem:applicationProblem(err)}));
const server = await new Promise(resolve => {
  const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
});
const base = 'http://127.0.0.1:' + server.address().port;
const client = new Client({ name: owner, version: '1' });
const invoke = (name, args) => client.callTool({name, arguments: args});
async function call(name, args) {
  const response = await invoke(name, args);
  assert(!response.isError, JSON.stringify(response.content));
  return response.structuredContent ?? JSON.parse(response.content[0].text);
}
async function settle(value) {
  if (!value.pending) return value;
  while (Date.now() < value.operation.deadline + 5000) {
    const status = await call('camofox_operation_status', {operationId:value.operation.id});
    if (terminalOperation(status.operation.state)) return {...status.result, operation:status.operation};
    await delay(100);
  }
  throw Error('Fixture operation did not settle');
}
try {
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ['mcp/server.mjs'], stderr: 'pipe',
    env: { PATH:process.env.PATH, HOME:stateDir, CAMOFOX_BASE_URL:base, CAMOFOX_USER_ID:owner },
  }));
  const catalogue = await client.listTools();
  assert.equal(catalogue.tools.find(t => t.name === 'camofox_scroll').inputSchema.properties.selector.maxLength, 2048);
  const profile = supervisor.store.createProfile(owner);
  const session = supervisor.store.createSession(profile.id, owner, owner);
  await supervisor.resume(session.id, owner);
  const {tabId} = await settle(await call('camofox_create_tab', {sessionId:session.id, url:base + '/fixture'}));
  assert(tabId);
  const scroll = args => call('camofox_scroll', {tabId, ...args}).then(settle);
  const evaluate = async expression => (await settle(await call('camofox_evaluate', {tabId, expression}))).result;
  const offsets = () => evaluate('[...Array.from(document.querySelectorAll(".pane")).flatMap(el => [el.scrollLeft,el.scrollTop]),scrollX,scrollY]');
  const point = (x,y) => ({x,y});
  const key = 'v1.' + Date.now() + '.' + randomUUID();
  const down = {selector:'#bins', direction:'down', amount:100, idempotencyKey:key};
  const first = await scroll(down);
  assert.deepEqual(first.movement, {before:point(0,0), after:point(0,100), delta:point(0,100), moved:true});
  assert.equal((await scroll(down)).operation.id, first.operation.id);
  assert.deepEqual(await offsets(), [0,100,0,0,0,0]);
  const right = await scroll({selector:'#bins', direction:'right', amount:80});
  assert.deepEqual(right.movement, {before:point(0,100), after:point(80,100), delta:point(80,0), moved:true});
  assert.deepEqual(await offsets(), [80,100,0,0,0,0]);
  for (const direction of ['left','up']) {
    const clipped = await scroll({selector:'#bins', direction, amount:2000});
    assert(clipped.movement.moved);
    assert.deepEqual(clipped.movement.delta, direction === 'left' ? point(-80,0) : point(0,-100));
    const edge = await scroll({selector:'#bins', direction, amount:100});
    assert.deepEqual(edge.movement, {before:clipped.movement.after, after:clipped.movement.after, delta:point(0,0), moved:false});
  }
  async function rejected(args, code) {
    const response = await invoke('camofox_scroll', {tabId, direction:'down', ...args});
    assert(response.isError, JSON.stringify(response));
    assert.equal(response.structuredContent.problem.code, code);
  }
  await rejected({selector:'.pane'}, 'ambiguous_target');
  await rejected({selector:'['}, 'invalid_selector');
  await evaluate('document.querySelector("#bins").id="archived";true');
  await rejected({selector:'#bins'}, 'invalid_target');
  await evaluate('document.querySelector("#archived").id="bins";true');
  assert.deepEqual(await offsets(), [0,0,0,0,0,0]);
  console.log('PASS two-axis offsets, clamped travel, edges, retry identity, ambiguous/invalid/missing selectors and outer-page isolation');

  const worker = supervisor.workers.get(session.id);
  worker.humanControl = true;
  try { await rejected({selector:'#bins'}, 'human_control'); }
  finally { worker.humanControl = false; }
  const gate = Promise.withResolvers();
  const lock = supervisor.serial(session.id, () => gate.promise);
  try {
    const pending = await call('camofox_scroll', {tabId, selector:'#bins', direction:'down'});
    assert.equal(pending.pending, true);
    const cancelled = await call('camofox_operation_cancel', {operationId:pending.operation.id});
    assert.equal(cancelled.operation.state, 'cancelled');
  } finally { gate.resolve(); await lock; }
  assert.deepEqual(await offsets(), [0,0,0,0,0,0]);
  const forbidden = await fetch(base + '/tabs/' + tabId + '/scroll', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({userId:'other-owner', selector:'#bins', direction:'down'}),
  });
  assert.equal((await forbidden.json()).problem.code, 'session_owned');
  const page = await scroll({direction:'down', amount:250});
  assert.equal(page.ok, true);
  assert.equal(page.movement, undefined);
  const final = await offsets();
  assert.deepEqual(final.slice(0,5), [0,0,0,0,0]);
  assert(final[5] > 0);
  assert.equal(await evaluate('document.body.dataset.wheel'), 'yes');
  console.log('PASS human control, cancellation while queued, session ownership and legacy page-wheel movement');
} finally {
  await client.close();
  await supervisor.close();
  await new Promise(resolve => server.close(resolve));
  rmSync(stateDir, {recursive:true, force:true});
}
