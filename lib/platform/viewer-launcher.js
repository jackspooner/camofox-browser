import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { problem } from './store.js';

const runFile = promisify(execFile);
// Crop only the transmitted desktop, never the browser or its CSS viewport.
export function browserRegion(tree, rootInfo) {
  const width = Number(rootInfo.match(/^\s*Width:\s*(\d+)/m)?.[1]);
  const height = Number(rootInfo.match(/^\s*Height:\s*(\d+)/m)?.[1]);
  if (!width || !height) return null;
  const windows = [...tree.matchAll(/^\s*0x[0-9a-f]+ .*?: \("Navigator" "[Cc]amoufox"\)\s+(\d+)x(\d+)[+-]\d+[+-]\d+\s+([+-]\d+)([+-]\d+)\s*$/gm)]
    .map(m => ({w:Number(m[1]), h:Number(m[2]), x:Number(m[3]), y:Number(m[4])}))
    .filter(r => r.w > 100 && r.h > 100 && r.x < width && r.y < height && r.x+r.w > 0 && r.y+r.h > 0);
  if (!windows.length) return null;
  const x = Math.max(0, Math.min(...windows.map(r => r.x)));
  const y = Math.max(0, Math.min(...windows.map(r => r.y)));
  const right = Math.min(width, Math.max(...windows.map(r => r.x+r.w)));
  const bottom = Math.min(height, Math.max(...windows.map(r => r.y+r.h)));
  return `${right-x}x${bottom-y}+${x}+${y}`;
}
async function captureRegion(display) {
  try {
    const [tree, root] = await Promise.all([
      runFile('/usr/bin/xwininfo', ['-display',display,'-root','-tree'], {timeout:3000,maxBuffer:1024*1024}),
      runFile('/usr/bin/xwininfo', ['-display',display,'-root'], {timeout:3000,maxBuffer:65536}),
    ]);
    return browserRegion(tree.stdout, root.stdout);
  } catch { return null; } // Full display remains usable if window discovery fails.
}
export async function startViewer(stateDir, sessionId, display, mode = 'control') {
  if (!/^:\d+$/.test(display || '')) throw problem('viewer_failed', 'Session has no virtual display', 503);
  const clip = await captureRegion(display);
  const token = randomBytes(32).toString('hex');
  const socket = join(stateDir, `${sessionId.slice(0, 8)}-${token.slice(0, 8)}.vnc`);
  const child = spawn('x11vnc', ['-display', display, '-unixsock', socket, '-rfbport', '0', '-no6', '-forever', '-shared', '-nopw', '-quiet', '-nosel', ...(clip ? ['-clip', clip] : []), ...(mode === 'watch' ? ['-viewonly'] : [])], {
    stdio: 'ignore', env: { PATH: '/usr/bin:/bin', XDG_SESSION_TYPE: 'x11' },
  });
  let failed = false;
  child.on('error', () => { failed = true; });
  const stop = () => { stopChild(child); rmSync(socket, { force: true }); };
  child.once('exit', () => rmSync(socket, { force: true }));
  for (let i = 0; i < 80 && !existsSync(socket); i++) {
    if (failed || child.exitCode !== null || child.signalCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  if (!existsSync(socket)) { stop(); throw problem('viewer_failed', 'Viewer backend failed to start', 503); }
  return { socket, token, child, stop };
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
