import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkerVirtualDisplay } from '../../lib/platform/virtual-display.js';
import { startViewer } from '../../lib/platform/viewer-launcher.js';

const available = process.platform === 'linux' &&
  ['Xvfb', 'x11vnc', 'xwininfo', 'setpriv', 'python3'].every(n => existsSync('/usr/bin/' + n));
const CAPS = 0xffe5, SHIFT = 0xffe1, NUM = 0xff7f;

async function rfbClient(path) {
  const socket = connect(path);
  socket.setTimeout(5000, () => socket.destroy(new Error('RFB timeout')));
  let buffer = Buffer.alloc(0), failure, wake;
  socket.on('data', data => { buffer = Buffer.concat([buffer, data]); wake?.(); });
  socket.on('error', error => { failure = error; wake?.(); });
  socket.on('close', () => { failure ||= new Error('RFB closed'); wake?.(); });
  async function read(n) {
    while (buffer.length < n) {
      if (failure) throw failure;
      await new Promise(resolve => { wake = resolve; });
    }
    const data = buffer.subarray(0, n); buffer = buffer.subarray(n); return data;
  }
  try {
    assert.match((await read(12)).toString(), /^RFB /);
    socket.write('RFB 003.008\n');
    assert((await read((await read(1))[0])).includes(1));
    socket.write(Buffer.from([1])); assert.equal((await read(4)).readUInt32BE(), 0);
    socket.write(Buffer.from([1])); const init = await read(24); await read(init.readUInt32BE(20));
    socket.setTimeout(0);
    // Raw encoding; no framebuffer requests are needed to test native input.
    socket.write(Buffer.from([2, 0, 0, 1, 0, 0, 0, 0]));
    return {
      key(keysym, down) {
        const data = Buffer.alloc(8); data[0] = 4; data[1] = Number(down);
        data.writeUInt32BE(keysym, 4); socket.write(data);
      },
      tap(keysym) { this.key(keysym, true); this.key(keysym, false); },
      close() { socket.destroy(); },
    };
  } catch (error) { socket.destroy(); throw error; }
}

async function harness(t) {
  const stateDir = mkdtempSync(join(tmpdir(), 'cf-keyboard-'));
  const display = new WorkerVirtualDisplay(false, '640x480x24');
  let probe, viewer, client;
  t.after(async () => {
    client?.close(); await viewer?.stop();
    probe?.stdin.end(); display.kill(); rmSync(stateDir, { recursive: true, force: true });
  });
  const name = await display.get();
  probe = spawn('/usr/bin/python3', ['tests/platform/keyboard-probe.py', name], { stdio: ['pipe', 'pipe', 'pipe'] });
  let diagnostic = ''; probe.stderr.on('data', data => { diagnostic += data; });
  const lines = createInterface({ input: probe.stdout })[Symbol.asyncIterator]();
  async function response() {
    const { value, done } = await lines.next();
    assert(!done, `Keyboard probe exited: ${diagnostic}`); return JSON.parse(value);
  }
  assert((await response()).ready);
  const inspect = async (command = {}) => { probe.stdin.write(JSON.stringify(command) + '\n'); return response(); };
  async function open(mode) {
    client?.close(); await viewer?.stop();
    viewer = await startViewer(stateDir, '00000000-0000-4000-8000-000000000000', name, mode);
    client = await rfbClient(viewer.socket); return client;
  }
  async function characters(expected) {
    let text = '';
    for (let i = 0; i < 100; i++) {
      text += (await inspect()).events.map(e => e.text).join('');
      if (text.length >= expected.length) break;
      await delay(20);
    }
    assert.equal(text, expected);
  }
  return { inspect, open, characters, async stop() { client?.close(); await viewer?.stop(); } };
}

test('viewer delivers Caps Lock, Shift, punctuation and keypad characters', { skip: !available, timeout: 20000 }, async t => {
  const h = await harness(t), client = await h.open('control');
  client.tap(0x61); client.tap(CAPS); client.tap(0x41);
  client.key(SHIFT, true); client.tap(0x61); client.key(SHIFT, false);
  client.tap(CAPS); client.tap(0x61);
  await h.characters('aAaa');
  for (let i = 0; i < 3; i++) { client.tap(CAPS); client.tap(0x5a); client.tap(CAPS); client.tap(0x7a); }
  await h.characters('ZzZzZz');
  client.tap(CAPS); client.tap(0x31);
  client.key(SHIFT, true); client.tap(0x21); client.key(SHIFT, false);
  client.tap(CAPS); client.tap(0x2f);
  client.tap(NUM); client.tap(0xffb1); client.tap(NUM); client.tap(0xffb2);
  await h.characters('1!/12');
  assert.equal((await h.inspect()).locks, 0);
});

test('watch preserves locks; control clears stale locks and held keys across reopening', { skip: !available, timeout: 20000 }, async t => {
  const h = await harness(t);
  await h.inspect({ locks: 2 });
  let client = await h.open('watch');
  assert.equal((await h.inspect()).locks, 2);
  client.tap(CAPS); client.tap(0x41); client.key(SHIFT, true);
  await delay(150);
  let state = await h.inspect();
  assert.equal(state.events.length, 0); assert.equal(state.locks, 2); assert.equal(state.held, 0);
  await h.stop(); assert.equal((await h.inspect()).locks, 2);
  client = await h.open('control');
  state = await h.inspect(); assert.equal(state.locks, 0); assert.equal(state.held, 0);
  // Caps Lock was already enabled locally before taking control: no toggle precedes A.
  client.tap(0x41); await h.characters('A');
  client.key(SHIFT, true); await delay(150);
  assert.notEqual((await h.inspect()).held, 0);
  await h.inspect({ locks: 2 }); await h.stop();
  state = await h.inspect(); assert.equal(state.locks, 0); assert.equal(state.held, 0);
  await h.open('watch'); assert.equal((await h.inspect()).locks, 0);
  client = await h.open('control'); client.tap(0x41); client.tap(0x61);
  await h.characters('Aa');
});
