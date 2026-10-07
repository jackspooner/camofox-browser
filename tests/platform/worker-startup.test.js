import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { startWorker } from '../../lib/platform/worker-launcher.js';

const children = () => readFileSync(`/proc/self/task/${process.pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number);
test('failed worker recovery-record write terminates the newly spawned process', {timeout:5000}, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'camofox-start-failure-'));
  const oldPath = process.env.PATH;
  const before = new Set(children());
  const profile = join(dir, 'profile');
  mkdirSync(profile);
  // Harmless process stands in for flock + browser; no browser or account access.
  writeFileSync(join(dir, 'flock'), '#!/bin/sh\nexec /usr/bin/sleep 60\n', { mode: 0o700 });
  mkdirSync(join(profile, 'worker-process.json')); // Force recovery-record persistence to fail.
  try {
    process.env.PATH = dir;
    assert.throws(() => startWorker({stateDir:dir,workerKey:'fixture'}, {id:'fixture',checkpoint:{}}, profile, join(dir,'worker.sock')), {code:'EISDIR'});
    await delay(300);
    assert.deepEqual(children().filter(pid => !before.has(pid)), [], 'launcher leaked a child after throwing');
  } finally {
    process.env.PATH = oldPath;
    for (const pid of children().filter(pid => !before.has(pid))) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    await delay(30);
    rmSync(dir, {recursive:true,force:true});
  }
});
