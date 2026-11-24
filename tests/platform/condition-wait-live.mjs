// node tests/platform/condition-wait-live.mjs /absolute/path/to/browser/cache
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import express from 'express';
import {loadPlatformConfig} from '../../lib/config.js';
import {Supervisor} from '../../lib/platform/supervisor.js';
import {installPlatformRoutes} from '../../lib/platform/routes.js';
import {workerJson} from '../../lib/platform/worker-launcher.js';
import {applicationProblem} from '../../mcp/lib/problems.mjs';
import {terminalOperation} from '../../mcp/lib/operation-contracts.mjs';

const cache = resolve(process.argv[2]);
const stateDir = mkdtempSync(join(tmpdir(), 'camofox-wait-'));
symlinkSync(cache, join(stateDir, 'cache'));
const supervisor = new Supervisor({...loadPlatformConfig(), stateDir}, {});
const profile = supervisor.store.createProfile('Wait acceptance');
const owner = 'wait-fixture';
const session = supervisor.store.createSession(profile.id, 'Wait acceptance', owner);
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = server => 'http://127.0.0.1:' + server.address().port;
let events;
const fixture = createServer((req, res) => {
  if (req.url === '/events') {
    events = res;
    res.writeHead(200, {'Content-Type': 'text/event-stream'});
    return res.write(': ready\n\n');
  }
  res.setHeader('Content-Type', 'text/html');
  if (req.url === '/replacement') return res.end('<p id="replacement">New page</p>');
  res.end(`<!doctype html><title>Wait fixture</title><input id="keep" value="original">
    <div id="onetrust-banner-sdk"><button id="onetrust-accept-btn-handler">Consent</button></div>
    <span hidden>Hidden marker</span><span style="visibility:hidden">Invisible marker</span>
    <p class="message" hidden>Saved [1].*</p><p class="message" hidden>Second copy</p>
    <script>
      const keep = document.querySelector('#keep');
      keep.focus();
      document.body.dataset.inputs = '0';
      for (const type of ['click', 'keydown', 'input'])
        addEventListener(type, () => document.body.dataset.inputs = String(Number(document.body.dataset.inputs) + 1));
      const messages = document.querySelectorAll('.message');
      const events = new EventSource('/events');
      events.onmessage = ({data}) => {
        if (data === 'show') messages[1].hidden = false;
        if (data === 'hide') messages[1].remove();
        if (data === 'text') messages[0].hidden = false;
        if (data === 'navigate') location.href = '/replacement';
      };
    </script>`);
});
const app = express();
app.use(express.json());
installPlatformRoutes(app, supervisor, supervisor.config, () => {});
app.use((err, _req, res, _next) => res.status(err.statusCode || 500)
  .json({code: err.code, error: err.message, problem: applicationProblem(err)}));
const gateway = createServer(app);
const client = new Client({name: 'condition-wait-fixture', version: '1'});
const success = {ok: true, ready: true};
try {
  await listen(fixture);
  await listen(gateway);
  const base = origin(gateway);
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ['mcp/server.mjs'], stderr: 'pipe',
    env: {CAMOFOX_BASE_URL: base, CAMOFOX_USER_ID: owner},
  }));
  assert((await client.listTools()).tools.some(t => t.name === 'camofox_wait'));
  async function call(path, body, user = owner) {
    const res = await fetch(base + path + '?userId=' + user, body === undefined ? {} : {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...body, userId: user}),
    });
    return {status: res.status, value: await res.json()};
  }
  async function action(path, args) {
    let {value} = await call(path, args);
    if (value.pending) {
      const id = value.operation.id;
      for (let i = 0; i < 200; i++) {
        await delay(100);
        ({value} = await call('/operations/' + id));
        if (terminalOperation(value.operation.state)) break;
      }
      assert.equal(value.operation.state, 'completed', JSON.stringify(value));
      return value.result;
    }
    assert.equal(value.operation?.state, 'completed', JSON.stringify(value));
    return value;
  }
  await supervisor.resume(session.id, owner);
  const {tabId} = await action('/tabs', {sessionId: session.id, url: origin(fixture)});
  assert(tabId);
  const path = '/tabs/' + tabId;
  const wait = args => call(path + '/wait', args);
  const mcp = args => client.callTool({name: 'camofox_wait', arguments: {tabId, ...args}});
  const evaluate = async expression => (await action(path + '/evaluate', {expression})).result;
  assert.deepEqual(await wait({}), {status: 200, value: success});
  assert.deepEqual((await mcp({waitForNetwork: false})).structuredContent, success);
  assert(events);

  // The fixture changes independently while the supervised session queue is held.
  async function transition(event, pending) {
    let settled = false;
    const result = pending.then(value => { settled = true; return value; });
    await delay(300);
    assert.equal(settled, false, 'wait completed before ' + event);
    events.write('data: ' + event + '\n\n');
    return result;
  }
  assert.deepEqual(await transition('show', wait({selector: '.message'})), {status: 200, value: success});
  assert.deepEqual((await transition('hide', mcp({selector: '.message', state: 'hidden'}))).structuredContent, success);
  assert.deepEqual((await transition('text', mcp({text: 'Saved [1].*'}))).structuredContent, success);
  assert.deepEqual(await wait({selector: '#missing', state: 'hidden'}), {status: 200, value: success});
  for (const args of [{text: 'Hidden marker'}, {text: 'Invisible marker'}, {text: 'saved [1].*'}, {text: 'Saved .+'}, {selector: '#missing'}]) {
    const result = await wait({...args, timeout: 120});
    assert.equal(result.status, 408);
    assert.equal(result.value.problem.code, 'read_timeout');
    assert.equal(result.value.ok, undefined);
  }
  const expired = await mcp({text: 'absent', timeout: 120});
  assert(expired.isError);
  assert.equal(expired.structuredContent.problem.code, 'read_timeout');
  for (const args of [{state: 'hidden'}, {selector: ' '}, {text: 'x'.repeat(513)}, {selector: 5},
    {text: 'x', selector: 'p'}, {text: 'x', state: 'attached'}, {text: 'x', timeout: 0},
    {text: 'x', timeout: 30001}, {text: 'x', dismissConsent: true}, {selector: 'p', waitForNetwork: false}]) {
    const result = await wait(args);
    assert.equal(result.status, 400);
    assert.equal(result.value.problem.code, 'invalid_request');
  }
  const badCss = await mcp({selector: '['});
  assert(badCss.isError);
  assert.equal(badCss.structuredContent.problem.code, 'invalid_selector');
  const invalid = await mcp({text: 'visible', dismissConsent: true});
  assert(invalid.isError);
  assert.equal(invalid.structuredContent.problem.code, 'invalid_request');
  assert.equal((await call(path + '/wait', {selector: 'p'}, 'another-owner')).status, 409);

  // A timed-out queued read must not gain a fresh timeout at dispatch.
  let release;
  const gate = new Promise(r => { release = r; });
  const held = supervisor.serial(session.id, () => gate);
  try {
    const result = await Promise.race([wait({selector: 'p', timeout: 120}), delay(1500).then(() => null)]);
    assert.equal(result?.value.problem.code, 'read_timeout');
  } finally { release(); await held; }
  const worker = supervisor.workers.get(session.id);
  await supervisor.pauseAutomation(session.id);
  worker.humanControl = true;
  try {
    await workerJson(worker.socket, supervisor.config.workerKey, 'POST', '/internal/viewer-mode', {humanControl: true});
    assert.deepEqual((await mcp({text: 'Saved [1].*'})).structuredContent, success);
    assert.deepEqual(await wait({waitForNetwork: false}), {status: 200, value: success});
  } finally {
    worker.humanControl = false;
    await workerJson(worker.socket, supervisor.config.workerKey, 'POST', '/internal/viewer-mode', {humanControl: false});
    supervisor.resumeAutomation(session.id);
  }
  assert.deepEqual(await evaluate('[document.body.dataset.inputs, document.activeElement.id, document.querySelector("#keep").value]'), ['0','keep','original']);
  assert.deepEqual(await wait({waitForNetwork: false, dismissConsent: true}), {status: 200, value: success});
  assert.equal(await evaluate('document.body.dataset.inputs'), '1');
  const replaced = await transition('navigate', wait({selector: '#replacement'}));
  assert.equal(replaced.status, 409);
  assert.equal(replaced.value.problem.code, 'target_changed');
  assert.deepEqual(await wait({selector: '#replacement'}), {status: 200, value: success});
  console.log('PASS delayed CSS visibility/disappearance and literal text, timeout, invalid input, queue deadline, document replacement, ownership, paused/human observation, no input, legacy readiness/consent, REST and stdio MCP');
} finally {
  await client.close();
  await supervisor.close();
  gateway.close();
  events?.end();
  fixture.close();
  rmSync(stateDir, {recursive: true, force: true});
}
