import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { problem } from './store.js';
import { viewerSocket, viewerEnvironment } from './viewer-backend.js';
export { browserRegion } from './viewer-backend.js';

export async function startViewer(stateDir, sessionId, display, mode = 'control', options = {}, spawnChild = spawn) {
  if (!/^:\d+$/.test(display || '')) throw problem('viewer_failed', 'Session has no virtual display', 503);
  if (!['watch', 'control'].includes(mode)) throw problem('viewer_failed', 'Invalid viewer mode', 503);
  const nonce = randomBytes(16).toString('hex');
  const socket = viewerSocket(stateDir, sessionId, nonce);
  const script = fileURLToPath(new URL('../../scripts/platform/viewer-backend.mjs', import.meta.url));
  const args = [sessionId, display, mode, nonce];
  const child = options.namespace
    ? spawnChild('sudo', ['-n', options.helper, 'viewer', options.namespace, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: viewerEnvironment })
    : spawnChild(process.execPath, [script, stateDir, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: viewerEnvironment });
  const lines = createInterface({ input: child.stdout });
  let diagnostic = '', stopping = false, stopPromise, reported = false, started = false, spawnError;
  child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(-16384); });
  child.stdin.on('error', () => {});
  const exited = new Promise(resolve => {
    child.once('error', error => { spawnError = error; resolve(); });
    child.once('close', resolve);
  });
  const report = phase => {
    if (reported) return;
    reported = true;
    console.error(JSON.stringify({ event: 'viewer_backend_failed', sessionId, phase,
      namespace: options.namespace || null, display, exitCode: child.exitCode,
      signal: child.signalCode, spawnCode: spawnError?.code, diagnostic }));
  };
  const stop = () => stopPromise ||= (async () => {
    stopping = true;
    child.stdin.end(); // EOF closes the namespace runner even through sudo.
    let timer, deadline;
    try {
      await Promise.race([exited, new Promise((_, reject) => {
        timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 4000);
        deadline = setTimeout(() => reject(Object.assign(problem('viewer_failed', 'Viewer shutdown could not be confirmed; inspect service diagnostics before retrying', 503), { viewerCleanupUnconfirmed: true })), 7000);
      })]);
    } finally { clearTimeout(timer); clearTimeout(deadline); }
    rmSync(socket, { force: true });
  })();
  exited.then(() => {
    lines.close();
    rmSync(socket, { force: true });
    if (started && !stopping) report('runtime');
  });
  let timer, onAbort;
  try {
    await new Promise((resolve, reject) => {
      const fail = () => reject(problem('viewer_failed', 'Viewer backend failed to start; inspect service diagnostics and verify the installed namespace helper', 503));
      timer = setTimeout(fail, 12000);
      lines.on('line', line => { if (line === 'ready') resolve(); });
      exited.then(fail);
      onAbort = () => reject(problem('viewer_failed', 'Viewer closed during startup', 503));
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
    });
    if (spawnError || child.exitCode !== null || child.signalCode !== null) throw problem('viewer_failed', 'Viewer backend exited during startup', 503);
    started = true;
    return { socket, child, stop };
  } catch (error) {
    try { await stop(); }
    catch (cleanupError) { report('shutdown'); throw cleanupError; }
    if (!options.signal?.aborted) report('startup');
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export async function startDesktop(config, url, title, onClose) {
  if (!config.desktopEnv.DISPLAY && !config.desktopEnv.WAYLAND_DISPLAY)
    throw problem('desktop_unavailable', 'No graphical desktop session is available', 503);
  const child = spawn(config.viewerPython, [fileURLToPath(new URL('../../scripts/platform/viewer-window.py', import.meta.url))], {
    stdio: ['pipe', 'pipe', 'ignore'], env: config.desktopEnv,
  });
  const lines = createInterface({ input: child.stdout });
  const send = value => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(value) + '\n'); };
  child.stdin.on('error', () => {});
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(problem('desktop_unavailable', 'Desktop viewer did not become ready', 503)), 15000);
    const finish = fn => value => { clearTimeout(timeout); fn(value); };
    lines.on('line', line => { if (line === 'ready') finish(resolve)(); });
    child.once('error', finish(() => reject(problem('desktop_unavailable', 'Could not launch desktop viewer', 503))));
    child.once('exit', finish(() => reject(problem('desktop_unavailable', 'Desktop viewer exited before connecting', 503))));
  });
  child.once('exit', () => { lines.close(); onClose(); });
  send({ action: 'open', url, title });
  try { await ready; } catch (e) { child.kill(); throw e; }
  return { child, present: () => send({ action: 'present' }), close: () => { send({ action: 'close' }); stopChild(child); } };
}

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
  deadline.unref();
  child.once('exit', () => clearTimeout(deadline));
}
