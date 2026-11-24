// Run with a compatible installed cache root. All browser state is disposable.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadPlatformConfig } from '../../lib/config.js';
import { installPlatformRoutes } from '../../lib/platform/routes.js';
import { Supervisor } from '../../lib/platform/supervisor.js';
import { workerJson } from '../../lib/platform/worker-launcher.js';
import { terminalOperation } from '../../mcp/lib/operation-contracts.mjs';
import { applicationProblem } from '../../mcp/lib/problems.mjs';

const article = '<article id="story"><h1>Trail notes</h1><p>Read the <a href="../map">map</a> today.</p>' +
  '<ol><li>Pack</li><li>Walk<ul><li>North</li></ul></li></ol>' +
  '<table><tr><th>Trail</th><th>Miles</th></tr><tr><td>A|B</td><td>3</td></tr></table>' +
  '<pre><code>if (ready) {\n  go();\n}</code></pre><span hidden>PRIVATE hidden</span>' +
  '<span style="display:none">PRIVATE css</span><input type="password" value="PRIVATE password">' +
  '<textarea>PRIVATE textarea</textarea><div contenteditable>PRIVATE editor</div>' +
  '<output>PRIVATE calculated value</output><p role="status">Guide ready</p>' +
  '<a href="javascript:void(0)">Plain</a><a href="/unrequested">Reference</a>' +
  '<script type="application/json">"PRIVATE script"</script><template><img src="/unrequested"></template></article>';
const origin = server => 'http://127.0.0.1:' + server.address().port;
const listen = server => new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
const cache = resolve(process.argv[2]);
const stateDir = await mkdtemp(join(tmpdir(), 'camofox-markdown-'));
const servers = [];
let supervisor;
async function serve(handler) {
  const server = createServer(handler);
  servers.push(server);
  await listen(server);
  return origin(server);
}
const userId = 'markdown-fixture';
const client = new Client({ name: userId, version: '1' });
let unexpectedRequests = 0;
let imageRequests = 0;
try {
  await symlink(cache, join(stateDir, 'cache'));
  const child = await serve((req, res) => {
    if (req.url === '/unrequested') unexpectedRequests++;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html>' + article);
  });
  const site = await serve((req, res) => {
    if (req.url === '/unrequested') unexpectedRequests++;
    if (req.url === '/illustration.svg') {
      imageRequests++;
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><nav>PRIVATE navigation</nav><p>Outside story</p>' + article +
      '<section id="huge">' + '🍏'.repeat(40000) + '</section><div hidden><span id="hidden">PRIVATE ancestor</span></div>' +
      '<iframe id="child" name="guide" src="' + child + '/trail/index"></iframe><img src="/illustration.svg">' +
      '<div id="deep">' + '<div>'.repeat(70) + 'Deep tail' + '</div>'.repeat(70) + '</div>' +
      '<div id="nodes">' + '<!--n-->'.repeat(10001) + 'Unvisited tail</div>' +
      '<p id="source">' + ' '.repeat(256001) + 'Unvisited tail</p>' +
      '<a id="long-link" href="/' + 'a'.repeat(2050) + '">Long link</a>' +
      '<table id="nested"><tr><td>Outer<table><tr><td>Inner</td></tr></table></td></tr></table>');
  });
  const config = { ...loadPlatformConfig(), stateDir };
  supervisor = new Supervisor(config, {});
  const profile = supervisor.store.createProfile('Markdown fixture');
  const session = supervisor.store.createSession(profile.id, 'Disposable fixture', userId);
  const app = express();
  app.use(express.json());
  installPlatformRoutes(app, supervisor, config, () => {});
  app.use((err, req, res, next) => {
    const problem = applicationProblem(err);
    res.status(problem.status).json({ error: problem.detail, code: problem.code, problem });
  });
  const base = await serve(app);
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ['mcp/server.mjs'], stderr: 'pipe',
    env: { PATH: process.env.PATH, HOME: stateDir, CAMOFOX_BASE_URL: base, CAMOFOX_USER_ID: userId },
  }));
  const catalogue = await client.listTools();
  assert.equal(catalogue.tools.find(tool => tool.name === 'camofox_read_markdown').annotations.readOnlyHint, true);
  const post = async (path, args, owner = userId) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...args, userId: owner }) });
    return { status: res.status, body: await res.json() };
  };

  await supervisor.resume(session.id, userId);
  let { body: opened } = await post('/tabs', { sessionId: session.id, url: site + '/trail/index' });
  if (opened.pending) {
    const path = base + '/operations/' + opened.operation.id + '?userId=' + userId;
    for (let i = 0; i < 200; i++) {
      const status = await (await fetch(path)).json();
      if (terminalOperation(status.operation.state)) { opened = status.result; break; }
      await delay(100);
    }
  }
  const tabId = opened.tabId;
  assert.ok(tabId, JSON.stringify(opened));
  const path = '/tabs/' + tabId + '/read-markdown';
  assert.equal(imageRequests, 1);
  const navigationRequests = unexpectedRequests;
  const read = async args => {
    const { body, status } = await post(path, args);
    assert.equal(status, 200, JSON.stringify(body));
    return body;
  };
  const story = await read({ selector: '#story' });
  assert.deepEqual(story.frame, { main: true, origin: site, name: '' });
  assert.deepEqual(story.omissions, []);
  assert.equal(story.truncated, false);
  assert.match(story.markdown, /^# Trail notes\n\nRead the \[map\]/);
  assert.ok(story.markdown.includes('](' + site + '/map) today'));
  assert.match(story.markdown, /1\. Pack\n2\. Walk\n    - North/);
  assert.match(story.markdown, /\| Trail \| Miles \|\n\| --- \| --- \|\n\| A\\\|B \| 3 \|/);
  assert.match(story.markdown, /    if \(ready\) \{\n      go\(\);\n    \}/);
  assert.doesNotMatch(story.markdown, /PRIVATE|Outside story|javascript:/);
  assert.match(story.markdown, /Guide ready/);
  assert.deepEqual(await read({ selector: '#story' }), story);
  const full = await read({});
  assert.match(full.markdown, /Outside story/);
  assert.doesNotMatch(full.markdown, /PRIVATE/);
  assert.equal(full.truncated, true);
  assert.ok(full.markdown.length <= 16000);
  assert.deepEqual(full.omissions, ['character_budget']);
  const tiny = await read({ selector: '#huge', maxChars: 5 });
  assert.equal(tiny.markdown, '🍏🍏');
  assert.deepEqual(tiny.omissions, ['character_budget']);
  assert.equal((await read({ selector: '#hidden' })).markdown, '');
  for (const [id, reason] of [['deep', 'depth_limit'], ['nodes', 'node_limit'], ['source', 'source_limit'],
    ['long-link', 'link_limit'], ['nested', 'nested_table']]) {
    const limited = await read({ selector: '#' + id });
    assert.deepEqual(limited.omissions, [reason]);
    assert.equal(limited.truncated, true);
    assert.doesNotMatch(limited.markdown, /Deep tail|Unvisited tail|Inner/);
  }

  const frameArgs = { frameSelector: '#child', selector: '#story', maxChars: 2000 };
  const framed = await read(frameArgs);
  assert.deepEqual(framed.frame, { main: false, name: 'guide', origin: child });
  assert.equal(framed.markdown, story.markdown.replaceAll(site, child));
  const heading = await read({ frameSelector: '#child', selector: '#story h1', maxChars: 200 });
  assert.deepEqual(heading, { frame: framed.frame, markdown: '# Trail notes', truncated: false, omissions: [] });
  const invoke = args => client.callTool({ name: 'camofox_read_markdown', arguments: { tabId, ...args } });
  const adapter = await invoke(frameArgs);
  assert.ok(!adapter.isError, JSON.stringify(adapter.content));
  assert.deepEqual(adapter.structuredContent, framed);
  const missing = await invoke({ selector: '#absent' });
  assert.ok(missing.isError);
  assert.equal(missing.structuredContent.problem.code, 'invalid_target');
  for (const [args, code] of [
    [{ selector: '[' }, 'invalid_selector'], [{ selector: '#absent' }, 'invalid_target'],
    [{ selector: 'p' }, 'ambiguous_target'], [{ frameSelector: '#absent' }, 'invalid_target'],
    [{ maxChars: 64001 }, 'invalid_request'], [{ maxChars: '8' }, 'invalid_request'], [{ fields: ['value'] }, 'invalid_request'],
  ]) assert.equal((await post(path, args)).body.problem.code, code);
  assert.equal((await post(path, {}, 'other-owner')).body.problem.code, 'session_owned');
  const worker = supervisor.workers.get(session.id);
  worker.humanControl = true;
  await workerJson(worker.socket, supervisor.config.workerKey, 'POST', '/internal/viewer-mode', { humanControl: true });
  assert.deepEqual(await read({ selector: '#story' }), story);
  assert.equal(unexpectedRequests, navigationRequests, 'Markdown reads must not request a link or embedded resource');
  assert.equal(imageRequests, 1);
  console.log('PASS Markdown structure, safe region, truncation, frame, MCP parity, errors, ownership, human control and zero embedded/link fetches');
} finally {
  await client.close();
  await supervisor?.close();
  await Promise.all(servers.map(server => new Promise(ok => server.close(ok))));
  await rm(stateDir, { recursive: true, force: true });
}
