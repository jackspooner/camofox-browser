import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const runFile = promisify(execFile);
export const viewerEnvironment = { PATH: '/usr/bin:/bin', XDG_SESSION_TYPE: 'x11' };

export function viewerSocket(stateDir, sessionId, nonce) {
  if (!/^[a-f0-9-]{36}$/.test(sessionId) || !/^[a-f0-9]{32}$/.test(nonce))
    throw new Error('Invalid viewer identity');
  return join(stateDir, `${sessionId.slice(0, 8)}-${nonce}.vnc`);
}

// Crop only the transmitted desktop, never the browser or its CSS viewport.
export function browserRegion(tree, rootInfo) {
  const width = Number(rootInfo.match(/^\s*Width:\s*(\d+)/m)?.[1]);
  const height = Number(rootInfo.match(/^\s*Height:\s*(\d+)/m)?.[1]);
  if (!width || !height) return null;
  const windows = [...tree.matchAll(/^\s*0x[0-9a-f]+ .*?: \("Navigator" "[Cc]amoufox"\)\s+(\d+)x(\d+)[+-]\d+[+-]\d+\s+([+-]\d+)([+-]\d+)\s*$/gm)]
    .map(m => ({ w: +m[1], h: +m[2], x: +m[3], y: +m[4] }))
    .filter(r => r.w > 100 && r.h > 100 && r.x < width && r.y < height && r.x + r.w > 0 && r.y + r.h > 0);
  if (!windows.length) return null;
  const x = Math.max(0, Math.min(...windows.map(r => r.x)));
  const y = Math.max(0, Math.min(...windows.map(r => r.y)));
  const right = Math.min(width, Math.max(...windows.map(r => r.x + r.w)));
  const bottom = Math.min(height, Math.max(...windows.map(r => r.y + r.h)));
  return `${right - x}x${bottom - y}+${x}+${y}`;
}

export async function captureRegion(display, signal) {
  const [tree, root] = await Promise.all([
    runFile('/usr/bin/xwininfo', ['-display', display, '-root', '-tree'], { env: viewerEnvironment, signal, timeout: 3000, maxBuffer: 1024 * 1024 }),
    runFile('/usr/bin/xwininfo', ['-display', display, '-root'], { env: viewerEnvironment, signal, timeout: 3000, maxBuffer: 65536 }),
  ]);
  return browserRegion(tree.stdout, root.stdout);
}
