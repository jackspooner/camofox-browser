import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { startViewer } from '../../lib/platform/viewer-launcher.js';
import { WorkerVirtualDisplay } from '../../lib/platform/virtual-display.js';

const session = '00000000-0000-4000-8000-000000000000';
const available = process.platform === 'linux' && ['Xvfb', 'x11vnc', 'setpriv', 'xwininfo'].every(n => existsSync('/usr/bin/' + n));
const alive = pid => { try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] !== 'Z'; } catch { return false; } };
async function eventually(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await delay(50); }
  assert(check(), 'Condition did not settle');
}

test('abstract-only worker display cleanup never unlinks a shared display file', async t => {
  const v = new WorkerVirtualDisplay();
  let killed;
  v.proc = { exitCode: null, signalCode: null, kill: signal => { killed = signal; } };
  // A non-number cannot address a real X display. Sentinel proves neither
  // inherited cleanup nor our wrapper deletes files based on display name.
  const name = `camofox-test-${process.pid}`;
  const sentinel = `/tmp/.X${name}-lock`;
  writeFileSync(sentinel, 'other display');
  t.after(() => rmSync(sentinel, { force: true }));
  v._display = name;
  v.kill(); v.kill();
  assert.equal(killed, 'SIGKILL');
  assert.equal(readFileSync(sentinel, 'utf8'), 'other display');
  assert(v.xvfbArgs.join(' ').includes('-nolisten unix'));
});

test('real backend: readiness, modes, EOF cleanup, missing display and helper', { skip: !available }, async t => {
  const state = mkdtempSync(join(tmpdir(), 'cf-viewer-'));
  const display = new WorkerVirtualDisplay(false, '640x480x24');
  t.after(() => { display.kill(); rmSync(state, { recursive: true, force: true }); });
  const name = await display.get();
  for (const mode of ['watch', 'control']) {
    const v = await startViewer(state, session, name, mode);
    const socket = connect(v.socket);
    const [greeting] = await once(socket, 'data'); socket.destroy();
    assert.match(greeting.toString(), /^RFB /);
    await v.stop(); await v.stop();
    assert.equal(existsSync(v.socket), false);
    assert.equal(alive(v.child.pid), false);
  }
  await assert.rejects(startViewer(state, session, ':99999', 'watch'), { code: 'viewer_failed', statusCode: 503 });
  for (const diagnostic of ['missing helper', 'Unknown helper operation']) {
    let calls = 0;
    const fakeHelper = (command, args, opts) => {
      calls++;
      assert.equal(command, 'sudo');
      assert.deepEqual(args.slice(0, 4), ['-n', '/fixed/helper', 'viewer', 'cf-1000-000000000000']);
      return spawn(process.execPath, ['-e', `console.error(${JSON.stringify(diagnostic)});process.exit(1)`], opts);
    };
    await assert.rejects(startViewer(state, session, name, 'watch', { namespace: 'cf-1000-000000000000', helper: '/fixed/helper' }, fakeHelper), { code: 'viewer_failed' });
    assert.equal(calls, 1, 'No fallback launch');
  }
});

test('startup cancellation and runner death leave no VNC process', { skip: !available }, async t => {
  const state = mkdtempSync(join(tmpdir(), 'cf-death-'));
  const display = new WorkerVirtualDisplay(false, '320x240x24');
  t.after(() => { display.kill(); rmSync(state, { recursive: true, force: true }); });
  const name = await display.get();
  const abort = new AbortController(); abort.abort();
  await assert.rejects(startViewer(state, session, name, 'watch', { signal: abort.signal }), /closed during startup/);
  const v = await startViewer(state, session, name, 'watch');
  const children = readFileSync(`/proc/${v.child.pid}/task/${v.child.pid}/children`, 'utf8').trim().split(/\s+/).map(Number);
  assert(children.length && children.every(alive));
  v.child.kill('SIGKILL');
  await once(v.child, 'close');
  await eventually(() => children.every(pid => !alive(pid)) && !existsSync(v.socket));
});

test('VNC failure is observed and startup has a bounded deadline', { skip: !available }, async t => {
  const state = mkdtempSync(join(tmpdir(), 'cf-failure-'));
  const display = new WorkerVirtualDisplay(false, '320x240x24');
  t.after(() => { display.kill(); rmSync(state, { recursive: true, force: true }); });
  const name = await display.get();
  const v = await startViewer(state, session, name, 'watch');
  const [pid] = readFileSync(`/proc/${v.child.pid}/task/${v.child.pid}/children`, 'utf8').trim().split(/\s+/).map(Number);
  process.kill(pid, 'SIGKILL');
  await once(v.child, 'close');
  assert.equal(existsSync(v.socket), false);
  assert.equal(v.child.exitCode, 1);
  let stalled;
  const stall = (_command, _args, options) => stalled = spawn(process.execPath, ['-e', "process.stdin.resume();process.stdin.on('end',()=>process.exit(0))"], options);
  const start = Date.now();
  await assert.rejects(startViewer(state, session, name, 'watch', {}, stall), { code: 'viewer_failed' });
  assert(Date.now() - start >= 11500);
  assert.equal(alive(stalled.pid), false);
});

test('gateway death closes the runner lifetime pipe', { skip: !available }, async t => {
  const state = mkdtempSync(join(tmpdir(), 'cf-parent-'));
  const display = new WorkerVirtualDisplay(false, '320x240x24');
  t.after(() => { display.kill(); rmSync(state, { recursive: true, force: true }); });
  const name = await display.get();
  const parent = spawn(process.execPath, ['--input-type=module', '-e', `
    import {startViewer} from './lib/platform/viewer-launcher.js';
    const v=await startViewer(${JSON.stringify(state)},${JSON.stringify(session)},${JSON.stringify(name)},'watch');
    console.log(JSON.stringify({pid:v.child.pid,socket:v.socket}));
    setInterval(()=>{},1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => parent.kill('SIGKILL'));
  const [output] = await once(parent.stdout, 'data');
  const runner = JSON.parse(output.toString());
  parent.kill('SIGKILL'); await once(parent, 'close');
  await eventually(() => !alive(runner.pid) && !existsSync(runner.socket));
});
