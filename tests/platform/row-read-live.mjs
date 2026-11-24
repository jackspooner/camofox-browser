// Run from the repository root with the installed browser cache as the sole argument.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import express from 'express';
import { loadPlatformConfig } from '../../lib/config.js';
import { installPlatformRoutes } from '../../lib/platform/routes.js';
import { Supervisor } from '../../lib/platform/supervisor.js';
import { workerJson } from '../../lib/platform/worker-launcher.js';
import { applicationProblem } from '../../mcp/lib/problems.mjs';

assert(process.argv[2], 'Pass the installed browser cache directory');
const stateDir = mkdtempSync(join(tmpdir(), 'camofox-row-read-'));
const servers = [];
async function listen(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  return 'http://127.0.0.1:' + server.address().port;
}
const html = content => (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html>' + content);
};
const fields = [
  { name: 'name', selector: '.label', read: 'text', type: 'string' },
  { name: 'price', selector: '.price', read: 'text', type: 'number' },
  { name: 'inStock', selector: '.label', read: 'title', type: 'boolean' },
];
const client = new Client({ name: 'row-fixture', version: '1' });
let supervisor;
try {
  symlinkSync(resolve(process.argv[2]), join(stateDir, 'cache'));
  const inner = await listen(html(`
    <article class="card"><b class="label" title="true">Thé 🫖<textarea>PRIVATE</textarea></b><b class="price"> 12.50 </b></article>
    <article class="card"><b class="label" title="false">Cup</b><b class="label">later match</b></article>
    <article class="card"><b class="label">Jug</b><b class="price">12,50</b></article>
    <article class="card"><b class="label" title="yes">Set</b><b class="price">${'1'.repeat(2049)}</b></article>`));
  const outer = await listen(html(`<table><tbody><tr><td class="label" title="true">Thé 🫖</td><td class="price">12.50</td></tr></tbody></table>
    <iframe id="grid" name="grid" src="${inner}/grid"></iframe>`));
  const config = { ...loadPlatformConfig(), stateDir };
  supervisor = new Supervisor(config, {});
  const owner = 'row-fixture';
  const profile = supervisor.store.createProfile('Row fixture');
  const session = supervisor.store.createSession(profile.id, 'Structured rows', owner);
  const app = express();
  app.use(express.json());
  installPlatformRoutes(app, supervisor, config, () => {});
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ problem: applicationProblem(err) }));
  const base = await listen(app);
  await supervisor.resume(session.id, owner);
  const post = (path, body) => fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: owner, ...body }),
  });
  let created = await (await post('/tabs', { sessionId: session.id, url: outer })).json();
  if (created.pending) {
    const status = base + '/operations/' + created.operation.id + '?userId=' + owner;
    for (let i = 0; i < 200; i++) {
      const result = await (await fetch(status)).json();
      if (result.result || result.operation?.problem) { created = result.result || result.operation; break; }
      await delay(100);
    }
  }
  assert(created.tabId, JSON.stringify(created));
  const tabId = created.tabId, path = '/tabs/' + tabId + '/read';
  const cards = { selector: '.card', frameSelector: '#grid', projection: { fields } };
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ['mcp/server.mjs'],
    env: { CAMOFOX_BASE_URL: base, CAMOFOX_USER_ID: owner, HOME: stateDir },
  }));
  const catalogue = await client.listTools();
  assert(catalogue.tools.find(t => t.name === 'camofox_read').inputSchema.properties.projection);
  async function read(args) {
    const result = await client.callTool({ name: 'camofox_read', arguments: { tabId, ...args } });
    assert(!result.isError, JSON.stringify(result.content));
    return result.structuredContent;
  }
  const r = await read(cards);
  assert.deepEqual(r.frame, { main: false, name: 'grid', origin: inner });
  assert.deepEqual(r.fields, fields);
  assert.equal(r.selector, '.card');
  assert.deepEqual(r.rows[0], {
    name: { status: 'ok', value: 'Thé 🫖' }, price: { status: 'ok', value: 12.5 }, inStock: { status: 'ok', value: true },
  });
  assert.equal(r.rows[1].name.value, 'Cup');
  assert.deepEqual(r.rows[1].price, { status: 'missing_element', value: null });
  assert.equal(r.rows[1].inStock.value, false);
  assert.equal(r.rows[2].price.status, 'invalid_conversion');
  assert.equal(r.rows[2].inStock.status, 'missing_attribute');
  assert.equal(r.rows[3].inStock.status, 'invalid_conversion');
  assert.deepEqual(r.rows[3].price, { status: 'string_limit', value: null });
  assert.equal(r.truncated, true);
  assert.equal(r.stopReason, null);
  assert.equal(r.rowBytes, Buffer.byteLength(JSON.stringify(r.rows)));
  const table = await read({ selector: 'tbody tr', projection: { fields } });
  assert.deepEqual(table.frame, { main: true, name: '', origin: outer });
  assert.deepEqual(table.rows, [r.rows[0]]);
  assert.equal(table.truncated, false);
  assert.deepEqual(await (await post(path, cards)).json(), r);
  assert.equal((await read({ selector: '.price', fields: ['text'] })).items[0].text, '12.50');

  const first = await read({ ...cards, limit: 1 });
  assert.equal(first.stopReason, 'row_limit');
  assert.equal(first.matched, 4);
  assert.equal(first.omittedRows, 3);
  for (const [maxBytes, count] of [[first.rowBytes, 1], [first.rowBytes - 1, 0], [2, 0]]) {
    const cut = await read({ ...cards, projection: { fields, maxBytes } });
    assert.equal(cut.stopReason, 'byte_limit');
    assert.equal(cut.returned, count);
    assert.equal(cut.omittedRows, 4 - count);
    assert(cut.rowBytes <= maxBytes);
    assert.deepEqual(cut.rows, r.rows.slice(0, count));
  }
  const small = await read({ ...cards, limit: 1, maxChars: 7 });
  assert.deepEqual(small.rows[0].price, { status: 'character_budget', value: null });
  const excluded = await read({ ...cards, projection: { fields: [{ ...fields[0], selector: 'textarea' }] } });
  assert.deepEqual(excluded.rows[0].name, { status: 'excluded', value: null });
  assert.equal((await read({ ...cards, selector: '#absent' })).returned, 0);
  for (const [body, code] of [
    [{ ...cards, selector: '#absent', projection: { fields: [{ ...fields[0], selector: '[' }] } }, 'invalid_selector'],
    [{ ...cards, fields: ['text'] }, 'invalid_request'],
    [{ ...cards, userId: 'different-owner' }, 'session_owned'],
  ]) {
    const response = await post(path, body);
    assert(!response.ok);
    const error = await response.json();
    assert.equal(error.problem?.code || error.code, code, JSON.stringify(error));
  }
  const worker = supervisor.workers.get(session.id);
  worker.humanControl = true;
  await workerJson(worker.socket, supervisor.config.workerKey, 'POST', '/internal/viewer-mode', { humanControl: true });
  assert.deepEqual((await read(cards)).rows, r.rows);
  console.log('PASS supervised REST and stdio MCP typed rows, table, cross-origin cards, coercion, omissions, limits, owner and human-control policy, flat read');
} finally {
  await client.close();
  await supervisor?.close();
  for (const server of servers) server.close();
  rmSync(stateDir, { recursive: true, force: true });
}
