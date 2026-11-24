// Run with the installed browser cache root as the sole argument.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import express from 'express';
import {loadPlatformConfig} from '../../lib/config.js';
import {Supervisor} from '../../lib/platform/supervisor.js';
import {installPlatformRoutes} from '../../lib/platform/routes.js';
import {installViewer} from '../../lib/platform/viewer.js';
import {applicationProblem} from '../../mcp/lib/problems.mjs';
import {runTool} from '../../mcp/lib/tool-contracts.mjs';
import {terminalOperation} from '../../mcp/lib/operation-contracts.mjs';

const cache = resolve(process.argv[2], 'camoufox');
const files = readdirSync(cache);
const stateDir = mkdtempSync(join(tmpdir(), 'camofox-diag-'));
const localCache = join(stateDir, 'cache', 'camoufox');
mkdirSync(localCache, {recursive: true});
for (const file of files.filter(name => name !== 'fontconfig'))
  symlinkSync(join(cache, file), join(localCache, file));
const config = {...loadPlatformConfig(), browserDir: '', stateDir};
const supervisor = new Supervisor(config, {});
const owner = 'diagnostics-fixture';
const marker = 'private-' + randomUUID();
const fixture = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><title>Diagnostics test</title>
    <button id="sample">Sample</button><button id="overflow">Overflow</button>
    <button id="second">Other tab</button>
    <script>
      if(location.pathname === '/next') console.warn('Page failed to load');
      sample.onclick = () => {
        console.info('Not captured');
        console.warn('Component failed to render');
        console.error({message:'${marker}', headers:{Authorization:'${marker}'}});
        console.error(['${marker}']);
        console.warn(new Error('${marker}'));
        console.warn('Cookie: private=${marker}');
        console.warn('private', '${marker}');
        console.error('a'.repeat(10000));
        setTimeout(() => { throw new TypeError('${marker}'); }, 0);
      };
      overflow.onclick = () => { for(let i=0; i<70; i++) console.warn('Layout warning'); };
      second.onclick = () => console.error('Missing input');
    </script>`);
});
const app = express();
app.use(express.json());
const server = createServer(app);
async function listen(server) { await new Promise(r => server.listen(0, '127.0.0.1', r)); return 'http://127.0.0.1:' + server.address().port; }
try {
  const fixtureUrl = await listen(fixture);
  const base = await listen(server);
  config.port = server.address().port;
  const openViewer = installViewer(app, server, supervisor, config);
  installPlatformRoutes(app, supervisor, config, openViewer);
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({problem: applicationProblem(err)}));
  async function tool(name, args, userId = owner) {
    const {payload} = await runTool(name, args, {userId}, base, {cookiesDir: stateDir});
    if (!payload.pending) return payload;
    for (let n = 0; n < 300; n++) {
      const {payload: status} = await runTool('camofox_operation_status', {operationId: payload.operation.id}, {userId}, base, {});
      if (terminalOperation(status.operation.state)) {
        assert.equal(status.operation.state, 'completed');
        return status.result;
      }
      await delay(100);
    }
    throw new Error('Fixture operation timed out');
  }
  async function post(path, body, headers = {}) {
    const response = await fetch(base + path, {method: 'POST', headers: {'Content-Type':'application/json', ...headers}, body: JSON.stringify(body)});
    return {status: response.status, body: await response.json()};
  }
  const profile = supervisor.store.createProfile('Diagnostics fixture');
  const session = supervisor.store.createSession(profile.id, 'Disposable console', owner);
  const sessionId = session.id;
  await tool('camofox_session_resume', {sessionId});
  const {tabId: a} = await tool('camofox_create_tab', {sessionId, url: fixtureUrl});
  const {tabId: b} = await tool('camofox_create_tab', {sessionId, url: fixtureUrl});
  const diag = (tabId, action, options = {}) => tool('camofox_tab_diagnostics', {tabId, action, ...options});
  const raw = (tabId, action, options = {}) => post('/tabs/' + tabId + '/diagnostics', {userId: owner, action, ...options});
  const click = (tabId, selector) => tool('camofox_click', {tabId, selector});
  await click(a, '#sample');
  assert.equal((await diag(a, 'read')).active, false);
  const cursor = (await diag(a, 'start')).nextCursor;
  assert.equal((await diag(a, 'start')).nextCursor, cursor);
  assert.deepEqual((await diag(a, 'read')).events, []);
  await diag(b, 'start');
  await click(a, '#sample');
  await click(b, '#second');
  const activity = supervisor.store.session(sessionId).lastActivity;
  const first = await diag(a, 'read', {cursor, limit: 2});
  assert.equal(first.hasMore, true);
  assert.deepEqual(first.events.map(e => [e.sequence,e.severity,e.summary]), [[1,'warning','Component failed to render'],[2,'error',null]]);
  const rest = await diag(a, 'read', {cursor: first.nextCursor});
  assert.deepEqual(rest.events.map(e => e.sequence), [3,4,5,6,7,8]);
  assert(rest.events.slice(0, -1).every(e => e.kind === 'console' && e.summary === null));
  assert.equal(rest.events.at(-1).kind, 'pageerror');
  assert.equal(rest.events.at(-1).summary, 'TypeError');
  assert(!JSON.stringify([first, rest]).includes(marker));
  assert.deepEqual((await diag(b, 'read')).events.map(e => e.summary), ['Missing input']);
  assert.equal(supervisor.store.session(sessionId).lastActivity, activity);
  assert.equal((await raw(b, 'read', {cursor})).body.problem.code, 'stale_observation');
  assert.equal((await raw(a, 'read', {userId:'other'})).body.problem.code, 'session_owned');
  for (const invalid of [{limit:33},{limit:'2'},{cursor:'bad'},{action:'stop',limit:1},{includeStacks:true}])
    assert.equal((await raw(a, 'read', invalid)).body.problem.code, 'invalid_request');
  await tool('camofox_navigate', {tabId:a, url:fixtureUrl + '/next'});
  const next = await diag(a, 'read', {cursor:rest.nextCursor});
  assert.equal(next.events[0].summary, 'Page failed to load');
  assert.notEqual(next.events[0].documentId, first.events[0].documentId);
  await click(a, '#overflow');
  const overflow = await diag(a, 'read', {cursor, limit:1});
  assert.equal(overflow.evicted, 15);
  assert.equal(overflow.missed, 15);
  assert.equal(overflow.events[0].sequence, 16);
  console.log('PASS opted-in tabs, bounded primitive summaries, thrown error, cursor, eviction, ownership, idle polling and navigation');

  const viewer = await tool('camofox_session_viewer', {sessionId});
  assert.equal(viewer.humanControl, true);
  assert.equal((await raw(a, 'start')).body.problem.code, 'human_control');
  assert.equal((await raw(a, 'read')).body.problem.code, 'human_control');
  const connect = await post('/viewer/connect', {ticket:new URL(viewer.url).hash.slice(1)}, {origin:base});
  assert.equal(connect.status, 200);
  const closed = await post('/viewer/control', {action:'close'}, {origin:base, authorization:'Bearer ' + connect.body.capability});
  assert.equal(closed.status, 200);
  for (const tabId of [a,b]) assert.equal((await diag(tabId, 'read')).active, false);
  assert.equal((await raw(a, 'read', {cursor})).body.problem.code, 'stale_observation');
  await diag(a, 'start');
  await tool('camofox_session_suspend', {sessionId});
  await tool('camofox_session_resume', {sessionId});
  assert.equal((await diag(a, 'read')).active, false);
  await diag(a, 'start');
  await click(a, '#second');
  assert.equal((await diag(a, 'read')).events.length, 1);
  await tool('camofox_session_release', {sessionId});
  await tool('camofox_session_resume', {sessionId}, 'new-owner');
  const nextOwner = action => tool('camofox_tab_diagnostics', {tabId:a,action}, 'new-owner');
  assert.equal((await nextOwner('read')).active, false);
  await nextOwner('start');
  assert.equal((await nextOwner('stop')).active, false);
  const profileDir = join(stateDir,'profiles',profile.id);
  for (const name of ['worker.log','checkpoint.json']) {
    const data = readFileSync(join(profileDir,name),'utf8');
    assert(!data.includes(marker));
    assert(!data.includes('Component failed to render'));
  }
  console.log('PASS real human handoff, restoration, ownership release, explicit stop and absence from worker log/checkpoint');
} finally {
  await supervisor.close();
  for (const http of [server, fixture]) { http.closeAllConnections(); http.close(); }
  rmSync(stateDir,{recursive:true,force:true});
}
