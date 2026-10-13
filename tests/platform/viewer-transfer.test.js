import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { harness } from './helpers/viewer-harness.js';

const version = Buffer.from('RFB 003.008\n');
const init = Buffer.alloc(24); init.writeUInt16BE(1280, 0); init.writeUInt16BE(720, 2);
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await delay(5); }
  assert.fail('Timed out waiting for transport state');
}
async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cf-transfer-')), socket = join(dir, 'vnc.sock');
  const peers = [];
  const vnc = createServer(peer => {
    peers.push(peer); peer.input = []; peer.phase = 0;
    peer.on('error', () => {});
    peer.on('data', data => {
      if (peer.phase++ === 0) { assert.deepEqual(data, version); peer.write(Buffer.from([1, 1])); }
      else if (peer.phase === 2) { assert.deepEqual(data, Buffer.from([1])); peer.write(Buffer.alloc(4)); }
      else if (peer.phase === 3) {
        assert.deepEqual(data, Buffer.from([1]));
        if (!options.stall || peers.length === 1) peer.write(init);
      } else peer.input.push(data);
    });
    peer.write(version);
  });
  await new Promise(r => vnc.listen(socket, r));
  t.after(async () => { for (const peer of peers) peer.destroy(); await new Promise(r => vnc.close(r)); rmSync(dir, { recursive: true, force: true }); });
  const h = await harness(t, { socket });
  const clients = [];
  t.after(() => clients.forEach(ws => ws.terminate()));
  async function connection(state, auto = true) {
    const ws = new WebSocket(h.origin.replace('http:', 'ws:') + '/viewer/socket?ticket=' + state.socketTicket, { origin: h.origin });
    clients.push(ws); ws.messages = []; ws.on('error', () => {});
    ws.on('message', data => {
      ws.messages.push(data);
      if (!auto) return;
      const n = ws.messages.length;
      if (n === 1) ws.send(version);
      else if (n === 2) ws.send(Buffer.from([1]));
      else if (n === 3) ws.send(Buffer.from([1]));
    });
    await once(ws, 'open');
    if (auto && (!options.stall || clients.length === 1)) await until(() => ws.messages.length === 4);
    return ws;
  }
  const original = options.control ? await h.open('s', 'a') : (await h.open.watch('s', 'a', true), { url: h.desktops[0].url });
  const initial = (await h.post('/viewer/connect', { ticket: original.url.split('#')[1] })).body;
  const old = await connection(initial);
  const issue = async (cap = initial.capability) => {
    const response = await h.post('/viewer/transfer', {}, cap);
    assert.equal(response.status, 200);
    return response.body.url.split('#')[1];
  };
  const exchange = ticket => h.post('/viewer/connect', { ticket });
  return { ...h, peers, initial, old, issue, exchange, connection };
}

for (const control of [false, true]) test(`transfer preserves ${control ? 'human control' : 'watch'} and paused automation; revokes old connection`, async t => {
  const h = await fixture(t, { control });
  await h.post('/viewer/control', { action: 'stop' }, h.initial.capability);
  const viewer = h.w.viewer, modeCalls = h.modes.length, launches = h.launches.length;
  const ticket = await h.issue(), replacement = await h.exchange(ticket);
  assert.equal((await h.exchange(ticket)).status, 403);
  assert.equal((await h.post('/viewer/control', { action: 'close' }, replacement.body.capability)).status, 403);
  assert.equal(h.old.readyState, WebSocket.OPEN);
  const oldClosed = once(h.old, 'close');
  const next = await h.connection(replacement.body);
  assert.equal((await oldClosed)[0], 4001);
  assert.equal(h.w.viewer, viewer);
  assert.equal(h.w.humanControl, control);
  assert.equal(h.w.viewer.mode, control ? 'control' : 'watch');
  assert.equal(h.modes.length, modeCalls); assert.equal(h.launches.length, launches);
  assert.equal((await h.post('/viewer/handoff', { action: 'status' }, replacement.body.capability)).body.automationPaused, true);
  for (const action of ['close', 'watch', 'control', 'stop', 'resume'])
    assert.equal((await h.post('/viewer/control', { action }, h.initial.capability)).status, 403);
  if (!control) {
    await h.desktops[0].onClose(); assert(h.desktops[0].closed); assert.equal(h.w.viewer, viewer);
    assert.equal((await h.open.watch('s', 'a', true)).state, 'connected');
  }
  next.send(Buffer.from([4, 1, 0, 0, 0, 0, 0, 65]));
  await until(() => h.peers[1].input.length === 1);
  assert.equal(h.peers[0].input.length, 0);
  assert.equal((await h.post('/viewer/control', { action: 'close' }, replacement.body.capability)).status, 200);
  assert.equal(h.w.viewer, null);
});

test('auth, origin, body and latest-ticket-only checks preserve the current viewer', async t => {
  const h = await fixture(t);
  for (const origin of ['', 'http://evil.test']) assert.equal((await h.post('/viewer/transfer', {}, h.initial.capability, origin)).status, 403);
  assert.equal((await h.post('/viewer/transfer', {}, 'invalid')).status, 403);
  for (const body of [[], { sessionId: 'other' }]) assert.equal((await h.post('/viewer/transfer', body, h.initial.capability)).status, 400);
  const first = await h.issue(), second = await h.issue();
  assert.equal((await h.exchange(first)).status, 403);
  assert.equal((await h.post('/viewer/connect', { ticket: second }, undefined, 'http://evil.test')).status, 403);
  assert.equal((await h.exchange(second)).status, 200);
  const third = await h.issue();
  h.w.viewer.transfer.expires = Date.now() - 1;
  assert.equal((await h.exchange(third)).status, 403);
  assert.equal(h.old.readyState, WebSocket.OPEN);
  assert.equal((await h.post('/viewer/handoff', { action: 'status' }, h.initial.capability)).status, 200);
});

test('failed and abandoned candidate handshakes leave the old transport usable', async t => {
  const h = await fixture(t, { stall: true });
  const replacement = (await h.exchange(await h.issue())).body;
  const next = await h.connection(replacement);
  await until(() => h.peers[1]?.phase === 3);
  assert.equal(h.old.readyState, WebSocket.OPEN);
  assert.equal((await h.post('/viewer/handoff', { action: 'status' }, replacement.capability)).status, 403);
  next.terminate(); await until(() => !h.w.viewer.transfer);
  h.old.send(Buffer.from([4, 1, 0, 0, 0, 0, 0, 65]));
  await until(() => h.peers[0].input.length === 1);
  const again = (await h.exchange(await h.issue())).body;
  const broken = await h.connection(again, false);
  await until(() => broken.messages.length === 1);
  broken.send(Buffer.alloc(12, 4));
  await until(() => !h.w.viewer.transfer);
  assert.equal(h.old.readyState, WebSocket.OPEN);
});

test('candidate cannot send exclusive ClientInit or input before commitment', async t => {
  const h = await fixture(t);
  const state = (await h.exchange(await h.issue())).body, next = await h.connection(state, false);
  await until(() => next.messages.length === 1); next.send(version);
  await until(() => next.messages.length === 2); next.send(Buffer.from([1]));
  await until(() => next.messages.length === 3); next.send(Buffer.from([0]));
  await until(() => !h.w.viewer.transfer);
  assert.equal(h.peers[1].phase, 2);
  assert.equal(h.old.readyState, WebSocket.OPEN);
});

test('replacement socket tickets cannot be reused and new links cancel in-flight candidates', async t => {
  const h = await fixture(t, { stall: true });
  const state = (await h.exchange(await h.issue())).body;
  const next = await h.connection(state); await until(() => h.peers[1]?.phase === 3);
  const duplicate = new WebSocket(h.origin.replace('http:', 'ws:') + '/viewer/socket?ticket=' + state.socketTicket, { origin: h.origin });
  await once(duplicate, 'error');
  await h.issue(); await until(() => next.readyState === WebSocket.CLOSED);
  assert.equal(h.old.readyState, WebSocket.OPEN);
});

test('mode changes, control handoffs, Stop and close invalidate pending transfers', async t => {
  const h = await fixture(t);
  const first = await h.issue();
  const request = h.open.control('s', 'a', 'give');
  assert.equal((await h.exchange(first)).status, 403);
  assert.equal((await h.post('/viewer/transfer', {}, h.initial.capability)).status, 409);
  await h.post('/viewer/handoff', { action: 'respond', requestId: h.w.viewer.handoff.id, accept: false }, h.initial.capability); await request;
  const second = await h.issue();
  await h.post('/viewer/control', { action: 'stop' }, h.initial.capability);
  assert.equal((await h.exchange(second)).status, 403);
  const third = await h.issue();
  const state = (await h.post('/viewer/control', { action: 'control' }, h.initial.capability)).body;
  assert.equal((await h.exchange(third)).status, 403);
  await h.connection(state);
  const fourth = await h.issue();
  await h.post('/viewer/control', { action: 'close' }, h.initial.capability);
  assert.equal((await h.exchange(fourth)).status, 403);
});

test('expiry timer removes pending transfer without closing the original viewer', async t => {
  const h = await fixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Exercise the actual route timer without waiting a minute or advancing socket heartbeats.
  // Fetch while timers are mocked still completes; restore before subsequent I/O.
  const token = await h.issue();
  t.mock.timers.tick(60000); t.mock.timers.reset();
  assert.equal(h.w.viewer.transfer, null);
  assert.equal((await h.exchange(token)).status, 403);
  assert.equal(h.old.readyState, WebSocket.OPEN);
});

test('backend connection failure leaves the current viewer connected', async t => {
  const h = await fixture(t);
  const socket = h.w.viewer.vnc.socket;
  h.w.viewer.vnc.socket = socket + '.missing';
  const next = await h.connection((await h.exchange(await h.issue())).body, false);
  await until(() => next.readyState === WebSocket.CLOSED);
  h.w.viewer.vnc.socket = socket;
  assert.equal(h.old.readyState, WebSocket.OPEN);
  assert.equal(h.w.viewer.transfer, null);
  assert.equal((await h.post('/viewer/handoff', { action: 'status' }, h.initial.capability)).status, 200);
});
