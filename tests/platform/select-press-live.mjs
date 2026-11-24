import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
import { applicationProblem } from '../../mcp/lib/problems.mjs';
import { terminalOperation } from '../../mcp/lib/operation-contracts.mjs';

if (!process.argv[2]) throw Error('Pass the browser cache root containing camoufox/');
const stateDir = mkdtempSync(join(tmpdir(), 'camofox-select-press-'));
symlinkSync(resolve(process.argv[2]), join(stateDir, 'cache'));
let replaceControl;
const fixture = createServer((req, res) => {
  if (req.url === '/replacement') {
    replaceControl = () => res.end('replace');
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><title>Shipping</title>
    <input id="start" aria-label="Start">
    <button id="apply">Apply</button>
    <select id="shipping" aria-label="Shipping"><option>Choose</option>
      <option value="Express">Standard</option><option value="first">Express</option>
      <option value="second">Express</option><option value="eco">Economy</option></select>
    <output id="state"></output><script>
    let changes=0, applies=0, keys=0, ctrl=false;
    function report(){state.textContent=JSON.stringify({value:shipping.value,changes,applies,keys,ctrl,focus:document.activeElement.id});}
    shipping.onchange=()=>{changes++;report()};
    apply.onclick=()=>{applies++;report()};
    document.onkeydown=e=>{keys++;ctrl=e.ctrlKey;report()};
    document.addEventListener('focusin',report);document.addEventListener('keyup',report);report();
    fetch('/replacement').then(r=>r.text()).then(()=>{
      const next = shipping.cloneNode(true);
      next.add(new Option('Replacement choice','later'));
      next.onchange=shipping.onchange;
      shipping.replaceWith(next);report();
    });
    </script>`);
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const fixtureUrl = await listen(fixture);
const config = {...loadPlatformConfig(), stateDir};
const supervisor = new Supervisor(config, {});
const app = express();
app.use(express.json());
installPlatformRoutes(app, supervisor, config, () => {});
app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({problem:applicationProblem(error)}));
const server = createServer(app);
const base = await listen(server);
const owner = 'select-press-fixture';
const hasCode = code => error => error.problem?.code === code;
const client = new Client({name:'select-press-test', version:'1'});
const transport = new StdioClientTransport({
  command:process.execPath, args:['mcp/server.mjs'], stderr:'pipe',
  env:{PATH:process.env.PATH, HOME:stateDir, CAMOFOX_BASE_URL:base, CAMOFOX_USER_ID:owner},
});
const call = async (name, args) => {
  const response = await client.callTool({name, arguments:args});
  const value = response.structuredContent ?? JSON.parse(response.content[0].text);
  if (response.isError) throw Object.assign(Error(response.content[0].text), value);
  return value;
};
async function settle(result) {
  if (!result.pending) return result;
  for (let i = 0; i < 300; i++) {
    const {operation, result:body} = await call('camofox_operation_status', {operationId:result.operation.id});
    if (terminalOperation(operation.state)) {
      if (operation.state !== 'completed') throw Object.assign(Error(operation.state), {operation, problem:operation.problem});
      return {...body, operation};
    }
    await delay(100);
  }
  throw Error('Fixture operation did not settle');
}
try {
  await client.connect(transport);
  await client.listTools();
  const profile = supervisor.store.createProfile(owner);
  const session = supervisor.store.createSession(profile.id, 'Shipping form', owner);
  await supervisor.resume(session.id, owner);
  const {tabId} = await settle(await call('camofox_create_tab', {sessionId:session.id, url:fixtureUrl}));
  const act = (name, args) => call('camofox_'+name, {tabId, ...args}).then(settle);
  const state = async () => JSON.parse((await act('read', {selector:'#state'})).items[0].text);
  const rawSelect = async body => {
    const response = await fetch(base+'/tabs/'+tabId+'/select', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
    });
    return {status:response.status, body:await response.json()};
  };
  const snap = await act('snapshot', {});
  const ref = snap.snapshot.match(/combobox "Shipping" \[(e\d+)\]/)?.[1];
  assert(ref, snap.snapshot);
  const args = {ref, option:'Express', idempotencyKey:`v1.${Date.now()}.${randomUUID()}`};
  const first = await act('select', args);
  assert.equal(first.ok, true);
  assert.equal((await act('select', args)).operation.id, first.operation.id);
  assert.equal((await state()).value, 'first');
  assert.equal((await state()).changes, 1);
  const legacy = await rawSelect({userId:owner, ref, selector:'#unused', option:'eco'});
  assert.equal((await settle(legacy.body)).ok, true);
  const foreign = await rawSelect({userId:'other-fixture-owner', selector:'#shipping', option:'Express'});
  assert([404,409].includes(foreign.status), JSON.stringify(foreign));
  await act('select', {selector:'#shipping', option:'eco'});
  assert.equal((await state()).value, 'eco');
  await assert.rejects(act('select', {selector:'#shipping', option:'absent'}), hasCode('invalid_target'));
  const validChanges = (await state()).changes;
  assert.equal(validChanges, 3);
  console.log('PASS exact label before value, first duplicate label, value-only option, failed choice and retained operation');

  const pending = await call('camofox_select', {tabId, selector:'#shipping', option:'later'});
  assert.equal(pending.pending, true);
  await call('camofox_operation_cancel', {operationId:pending.operation.id});
  await assert.rejects(settle(pending), hasCode('operation_cancelled'));
  assert.equal((await state()).changes, validChanges);
  console.log('PASS cancelling a pending option lookup leaves the form usable and unchanged');

  await act('click', {selector:'#start'});
  await act('press', {key:'TAB'});
  assert.equal((await state()).focus, 'apply');
  await act('press', {key:'Shift+Tab'});
  assert.equal((await state()).focus, 'start');
  await act('press', {key:'Tab'});
  await act('press', {key:'return'});
  assert.equal((await state()).applies, 1);
  await assert.rejects(act('press', {key:'ctrl+NotAKey'}), hasCode('invalid_request'));
  await act('press', {key:'Escape'});
  assert.equal((await state()).ctrl, false);
  console.log('PASS keyboard navigation, modifier chord and activation of the focused button');

  const before = await state();
  await supervisor.pauseAutomation(session.id);
  for (const [name, input] of [['select',{selector:'#shipping', option:'Express'}], ['press',{key:'Enter'}]]) {
    await assert.rejects(act(name, input), hasCode('automation_paused'));
  }
  assert.deepEqual(await state(), before);
  supervisor.resumeAutomation(session.id);
  const worker = supervisor.workers.get(session.id);
  worker.humanControl = true;
  try {
    for (const [name, input] of [['select',{selector:'#shipping', option:'Express'}], ['press',{key:'Enter'}]]) {
      await assert.rejects(act(name, input), hasCode('human_control'));
    }
    assert.deepEqual(await state(), before);
  } finally { worker.humanControl = false; }
  console.log('PASS paused automation and human control block both mutations without page events');

  await act('click', {coordinates:{x:1,y:1}}); // coordinate click invalidates the published refs
  const beforeStale = await state();
  await assert.rejects(act('select', {ref, option:'Express'}), hasCode('stale_refs'));
  assert.deepEqual(await state(), beforeStale);
  console.log('PASS missing ref with a matching ordinal on the page cannot send a select event');

  const waiting = await call('camofox_select', {tabId, selector:'#shipping', option:'later'});
  assert.equal(waiting.pending, true);
  replaceControl();
  await assert.rejects(settle(waiting), hasCode('invalid_target'));
  assert.equal((await state()).changes, beforeStale.changes);
  console.log('PASS replacement select cannot receive an option requested for the previous element');
} finally {
  await client.close();
  await supervisor.close();
  server.close();
  fixture.close();
  rmSync(stateDir, {recursive:true, force:true});
}
