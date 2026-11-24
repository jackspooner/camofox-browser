import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { loadPlatformConfig } from '../../lib/config.js';
import { Supervisor } from '../../lib/platform/supervisor.js';
import { installPlatformRoutes } from '../../lib/platform/routes.js';
import { terminalOperation } from '../../mcp/lib/operation-contracts.mjs';
import { runTool } from '../../mcp/lib/tool-contracts.mjs';

const real = process.argv.includes('--real-local');
const stateDir = mkdtempSync(join(real ? process.cwd() : tmpdir(), 'camofox-drag-live-'));
symlinkSync(resolve(process.argv[2]), join(stateDir, 'cache'));
const app = express();
app.use(express.json());
app.get('/fixture', (_req, res) => res.send(`<!doctype html><title>Drag fixture</title>
  <style>button {position:absolute;top:80px;width:160px;height:120px;color:white;font-size:26px;border:0}
    #draft {left:40px;background:#b22121} #done {left:340px;background:#193fa5}</style>
  <button id="draft" draggable="true">DRAFT</button><button id="done">DONE</button>
  <script>const counts=document.body.dataset;counts.drops=0;counts.presses=0;
  document.onmousedown=()=>counts.presses++;
  draft.ondragstart=e=>e.dataTransfer.setData('text/plain','draft');
  done.ondragover=e=>e.preventDefault();
  done.ondrop=e=>{e.preventDefault();if(e.dataTransfer.getData('text/plain')==='draft')counts.drops++};
  </script>`));
const red = 'the red button labelled DRAFT', blue = 'the blue button labelled DONE';
let calls = 0;
app.post('/media', async (req, res) => {
  const {method, params, id} = req.body;
  if (id === undefined) return res.sendStatus(202);
  let result;
  if (method === 'tools/call') {
    calls++;
    assert.equal(params.name, 'locate_anything');
    const prompt = params.arguments.prompt;
    if (prompt === 'slow') await delay(3200);
    const cards = [{x1:60,y1:100,x2:180,y2:180},{x1:360,y1:100,x2:480,y2:180}];
    const boxes = prompt === 'both' ? cards : prompt === 'missing' ? [] : [cards[Number(prompt === blue)]];
    result = {content:[{type:'text',text:JSON.stringify({boxes})}]};
  } else if (method === 'initialize') {
    result = {protocolVersion: params.protocolVersion, capabilities:{tools:{}}, serverInfo:{name:'fixture', version:'1'}};
  } else result = {tools:[]};
  res.json({jsonrpc:'2.0', id, result});
});
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = 'http://127.0.0.1:' + server.address().port;
const config = {...loadPlatformConfig(), stateDir};
if (!real) {
  config.mediaUrl = base + '/media';
  config.mediaTokenFile = join(stateDir, 'fixture.token');
  writeFileSync(config.mediaTokenFile, 'test', {mode:0o600});
}
const supervisor = new Supervisor(config, {});
const owner = 'drag-test';
const profile = supervisor.store.createProfile(owner);
const session = supervisor.store.createSession(profile.id, owner, owner);
installPlatformRoutes(app, supervisor, config, () => {});
app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({code:error.code, error:error.message}));
const call = async (name, args) => (await runTool('camofox_' + name, args, {userId:owner}, base, {})).payload;
async function settle(value) {
  if (!value.pending) return value;
  while (Date.now() < value.operation.deadline + 5000) {
    await delay(150);
    const status = await call('operation_status', {operationId:value.operation.id});
    if (terminalOperation(status.operation.state)) return {...status.result, operation:status.operation};
  }
  throw Error('Drag operation did not settle');
}
try {
  await supervisor.resume(session.id, owner);
  const {tabId} = await settle(await call('create_tab', {sessionId:session.id, url:base + '/fixture'}));
  assert(tabId);
  const drag = (from, to, extra) => call('drag', {tabId, from, to, ...extra}).then(settle);
  const evaluate = async expression => (await settle(await call('evaluate', {tabId, expression}))).result;
  const observation = async (prompt, targetNumber = 1) => ({
    observationId: (await call('locate', {tabId, prompt})).observationId, targetNumber,
  });
  const inline = await drag({prompt:red}, {prompt:blue});
  assert.equal(inline.operation.state, 'completed', JSON.stringify(inline));
  assert.equal(await evaluate('Number(document.body.dataset.drops)'), 1, JSON.stringify(inline));
  if (!real) assert.equal(calls, 2);
  const source = await observation(real ? red : 'both');
  const target = await observation(real ? blue : 'both', real ? 1 : 2);
  const key = {idempotencyKey:`v1.${Date.now()}.${randomUUID()}`};
  const selected = await drag(source, target, key);
  assert.equal((await drag(source, target, key)).operation.id, selected.operation.id);
  assert.equal(await evaluate('Number(document.body.dataset.drops)'), 2);
  if (!real) {
    await drag({selector:'#draft'}, {prompt:blue});
    await drag({prompt:red}, {coordinates:{x:420,y:140}});
    await drag(await observation(red), {selector:'#done'});
    await drag({coordinates:{x:120,y:140}}, await observation(blue));
    const {snapshot} = await call('snapshot', {tabId});
    const ref = snapshot.split('\n').find(line => line.includes('DRAFT'))?.match(/\b(e\d+)\b/)?.[1];
    assert(ref, snapshot);
    await drag({ref}, {selector:'#done'});
    assert.equal(await evaluate('Number(document.body.dataset.drops)'), 7);
    const presses = await evaluate('Number(document.body.dataset.presses)');
    const stale = await observation(red);
    await evaluate('document.querySelector("#draft").style.background="black"');
    for (const [from,to,code] of [
      [stale,{selector:'#done'},'stale_observation'],
      [{selector:'#draft'},{prompt:'missing'},'invalid_target'],
      [{prompt:'both'},{selector:'#done'},'ambiguous_target'],
      [{selector:'#draft'},{coordinates:{x:1e6,y:0}},'invalid_coordinates'],
    ]) await assert.rejects(() => drag(from, to), error => error.problem?.code === code);
    const pending = await call('drag', {tabId,from:{prompt:'slow'},to:{selector:'#done'}});
    assert(pending.pending);
    await call('operation_cancel', {operationId:pending.operation.id});
    assert.equal((await settle(pending)).operation.state, 'cancelled');
    assert.equal(await evaluate('Number(document.body.dataset.presses)'), presses);
  }
  console.log(real ? 'PASS real LocateAnything one-call and three-call flows, two accepted HTML drops' :
    'PASS direct, mixed, staged and inline HTML drops, idempotency, cancellation and rejection before mouse down');
} finally {
  await supervisor.close();
  await new Promise(resolve => server.close(resolve));
  rmSync(stateDir, {recursive:true, force:true});
}
