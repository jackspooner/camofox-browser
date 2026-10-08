// Raw RFB client intentionally ignores noVNC viewOnly. Run on isolated staging.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { execFileSync } from 'node:child_process';
import { startViewer } from '../../lib/platform/viewer-launcher.js';
import { workerJson } from '../../lib/platform/worker-launcher.js';
const root = process.env.CAMOFOX_AGENT_STATE_DIR;
if (!root?.endsWith('camofox-watch-test')) throw new Error('Isolated staging required');
const env = Object.fromEntries(readFileSync(root+'/service.env','utf8').trim().split('\n').map(l=>l.split(/=(.*)/s).slice(0,2)));
const state = JSON.parse(readFileSync(root+'/acceptance.json'));
const worker = JSON.parse(readFileSync(`${root}/profiles/${state.profileId}/worker-env.json`));
async function evaluate(expression) {
 const response = await fetch(`http://127.0.0.1:${env.CAMOFOX_PORT}/tabs/${state.tabId}/evaluate`,{method:'POST',headers:{authorization:`Bearer ${env.CAMOFOX_ACCESS_KEY}`,'content-type':'application/json'},body:JSON.stringify({userId:state.owner,expression})});
 const data=await response.json(); if(!response.ok)throw new Error(JSON.stringify(data));return data.result;
}
const {display}=await workerJson(worker.CAMOFOX_WORKER_SOCKET,worker.CAMOFOX_ACCESS_KEY,'GET','/internal/display');
function cutbuffer(set) {
 return execFileSync('/usr/bin/python3',['-c',`import ctypes,sys
x=ctypes.CDLL('libX11.so.6');x.XOpenDisplay.restype=ctypes.c_void_p;d=x.XOpenDisplay(sys.argv[1].encode());assert d
x.XStoreBytes.argtypes=[ctypes.c_void_p,ctypes.c_char_p,ctypes.c_int];x.XFlush.argtypes=[ctypes.c_void_p];x.XFetchBytes.argtypes=[ctypes.c_void_p,ctypes.POINTER(ctypes.c_int)];x.XFetchBytes.restype=ctypes.c_void_p
if len(sys.argv)>2:x.XStoreBytes(d,sys.argv[2].encode(),len(sys.argv[2]));x.XFlush(d)
n=ctypes.c_int();p=x.XFetchBytes(d,ctypes.byref(n));print(ctypes.string_at(p,n.value).decode() if p else '')`,display,...(set?[set]:[])],{encoding:'utf8'}).trim();
}
async function client(socket) {
 const c=connect(socket);let buffer=Buffer.alloc(0),wake;
 c.on('data',data=>{buffer=Buffer.concat([buffer,data]);wake?.();});c.on('error',()=>wake?.());
 async function read(n){while(buffer.length<n)await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('RFB timeout')),5000);wake=()=>{clearTimeout(t);resolve();};});const data=buffer.subarray(0,n);buffer=buffer.subarray(n);return data;}
 await read(12);c.write('RFB 003.008\n');const count=(await read(1))[0];assert((await read(count)).includes(1));c.write(Buffer.from([1]));assert.equal((await read(4)).readUInt32BE(),0);c.write(Buffer.from([1]));const init=await read(24);await read(init.readUInt32BE(20));
 return c;
}
await evaluate("document.querySelector('input').value='baseline'; document.querySelector('input').focus(); document.body.dataset.clicked='0'");
const initial=await evaluate("document.querySelector('input').value");
// Keep an X connection alive while checking the root cut buffer.
for (const mode of ['watch','control']) {
 const v=await startViewer(root,'00000000-0000-4000-8000-000000000000',display,mode);let c;
 try {
  cutbuffer('clipboard-baseline');c=await client(v.socket);
  // Complete initial client configuration, then focus the input through native RFB.
  c.write(Buffer.from([2,0,0,1,0,0,0,0]));
  const initialPointer=Buffer.from([5,1,0,120,0,250]);c.write(initialPointer);c.write(Buffer.from([5,0,0,120,0,250]));
  await new Promise(r=>setTimeout(r,200));
  const down=Buffer.from([4,1,0,0,0,0,0,88]),up=Buffer.from([4,0,0,0,0,0,0,88]);
  c.write(down);c.write(up);
  const text=Buffer.from('injected-clipboard'),cut=Buffer.alloc(8);cut[0]=6;cut.writeUInt32BE(text.length,4);c.write(Buffer.concat([cut,text]));
  await new Promise(r=>setTimeout(r,300));
  const value=await evaluate("document.querySelector('input').value");
  assert.equal(cutbuffer(),'clipboard-baseline');
  if(mode==='watch')assert.equal(value,initial); else assert(/[xX]/.test(value), `Expected key delivery, got ${JSON.stringify(value)}`);
  // A physical click at first button centre (Xvfb native pixels, Firefox toolbar included).
  const pointer=Buffer.alloc(6);pointer[0]=5;pointer[1]=1;pointer.writeUInt16BE(190,2);pointer.writeUInt16BE(320,4);c.write(pointer);const released=Buffer.from(pointer);released[1]=0;c.write(released);
  await new Promise(r=>setTimeout(r,300));
  const clicked=await evaluate('document.body.dataset.clicked');
  if(mode==='watch')assert.equal(clicked,'0');else assert.equal(clicked,'1');
  console.log(`${mode}: raw RFB keyboard/pointer ${mode==='watch'?'blocked':'delivered'}, clipboard write blocked`);
 } finally {c?.destroy();await v.stop();}
}
