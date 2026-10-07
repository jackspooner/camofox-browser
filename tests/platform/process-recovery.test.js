import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProtonProvider } from '../../lib/platform/proton-launcher.js';
import { recoverWorkers } from '../../lib/platform/worker-launcher.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'camofox-process-recovery-'));
  const oldPath = process.env.PATH;
  process.env.PATH = dir;
  t.after(() => {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  });
  const executable = (name, body) => {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
    return path;
  };
  const profile = join(dir, 'profiles', 'fixture');
  mkdirSync(profile, { recursive: true });
  const recordFile = join(profile, 'worker-process.json');
  const record = { pid: process.pid, birth: 'not-this-process', namespace: 'cf-test-only' };
  return { dir, executable, recordFile, record, config: { stateDir: dir, vpnHelper: '/fake-helper' } };
}

test('Proton subprocesses accept only normal zero exit and drain output', async (t) => {
  const f = fixture(t);
  const vpn = new ProtonProvider({ protonPython: join(f.dir, 'provider'), vpnHelper: '/fake-helper' });
  f.executable('provider', '/bin/cat >/dev/null\nkill -TERM $$');
  assert.deepEqual(await vpn.status(), { authenticated: false, setupRequired: true, code: 'proton_unavailable' });
  f.executable('sudo', 'kill -TERM $$');
  await assert.rejects(vpn.helper('down', 'cf-test-only'), { code: 'proton_unavailable' });
  f.executable('provider', '/bin/cat >/dev/null\nprintf \'{"code":"proton_login_required"}\'\nexit 1');
  assert.equal((await vpn.status()).code, 'proton_login_required');
  f.executable('provider', '/bin/cat >/dev/null\n(/bin/sleep 0.1; printf \'{"result":{"authenticated":true}}\') &\nexit 0');
  assert.deepEqual(await vpn.status(), { authenticated: true });
  f.executable('sudo', 'exit 0');
  assert.deepEqual(await vpn.helper('down', 'cf-test-only'), {});
});

test('recovery cleans stale namespaces after PID reuse without signaling the unrelated process', async (t) => {
  const f = fixture(t);
  f.executable('sudo', 'printf "%s\\n" "$@" > "$0.calls"');
  writeFileSync(f.recordFile, JSON.stringify(f.record));
  await recoverWorkers(f.config);
  assert.equal(existsSync(f.recordFile), false);
  assert.equal(readFileSync(join(f.dir, 'sudo.calls'), 'utf8'), '-n\n/fake-helper\ndown\ncf-test-only\n');
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});

test('failed recovery retains its record for retry after signal or nonzero helper exit', async (t) => {
  const f = fixture(t);
  const record = { ...f.record, pid: 2147483647, birth: 'gone' };
  assert.equal(existsSync(`/proc/${record.pid}`), false);
  writeFileSync(f.recordFile, JSON.stringify(record));
  for (const body of ['kill -TERM $$', 'exit 1']) {
    f.executable('sudo', body);
    await assert.rejects(recoverWorkers(f.config), /Could not clean up previous tunnel/);
    assert.deepEqual(JSON.parse(readFileSync(f.recordFile, 'utf8')), record);
  }
  f.executable('sudo', 'exit 0');
  await recoverWorkers(f.config);
  assert.equal(existsSync(f.recordFile), false);
});
