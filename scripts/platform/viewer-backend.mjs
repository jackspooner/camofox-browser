// Fixed, unprivileged namespace runner. Stdin is a lifetime lease, not commands.
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { captureRegion, viewerEnvironment, viewerSocket } from '../../lib/platform/viewer-backend.js';

const [stateDir, sessionId, display, mode, nonce] = process.argv.slice(2);
if (process.argv.length !== 7 || !/^:\d+$/.test(display) || !['watch', 'control'].includes(mode))
  throw new Error('Invalid viewer arguments');
const socket = viewerSocket(stateDir, sessionId, nonce);
const abort = new AbortController();
let child, exit, closing, stopped = false, stderr = '', phase = 'display';
const stop = () => closing ||= (async () => {
  stopped = true;
  abort.abort();
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
    try { await exit; } finally { clearTimeout(kill); }
  }
  rmSync(socket, { force: true });
})();
process.stdin.resume();
process.stdin.on('end', stop);
process.stdin.on('error', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

try {
  const clip = await captureRegion(display, abort.signal);
  if (!stopped) {
    phase = 'vnc';
    // If the runner is killed, the kernel kills VNC too. No detached orphan.
    child = spawn('/usr/bin/setpriv', ['--pdeathsig', 'KILL', '/usr/bin/x11vnc',
      '-display', display, '-unixsock', socket, '-rfbport', '0', '-no6',
      '-forever', '-shared', '-nopw', '-quiet', '-nosel',
      ...(clip ? ['-clip', clip] : []), ...(mode === 'watch' ? ['-viewonly'] : [])],
    { env: viewerEnvironment, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-16384); });
    let spawnError;
    exit = new Promise(resolve => {
      child.once('error', error => { spawnError = error; resolve(); });
      child.once('close', resolve);
    });
    for (let i = 0; i < 80 && !existsSync(socket) && !stopped; i++) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) break;
      await delay(100);
    }
    if (!stopped) {
      if (!existsSync(socket)) throw spawnError || new Error('VNC did not create its socket');
      await new Promise((resolve, reject) => {
        const probe = connect(socket);
        let greeting = '';
        const finish = error => { probe.destroy(); error ? reject(error) : resolve(); };
        probe.setTimeout(2000, () => finish(new Error('VNC greeting timeout')));
        probe.on('error', finish);
        probe.on('data', data => {
          greeting += data.toString();
          if (greeting.length >= 12) finish(/^RFB \d{3}\.\d{3}\n/.test(greeting) ? null : new Error('Invalid VNC greeting'));
        });
        probe.on('end', () => finish(new Error('VNC closed before greeting')));
      });
      if (!stopped) process.stdout.write('ready\n');
      await exit;
      if (!stopped) throw new Error('VNC exited unexpectedly');
    }
  }
} catch (error) {
  if (!stopped) {
    console.error(JSON.stringify({ phase, code: error.code, detail: error.message,
      exitCode: child?.exitCode, signal: child?.signalCode, stderr }));
    process.exitCode = 1;
  }
} finally {
  await stop();
  process.stdin.destroy();
}
