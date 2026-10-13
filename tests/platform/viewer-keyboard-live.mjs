// Real noVNC + GTK/WebKit input into Camoufox, all on disposable displays/profiles.
// Pass an existing browser install directory; this test never downloads a browser.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { Supervisor } from '../../lib/platform/supervisor.js';
import { installViewer } from '../../lib/platform/viewer.js';
import { startDesktop } from '../../lib/platform/viewer-launcher.js';
import { workerJson } from '../../lib/platform/worker-launcher.js';
import { WorkerVirtualDisplay } from '../../lib/platform/virtual-display.js';
import { loadPlatformConfig } from '../../lib/config.js';

assert(process.argv[2], 'Pass an existing Camoufox install directory');
const browserDir = resolve(process.argv[2]);
for (const file of ['.0.5_FLAG', 'camoufox-bin', 'version.json', 'properties.json', 'fpgen'])
  assert(existsSync(join(browserDir, file)), `Existing browser resource required: ${file}`);
const exec = promisify(execFile);
const stateDir = mkdtempSync(join(tmpdir(), 'cf-keyboard-live-'));
const outerDisplay = new WorkerVirtualDisplay(false, '1280x900x24');
let supervisor, probe, loginDesktop, gateway, fixture;
try {
  const display = await outerDisplay.get();
  // The launcher discovers through XDG_CACHE_HOME. Keep generated font caches
  // local and expose only the installed browser resources; never download.
  const cache = join(stateDir, 'cache', 'camoufox'); mkdirSync(cache, { recursive: true });
  for (const file of readdirSync(browserDir).filter(file => file !== 'fontconfig'))
    symlinkSync(join(browserDir, file), join(cache, file));
  const config = { ...loadPlatformConfig(), stateDir, browserDir };
  config.desktopEnv = { ...config.desktopEnv, DISPLAY: display, GDK_BACKEND: 'x11', XDG_SESSION_TYPE: 'x11' };
  delete config.desktopEnv.WAYLAND_DISPLAY; delete config.desktopEnv.XAUTHORITY;
  supervisor = new Supervisor(config, {});
  fixture = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><meta charset="utf-8"><title>Caps Lock acceptance</title><textarea autofocus style="position:fixed;inset:0;width:100%;height:100%;font:30px monospace"></textarea>');
  });
  await new Promise(r => fixture.listen(0, '127.0.0.1', r));
  const app = express(); app.use(express.json()); gateway = createServer(app);
  await new Promise(r => gateway.listen(0, '127.0.0.1', r)); config.port = gateway.address().port;
  const openViewer = installViewer(app, gateway, supervisor, config);
  app.use((e, _req, res, _next) => res.status(e.statusCode || 500).json({ code: e.code, error: e.message }));
  const profile = supervisor.store.createProfile('Caps Lock disposable');
  const session = supervisor.store.createSession(profile.id, 'Control handoff acceptance Caps Lock', 'keyboard-test');
  await supervisor.resume(session.id, 'keyboard-test');
  const worker = supervisor.workers.get(session.id);
  const call = (method, path, body) => workerJson(worker.socket, supervisor.config.workerKey, method, path,
    method === 'GET' ? undefined : { userId: session.id, ...body });
  const tab = await call('POST', '/tabs', { sessionKey: 'default', url: `http://127.0.0.1:${fixture.address().port}` });
  await call('GET', `/tabs/${tab.tabId}/snapshot?userId=${session.id}`);
  const evaluate = async expression => (await call('POST', `/tabs/${tab.tabId}/evaluate`, { expression })).result;
  // Direct worker reads inspect fixture state during human control; no input is injected this way.
  async function waitFor(predicate, label) {
    for (let i = 0; i < 100; i++) { if (await predicate()) return; await delay(100); }
    throw Error(`Timed out: ${label}`);
  }
  probe = spawn('/usr/bin/python3', ['tests/platform/keyboard-probe.py', display, '--input-only'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: probe.stdout })[Symbol.asyncIterator]();
  assert(JSON.parse((await lines.next()).value).ready);
  async function input(command) {
    probe.stdin.write(JSON.stringify(command) + '\n');
    const { value, done } = await lines.next(); assert(!done, 'Native input helper exited');
    return JSON.parse(value);
  }
  async function key(symbol, down) { await input({ keys: [[symbol, down]] }); await delay(40); }
  async function tap(symbol) { await key(symbol, true); await key(symbol, false); }
  async function focusCanvas() {
    const { stdout } = await exec('/usr/bin/xwininfo', ['-display', display, '-root', '-tree'], { env: config.desktopEnv });
    const window = stdout.match(/(0x[0-9a-f]+) "[^"]*Control handoff acceptance/);
    assert(window, 'Isolated GTK viewer window not found');
    await input({ focus: parseInt(window[1], 16), click: [600, 400] }); await delay(500);
  }
  async function button(label, pid) {
    await exec('/usr/bin/python3', ['tests/platform/control-ui.py', label, String(pid)]);
  }
  const connected = () => worker.viewer?.state === 'connected';
  async function sequence() {
    await focusCanvas();
    await tap(0x61); await tap(0xffe5); await tap(0x61);
    await key(0xffe1, true); await tap(0x61); await key(0xffe1, false);
    await tap(0xffe5); await tap(0x61);
  }
  await openViewer.watch(session.id, 'keyboard-test', true);
  await waitFor(connected, 'watch connection');
  let readyCount = 0;
  createInterface({ input: worker.viewer.desktop.child.stdout }).on('line', line => { if (line === 'ready') readyCount++; });
  await button('Take control', worker.viewer.desktop.child.pid);
  await waitFor(() => connected() && worker.viewer.mode === 'control' && readyCount === 1, 'takeover');
  await sequence();
  await waitFor(async () => await evaluate('document.querySelector("textarea").value') === 'aAaa', 'desktop Caps Lock sequence');
  await button('Return to agent', worker.viewer.desktop.child.pid);
  await waitFor(() => connected() && worker.viewer.mode === 'watch' && readyCount === 2, 'return to agent');
  // Change Caps Lock outside the viewer, then enter with it already enabled.
  await input({ locks: 2 });
  await button('Take control', worker.viewer.desktop.child.pid);
  await waitFor(() => connected() && worker.viewer.mode === 'control' && readyCount === 3, 'second takeover');
  await focusCanvas(); await tap(0x61);
  await waitFor(async () => await evaluate('document.querySelector("textarea").value') === 'aAaaA', 'pre-enabled Caps Lock');
  await openViewer.watch(session.id, 'keyboard-test', false);
  await input({ locks: 0 });
  await evaluate('document.querySelector("textarea").value=""');
  const login = await openViewer(session.id, 'keyboard-test');
  loginDesktop = await startDesktop(config, login.url, 'Control handoff acceptance login', () => {});
  await waitFor(connected, 'login connection');
  await sequence();
  await waitFor(async () => await evaluate('document.querySelector("textarea").value') === 'aAaa', 'login Caps Lock sequence');
  console.log('PASS real GTK/WebKit + noVNC + Camoufox: Caps Lock, Shift, pre-enabled lock, control handoffs, login viewer');
} catch (error) {
  // These are disposable test profiles, never production logs or credentials.
  for (const profile of existsSync(join(stateDir, 'profiles')) ? readdirSync(join(stateDir, 'profiles')) : []) {
    try { console.error(readFileSync(join(stateDir, 'profiles', profile, 'worker.log'), 'utf8').slice(-12000)); }
    catch { /* A failed launch may not have created a log. */ }
  }
  throw error;
} finally {
  loginDesktop?.close(); probe?.stdin.end();
  await supervisor?.close();
  if (gateway) { gateway.closeAllConnections(); await new Promise(r => gateway.close(r)); }
  if (fixture) { fixture.closeAllConnections(); await new Promise(r => fixture.close(r)); }
  outerDisplay.kill(); rmSync(stateDir, { recursive: true, force: true });
}
