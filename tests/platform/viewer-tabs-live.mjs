// Isolated browser + real noVNC UI acceptance. Only the installed browser cache
// is shared. Add --desktop to also exercise the native GTK shell via AT-SPI.
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { firefox } from 'playwright-core';
import express from 'express';
import { Supervisor } from '../../lib/platform/supervisor.js';
import { installViewer } from '../../lib/platform/viewer.js';
import { startViewer, startDesktop } from '../../lib/platform/viewer-launcher.js';
import { workerJson } from '../../lib/platform/worker-launcher.js';
import { loadPlatformConfig } from '../../lib/config.js';

assert(process.argv[2], 'Pass the installed browser cache');
const cache = resolve(process.argv[2]), stateDir = mkdtempSync(join(tmpdir(), 'camofox-tabs-live-'));
symlinkSync(cache, join(stateDir, 'cache'));
const config = { ...loadPlatformConfig(), stateDir }, supervisor = new Supervisor(config, {});
const fixture = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  const name = req.url.slice(1);
  res.end(`<!doctype html><title>Tabs ${name}</title><style>body{background:${name === 'A' ? '#235a43' : name === 'B' ? '#6b3246' : '#224d80'};color:white;font:28px sans-serif;padding:50px}</style><h1>Tabs ${name}</h1><input aria-label="Draft"><button onclick="window.open('/Popup')">Popup</button>`);
});
await new Promise(r => fixture.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${fixture.address().port}`;
const app = express(); app.use(express.json()); const server = createServer(app);
await new Promise(r => server.listen(0, '127.0.0.1', r)); config.port = server.address().port;
const origin = `http://127.0.0.1:${config.port}`;
let desktopUrl, nativeShell = false;
const open = installViewer(app, server, supervisor, config, {
  startViewer,
  startDesktop: (...args) => {
    if (nativeShell) return startDesktop(...args);
    desktopUrl = args[1]; return { present() {}, close() {} };
  },
});
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message, code: err.code }));
const profile = supervisor.store.createProfile('Isolated tab viewer');
const session = supervisor.store.createSession(profile.id, 'Control handoff acceptance · Tabs', 'tabs-test');
const id = session.id, owner = session.owner;
const internal = (path, body) => workerJson(supervisor.workers.get(id).socket, supervisor.config.workerKey, body ? 'POST' : 'GET', path, body);
async function call(method, path, body) {
  const url = new URL(path, 'http://worker'); url.searchParams.set('userId', id);
  const response = await supervisor.proxy(id, owner, method, url.pathname + url.search, body ? { ...body, userId: id, sessionKey: 'default' } : undefined);
  if (response.type?.startsWith('image/')) return response.bytes;
  const r = JSON.parse(response.bytes.toString());
  assert(response.status < 400, JSON.stringify(r));
  if (r.pending) {
    await until(() => ['completed', 'failed', 'cancelled', 'outcome_unknown'].includes(supervisor.operations.status(r.operation.id, owner).operation.state));
    const result = supervisor.operations.status(r.operation.id, owner);
    assert.equal(result.operation.state, 'completed'); return result.result;
  }
  return r;
}
async function until(predicate, message = 'State did not settle') {
  for (let i = 0; i < 150; i++) { if (await predicate()) return; await delay(100); }
  throw Error(message);
}
const exec = promisify(execFile);
const connected = () => supervisor.workers.get(id)?.viewer?.state === 'connected';
const selected = (page, tabId) => page.locator(`[data-tab-id="${tabId}"][aria-selected="true"]`).count();
let browser, page;
const selectionResults = [];
try {
  await supervisor.resume(id, owner);
  const a = await call('POST', '/tabs', { url: base + '/A' });
  const b = await call('POST', '/tabs', { url: base + '/B' });
  const c = await call('POST', '/tabs', { url: base + '/C' });
  assert(a.tabId && b.tabId && c.tabId);
  const { display } = await internal('/internal/display');
  const front = async () => (await exec('/usr/bin/xwininfo', ['-display', display, '-root', '-tree'])).stdout.split('\n').find(line => line.includes('Navigator')) || '';
  const binRoot = join(cache, 'camoufox/browsers/official');
  const installed = readdirSync(binRoot).find(name => name.startsWith('156.0.1-beta.36-'));
  assert(installed, 'Pinned browser missing');
  browser = await firefox.launch({ executablePath: join(binRoot, installed, 'camoufox-bin'), headless: true });
  page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => { if (response.url().endsWith('/viewer/tabs') && response.request().postDataJSON()?.action === 'select') selectionResults.push({ status: response.status(), body: await response.json().catch(() => null) }); });
  await open.watch(id, owner, true); await page.goto(desktopUrl); await until(connected);
  await until(async () => await page.getByRole('tab').count() === 3);
  assert.equal(await page.getByRole('tab', { name: 'Tabs A', exact: true }).isDisabled(), true);
  await until(() => selected(page, c.tabId));
  await call('GET', `/tabs/${a.tabId}/snapshot`); await until(() => selected(page, a.tabId));
  const before = supervisor.store.session(id).lastActivity;
  await delay(2200); assert.equal(supervisor.store.session(id).lastActivity, before, 'Passive tab polling renewed idle activity');
  const geometry = (await call('POST', `/tabs/${a.tabId}/evaluate`, { expression: '({width:innerWidth,height:innerHeight})' })).result;
  await page.setViewportSize({ width: 360, height: 560 });
  await call('POST', `/tabs/${b.tabId}/evaluate`, { expression: 'document.title="A deliberately long tab title for horizontal overflow";true' });
  await until(async () => (await page.locator('#tabs').evaluate(el => el.scrollWidth > el.clientWidth)));
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.getByRole('button', { name: 'Take control', exact: true }).click();
  await until(() => connected() && supervisor.workers.get(id).humanControl);
  await until(async () => !await page.getByRole('tab', { name: 'Tabs A', exact: true }).isDisabled());
  await page.getByRole('tab', { name: 'Tabs A', exact: true }).click(); await until(() => selected(page, a.tabId));
  const tabA = page.getByRole('tab', { name: 'Tabs A', exact: true });
  await until(async () => await tabA.isEnabled());
  await tabA.focus(); await page.keyboard.press('End');
  assert.equal(await page.locator(':focus').getAttribute('data-tab-id'), c.tabId);
  await page.keyboard.press('Enter'); await until(() => selected(page, c.tabId));
  assert.equal((await internal('/internal/viewer-tabs')).activeTabId, c.tabId);
  await until(async () => (await front()).includes('Tabs C'), 'Selected tab was not raised in the native viewer');
  await call('GET', `/tabs/${a.tabId}/snapshot`); await call('GET', `/tabs/${a.tabId}/screenshot`);
  assert.equal((await internal('/internal/viewer-tabs')).activeTabId, c.tabId, 'Agent observations stole human focus');
  await until(async () => page.locator('#screen canvas').evaluate(canvas => {
    const pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    return Math.abs(pixel[0] - 34) < 5 && Math.abs(pixel[1] - 77) < 5 && Math.abs(pixel[2] - 128) < 5;
  }), 'Streamed pixels did not show selected tab C');
  if (process.env.CAMOFOX_ACCEPTANCE_DIR) {
    mkdirSync(process.env.CAMOFOX_ACCEPTANCE_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.CAMOFOX_ACCEPTANCE_DIR, 'tabs-control.png') });
  }
  await page.getByRole('button', { name: 'Return to agent', exact: true }).click(); await until(() => connected() && !supervisor.workers.get(id).humanControl);
  await call('GET', `/tabs/${a.tabId}/snapshot`); await until(() => selected(page, a.tabId));
  assert.deepEqual((await call('POST', `/tabs/${a.tabId}/evaluate`, { expression: '({width:innerWidth,height:innerHeight})' })).result, geometry);
  await call('POST', `/tabs/${a.tabId}/evaluate`, { expression: 'document.title="<b>literal title</b>";true' });
  await until(async () => await page.getByRole('tab', { name: '<b>literal title</b>', exact: true }).count());
  assert.equal(await page.locator('#tabs b').count(), 0);
  await call('POST', `/tabs/${a.tabId}/click`, { selector: 'button' });
  await until(async () => await page.getByRole('tab', { name: 'Tabs Popup', exact: true }).count());
  const popup = (await internal('/internal/viewer-tabs')).tabs.find(tab => tab.title === 'Tabs Popup');
  await call('DELETE', `/tabs/${popup.id}`); await until(async () => !await page.getByRole('tab', { name: 'Tabs Popup', exact: true }).count());
  await page.getByRole('button', { name: 'Stop', exact: true }).click(); await until(() => supervisor.store.session(id).automationPaused);
  await page.getByRole('button', { name: 'Resume automation', exact: true }).click(); await until(() => !supervisor.store.session(id).automationPaused);
  const give = open.control(id, owner, 'give');
  await page.getByRole('button', { name: 'Accept control', exact: true }).click(); assert.equal((await give).outcome, 'accepted'); await until(connected);
  await until(async () => !await page.getByRole('tab', { name: 'Tabs C', exact: true }).isDisabled());
  await page.getByRole('tab', { name: 'Tabs C', exact: true }).click(); await until(() => selected(page, c.tabId));
  await open.watch(id, owner, false);
  await supervisor.suspend(id, owner); await supervisor.resume(id, owner);
  const restored = await internal('/internal/viewer-tabs');
  assert.deepEqual(restored.tabs.map(tab => tab.id), [a.tabId, b.tabId, c.tabId]); assert.equal(restored.activeTabId, c.tabId);
  const link = await open(id, owner); await page.goto('about:blank'); await page.goto(link.url); await until(connected);
  await until(async () => await page.getByRole('tab', { name: 'Tabs C', exact: true }).isEnabled());
  await page.getByRole('tab', { name: 'Tabs A', exact: true }).click(); await until(() => selected(page, a.tabId));
  await page.getByRole('button', { name: 'Close', exact: true }).click(); await until(() => !supervisor.workers.get(id).viewer);
  assert.deepEqual(errors, []);
  console.log('PASS real noVNC: three tabs, automatic following, idle preservation, overflow, keyboard selection, human focus, scaling, safe titles, popups/closure, Stop/Resume, handoff, restore and login-link tabs');

  if (process.argv.includes('--desktop')) {
    nativeShell = true; await open.watch(id, owner, true); await until(connected);
    const activate = async label => (await exec('/usr/bin/python3', ['tests/platform/control-ui.py', label, String(supervisor.workers.get(id).viewer.desktop.child.pid)])).stdout;
    const tree = await activate('inspect'); assert(tree.includes('Tabs A') && tree.includes('Tabs B') && tree.includes('Tabs C'), tree);
    await activate('Take control'); await until(() => connected() && supervisor.workers.get(id).humanControl);
    await activate('Tabs B'); await until(async () => (await internal('/internal/viewer-tabs')).activeTabId === b.tabId);
    await activate('Return to agent'); await until(() => connected() && !supervisor.workers.get(id).humanControl);
    await call('GET', `/tabs/${c.tabId}/snapshot`);
    await open.watch(id, owner, false);
    console.log('PASS visible GTK: tab labels, takeover, tab selection, return and agent follow');
  }
} catch (error) {
  if (page && !page.isClosed()) {
    console.error('Selections:', selectionResults);
    console.error('Viewer diagnostics:', await page.locator('#tab-section').innerText().catch(() => ''), await page.locator('#status').innerText().catch(() => ''));
    console.error('Tab controls:', await page.locator('#tabs button').evaluateAll(nodes => nodes.map(n => ({ label: n.textContent, disabled: n.disabled, selected: n.getAttribute('aria-selected'), focused: n === document.activeElement }))).catch(() => []));
    if (process.env.CAMOFOX_ACCEPTANCE_DIR) await page.screenshot({ path: join(process.env.CAMOFOX_ACCEPTANCE_DIR, 'tabs-failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close(); await supervisor.close();
  server.closeAllConnections(); await new Promise(r => server.close(r));
  fixture.closeAllConnections(); await new Promise(r => fixture.close(r));
  rmSync(stateDir, { recursive: true, force: true });
}
