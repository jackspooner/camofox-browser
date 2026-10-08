// Disposable namespace collision test. Requires passwordless sudo and X11 tools;
// installs only a temporary helper/config, never the production helper or routes.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkerVirtualDisplay } from '../../lib/platform/virtual-display.js';
import { startViewer } from '../../lib/platform/viewer-launcher.js';

const uid = process.getuid(), gid = process.getgid();
assert(uid !== 0, 'Run as the desktop user; the fixture scopes sudo itself');
const root = mkdtempSync(join(tmpdir(), 'cf-ns-'));
const state = join(root, 'state');
execFileSync('mkdir', ['-m', '700', state]);
const namespace = `cf-${uid}-${randomBytes(6).toString('hex')}`;
const sudo = (...args) => execFileSync('sudo', ['-n', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
const desktopSocket = '/tmp/.X11-unix/X0';
const desktopInode = existsSync(desktopSocket) ? statSync(desktopSocket).ino : null;
const host = new WorkerVirtualDisplay(false, '320x240x24');
const children = [], viewers = [];
let sentinel, sentinelPath, created = false;
const child = (command, args) => {
  const p = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  p.on('error', () => {}); children.push(p); return p;
};
async function colors(socketPath) {
  const socket = connect(socketPath);
  let bytes = Buffer.alloc(0), notify;
  socket.on('data', data => { bytes = Buffer.concat([bytes, data]); notify?.(); });
  socket.on('error', () => notify?.());
  const read = async n => {
    while (bytes.length < n) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('RFB read timeout')), 5000);
      notify = () => { clearTimeout(timer); resolve(); };
    });
    const result = bytes.subarray(0, n); bytes = bytes.subarray(n); return result;
  };
  try {
    assert.match((await read(12)).toString(), /^RFB /); socket.write('RFB 003.008\n');
    const count = (await read(1))[0]; assert((await read(count)).includes(1));
    socket.write(Buffer.from([1])); assert.equal((await read(4)).readUInt32BE(), 0);
    socket.write(Buffer.from([1])); const info = await read(24); await read(info.readUInt32BE(20));
    const width = info.readUInt16BE(0), height = info.readUInt16BE(2);
    socket.write(Buffer.from([0,0,0,0,32,24,0,1,0,255,0,255,0,255,16,8,0,0,0,0]));
    socket.write(Buffer.from([2,0,0,1,0,0,0,0]));
    const request = Buffer.alloc(10); request[0] = 3; request.writeUInt16BE(width,6); request.writeUInt16BE(height,8); socket.write(request);
    const header = await read(4); assert.equal(header[0],0);
    let red = 0, blue = 0;
    for (let n = header.readUInt16BE(2); n > 0; n--) {
      const rectangle = await read(12); assert.equal(rectangle.readInt32BE(8),0);
      const pixels = await read(rectangle.readUInt16BE(4)*rectangle.readUInt16BE(6)*4);
      for (let i=0;i<pixels.length;i+=4) {
        if (pixels[i+2] > 200 && pixels[i] < 40) red++;
        if (pixels[i] > 200 && pixels[i+2] < 40) blue++;
      }
    }
    return { red, blue };
  } finally { socket.destroy(); }
}
try {
  const display = await host.get();
  // This filesystem socket shares the abstract display's number. It belongs
  // to somebody else and must survive both worker and viewer teardown.
  sentinelPath = '/tmp/.X11-unix/X' + display.slice(1);
  sentinel = createServer(); await new Promise(r => sentinel.listen(sentinelPath, r));
  const sentinelInode = statSync(sentinelPath).ino;
  sudo('ip','netns','add',namespace); created = true;
  const helper = join(root, 'helper.py'), config = join(root, 'config.json');
  writeFileSync(helper, readFileSync('scripts/platform/camofox-netns.py','utf8').replace("CFG = pathlib.Path('/etc/camofox-agent.json')", `CFG = pathlib.Path(${JSON.stringify(config)})`), { mode: 0o755 });
  writeFileSync(config, JSON.stringify({ uid,gid,node:process.execPath,path:'/usr/bin:/bin',stateDir:state,viewerScript:resolve('scripts/platform/viewer-backend.mjs') }), { mode:0o600 });
  sudo('chown','root:root',helper,config);
  const prefix = ['-n','ip','netns','exec',namespace,'setpriv',`--reuid=${uid}`,`--regid=${gid}`,'--clear-groups','--no-new-privs'];
  child('sudo',[...prefix,'/usr/bin/Xvfb',display,'-screen','0','320x240x24','-ac','-nolock','-nolisten','tcp','-nolisten','unix']);
  const message = color => ['/usr/bin/xmessage','-display',display,'-geometry','300x200+0+0','-bg',color,'-fg',color,'-buttons','',color];
  child('/usr/bin/xmessage',message('red').slice(1));
  for (let i=0;i<50;i++) {
    try { sudo('ip','netns','exec',namespace,'xwininfo','-display',display,'-root'); break; }
    catch (e) { if(i===49)throw e; await delay(100); }
  }
  child('sudo',[...prefix,...message('blue')]); await delay(500);
  for (const mode of ['watch','control']) {
    const id = '00000000-0000-4000-8000-000000000000';
    const direct = await startViewer(state,id,display,mode); viewers.push(direct);
    const routed = await startViewer(state,id,display,mode,{ namespace,helper }); viewers.push(routed);
    const [a,b] = await Promise.all([colors(direct.socket),colors(routed.socket)]);
    assert(a.red>20000 && a.blue===0, JSON.stringify(a));
    assert(b.blue>20000 && b.red===0, JSON.stringify(b));
    await Promise.all([direct.stop(),routed.stop()]);
    assert.equal(existsSync(direct.socket),false); assert.equal(existsSync(routed.socket),false);
    assert.equal(statSync(sentinelPath).ino,sentinelInode);
    console.log(`PASS ${mode}: identical ${display}, host red / namespace blue, sockets cleaned`);
  }
  host.kill(); assert.equal(statSync(sentinelPath).ino,sentinelInode);
  if (desktopInode !== null) assert.equal(statSync(desktopSocket).ino,desktopInode);
  console.log('PASS abstract-only display cleanup preserves unrelated filesystem sockets');
} finally {
  await Promise.allSettled(viewers.map(v => v.stop()));
  for (const p of children) if (p.exitCode===null && p.signalCode===null) {
    p.kill('SIGTERM'); await Promise.race([once(p,'exit'),delay(2000)]);
  }
  host.kill();
  if(created) {
    const pids=sudo('ip','netns','pids',namespace).toString().trim().split(/\s+/).filter(Boolean);
    if(pids.length)sudo('kill','-KILL',...pids);
    sudo('ip','netns','del',namespace);
  }
  if(sentinel)await new Promise(r=>sentinel.close(r));
  rmSync(root,{recursive:true,force:true});
}
