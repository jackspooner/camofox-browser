import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ProtonProvider } from '../../lib/platform/proton-launcher.js';

async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await delay(10);
  }
  assert.fail('Fixture did not reach the expected state');
}
function fixture(t, wait = 0, stopDelay = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'camofox-vpn-lifecycle-'));
  const oldPath = process.env.PATH;
  // Real subprocess lifecycle; this executable replaces sudo, never calls it.
  writeFileSync(join(dir, 'sudo'), `#!${process.execPath}
const fs = require('node:fs');
if (${stopDelay}) process.on('SIGTERM', () => setTimeout(() => process.exit(0), ${stopDelay}));
process.stdin.resume();
process.stdin.on('end', () => {
 fs.writeFileSync(process.argv[1] + '.started', String(process.pid));
 setTimeout(() => console.log(JSON.stringify({ready:true,country:'UK'})), ${wait});
 setInterval(() => {}, 1000);
});
`, { mode: 0o700 });
  process.env.PATH = dir;
  const vpn = new ProtonProvider({ vpnHelper: '/unused-fixture-helper' });
  const actions = [];
  vpn.helper = async action => { actions.push(action); };
  vpn.provider = async () => ({ maxConnections: 5, validFor: 3600, domain: 'fixture', server: 'GB-1' });
  const route = { namespace: 'cf-fixture', identity: 'fixture', domain: 'fixture', ready: true };
  vpn.routes.set(route.namespace, route);
  t.after(async () => {
    for (const r of new Set([route, ...vpn.routes.values()])) {
      clearInterval(r.refresh);
      for (const child of [r.agent, r.pendingAgent, ...(r.agents || [])]) child?.kill('SIGKILL');
    }
    await delay(20);
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  });
  return { vpn, route, actions, started: () => existsSync(join(dir, 'sudo.started')) };
}

test('disconnect cancels a pending renewal and stale cleanup cannot affect its replacement', async t => {
  const { vpn, route, actions, started } = fixture(t, 250);
  const renewal = vpn.renew(route);
  const rejected = assert.rejects(renewal, { code: 'vpn_handshake_failed' });
  await until(started);
  const pending = route.pendingAgent;
  await vpn.disconnect(route);
  await rejected;
  assert.equal(route.ready, false);
  assert.ok(pending.exitCode !== null || pending.signalCode !== null);
  assert.equal(route.pendingAgent, null);
  const replacement = { namespace: route.namespace, ready: true };
  vpn.routes.set(replacement.namespace, replacement);
  await vpn.block(route);
  await vpn.disconnect(route);
  assert.deepEqual(actions, ['down']);
  assert.equal(vpn.routes.get(route.namespace), replacement);
  assert.equal(replacement.ready, true);
});

test('renewals coalesce, replace the previous agent, and ignore its delayed block', async t => {
  const { vpn, route, actions } = fixture(t, 30);
  await vpn.startAgent(route, {});
  const previous = route.agent;
  let renewals = 0;
  vpn.provider = async () => { renewals++; return {}; };
  const first = vpn.renew(route);
  assert.equal(vpn.renew(route), first);
  await first;
  assert.equal(renewals, 1);
  assert.notEqual(route.agent, previous);
  assert.ok(previous.exitCode !== null || previous.signalCode !== null);
  await vpn.block(route, previous);
  assert.deepEqual(actions, []);
  assert.equal(route.ready, true);
  assert.equal(route.egressCountry, 'GB');
  await vpn.disconnect(route);
});

test('namespace removal finishes before reconnect and failed cleanup remains reserved', async t => {
  const { vpn, route, actions } = fixture(t);
  await vpn.disconnect(route);
  const connected = await vpn.connect('GB', 'new');
  const originalHelper = vpn.helper;
  let release;
  vpn.helper = async action => {
    if (action === 'down') await new Promise(r => { release = r; });
    return originalHelper(action);
  };
  const disconnect = vpn.disconnect(connected);
  await until(() => release);
  const reconnect = vpn.connect('GB', 'new');
  await delay(30);
  assert.deepEqual(actions, ['down', 'create']);
  release();
  await disconnect;
  const replacement = await reconnect;
  assert.deepEqual(actions, ['down', 'create', 'down', 'create']);
  vpn.helper = async () => { throw new Error('cleanup failed'); };
  await assert.rejects(vpn.disconnect(replacement), /cleanup failed/);
  assert.equal(vpn.routes.get(replacement.namespace), replacement);
  await assert.rejects(vpn.connect('GB', 'new'), { code: 'vpn_handshake_failed' });
  vpn.helper = originalHelper;
  await vpn.disconnect(replacement);
  assert.equal(vpn.routes.size, 0);
});

test('disconnect during credential renewal prevents starting a new agent', async t => {
  const { vpn, route, started } = fixture(t);
  let finish;
  vpn.provider = () => new Promise(r => { finish = r; });
  const renewal = vpn.renew(route);
  await vpn.disconnect(route);
  finish({});
  await renewal;
  assert.equal(started(), false);
  assert.equal(route.ready, false);
});

test('failed agent launch settles and clears the pending child', async t => {
  const { vpn, route, actions } = fixture(t);
  rmSync(join(process.env.PATH, 'sudo'));
  await assert.rejects(vpn.startAgent(route, {}), { code: 'vpn_handshake_failed' });
  assert.equal(route.pendingAgent, null);
  await vpn.disconnect(route);
  await assert.rejects(vpn.connect('GB', 'failed-connect'), { code: 'vpn_handshake_failed' });
  assert.equal(vpn.routes.size, 0);
  assert.deepEqual(actions, ['down', 'create', 'down']);
});

test('disconnect waits for the retiring agent as well as its replacement', async t => {
  const { vpn, route, actions } = fixture(t, 0, 150);
  await vpn.startAgent(route, {});
  const previous = route.agent;
  const renewal = vpn.renew(route);
  const rejected = assert.rejects(renewal, { code: 'vpn_handshake_failed' });
  await until(() => route.agent !== previous);
  const replacement = route.agent;
  vpn.helper = async action => {
    if (action === 'down') {
      assert.ok(previous.exitCode !== null || previous.signalCode !== null);
      assert.ok(replacement.exitCode !== null || replacement.signalCode !== null);
    }
    actions.push(action);
  };
  await vpn.disconnect(route);
  await rejected;
  assert.equal(route.ready, false);
  assert.deepEqual(actions, ['down']);
});

test('renewal cannot report ready while an earlier block command is still running', async t => {
  const { vpn, route } = fixture(t);
  await vpn.startAgent(route, {});
  const previous = route.agent;
  let finishBlock;
  vpn.helper = async action => {
    if (action === 'block') await new Promise(r => { finishBlock = r; });
  };
  const blocking = vpn.block(route);
  await until(() => finishBlock);
  const renewal = vpn.renew(route);
  await delay(30);
  assert.equal(route.agent, previous);
  assert.equal(route.pendingAgent, null);
  assert.equal(route.ready, false);
  finishBlock();
  await blocking;
  await renewal;
  assert.notEqual(route.agent, previous);
  assert.equal(route.ready, true);
  await vpn.disconnect(route);
});
