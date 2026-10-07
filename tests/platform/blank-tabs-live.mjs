// Opt-in regression against the installed pinned browser. Always uses fresh
// temporary profiles/runtime; the supplied cache is reused without installing.
// node tests/platform/blank-tabs-live.mjs /path/to/existing/cache
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { loadPlatformConfig } from '../../lib/config.js';
import { Supervisor } from '../../lib/platform/supervisor.js';
const cache = process.argv[2];
assert.ok(cache, 'Pass an existing browser cache directory; this test never installs dependencies');
const stateDir = mkdtempSync(join(tmpdir(), 'camofox-blank-'));
symlinkSync(resolve(cache), join(stateDir, 'cache'));
const config = { ...loadPlatformConfig(), stateDir };
let supervisor = new Supervisor(config, {});
const fixture = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><title>${req.url}</title><style>body{height:5000px}</style><h1>Persistent tab fixture</h1>`);
});
await new Promise(r => fixture.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${fixture.address().port}`;
const owner = 'blank-tab-regression';
const profile = supervisor.store.createProfile('Isolated blank tab regression');
const session = supervisor.store.createSession(profile.id, 'Regression', owner);
const id = session.id;
const report = { stateDir, browser: '156.0.1-beta.36', checks: [] };
async function call(path, body, method = body ? 'POST' : 'GET') {
  const r = await supervisor.proxy(id, owner, method, path + (path.includes('?') ? '&' : '?') + `userId=${id}`, body && { ...body, userId: id });
  const data = JSON.parse(r.bytes);
  assert.ok(r.status < 400, JSON.stringify(data));
  return data;
}
const create = async (path) => (await call('/tabs', { url: path, sessionKey: 'default' })).tabId;
const evaluate = async (tab, expression) => (await call(`/tabs/${tab}/evaluate`, { expression })).result;
const close = tab => call(`/tabs/${tab}`, undefined, 'DELETE');
const checkpoint = async () => {
  await supervisor.serial(id, () => supervisor.checkpoint(id));
  return supervisor.store.session(id).checkpoint.tabs;
};
const shape = tabs => tabs.map(t => ({ id: t.id, url: t.url, group: t.group, placeholder: !!t.managedPlaceholder }));
async function exact(label, expected, settled = true) {
  assert.deepEqual(shape(await checkpoint()), expected, label + ' immediate');
  const before = supervisor.store.session(id).checkpoint.savedAt;
  if (settled) {
    await delay(16000); // Real 15-second supervisor maintenance, not just explicit checkpoints.
    const cp = supervisor.store.session(id).checkpoint;
    assert.ok(cp.savedAt > before, 'Periodic checkpoint ran');
    assert.deepEqual(shape(cp.tabs), expected, label + ' periodic');
    assert.deepEqual(shape(await checkpoint()), expected, label + ' settled');
  }
  report.checks.push(label);
  console.log('PASS', label);
}
try {
  await supervisor.resume(id, owner);
  const a = await create(url + '/a'), b = await create(url + '/b');
  const expected = [a, b].map((id, i) => ({ id, url: url + (i ? '/b' : '/a'), group: 'default', placeholder: false }));
  await exact('two pages, no startup blank', expected);
  await evaluate(a, `document.cookie='login=retained; path=/';localStorage.setItem('login','retained');sessionStorage.setItem('task','retained');scrollTo(0,750);new Promise(resolve=>{const r=indexedDB.open('blank-regression',1);r.onupgradeneeded=()=>r.result.createObjectStore('values');r.onsuccess=()=>{const tx=r.result.transaction('values','readwrite');tx.objectStore('values').put('retained','login');tx.oncomplete=()=>{r.result.close();resolve(true)}}})`);
  for (let cycle = 1; cycle <= 3; cycle++) {
    await supervisor.suspend(id, owner);
    await supervisor.resume(id, owner);
    await exact(`resume cycle ${cycle}: exact IDs, URLs, order and count`, expected);
    assert.equal((await checkpoint()).find(t => t.active)?.id, a);
    const state = JSON.parse(await evaluate(a, `JSON.stringify({cookie:document.cookie,local:localStorage.getItem('login'),session:sessionStorage.getItem('task'),scroll:scrollY})`));
    assert.match(state.cookie, /login=retained/); assert.equal(state.local, 'retained');
    assert.equal(state.session, 'retained'); assert.equal(state.scroll, 750);
    assert.equal(await evaluate(a, `new Promise(resolve=>{const r=indexedDB.open('blank-regression',1);r.onsuccess=()=>{const q=r.result.transaction('values').objectStore('values').get('login');q.onsuccess=()=>{r.result.close();resolve(q.result)}}})`), 'retained');
  }
  report.checks.push('cookies, localStorage, IndexedDB, sessionStorage, scroll and active tab survive');
  await close(b);
  await exact('non-final close removes exactly one page', expected.slice(0, 1));
  const blank = await create(); // Omitting URL deliberately creates a blank via REST.
  const blanksExpected = [...expected.slice(0, 1), { id: blank, url: 'about:blank', group: 'default', placeholder: false }];
  await supervisor.suspend(id, owner); await supervisor.resume(id, owner);
  await exact('deliberately created blank survives restore', blanksExpected);
  await close(blank);
  await exact('closing ordinary blank produces no replacement', expected.slice(0, 1));
  // Native untracked pages (as with human-created tabs) must still be adopted.
  // window.open exercises the popup registration path in the actual browser.
  await evaluate(a, `window.open('about:blank');true`);
  const popup = (await checkpoint()).find(t => t.id !== a);
  assert.ok(popup); assert.equal(popup.url, 'about:blank'); assert.ok(!popup.managedPlaceholder);
  await close(popup.id);
  await close(a);
  const empty = await checkpoint();
  assert.equal(empty.length, 1); assert.equal(empty[0].managedPlaceholder, true);
  assert.ok(![a, b, blank, popup.id].includes(empty[0].id));
  await exact('final close leaves exactly one managed placeholder', shape(empty));
  await supervisor.suspend(id, owner); await supervisor.resume(id, owner);
  await exact('empty session resumes with stable placeholder', shape(empty));
  const c = await create(url + '/c');
  await exact('new work removes only the managed placeholder', [{ id: c, url: url + '/c', group: 'default', placeholder: false }]);
  await call('/tabs/group/default', undefined, 'DELETE');
  const groupEmpty = await checkpoint();
  assert.equal(groupEmpty.length, 1); assert.equal(groupEmpty[0].managedPlaceholder, true);
  await exact('closing final group terminates and retains one placeholder', shape(groupEmpty));
  // Reopening the supervisor/store simulates a clean service restart, isolated.
  await supervisor.close(); supervisor = new Supervisor(config, {});
  await supervisor.resume(id, owner);
  await exact('service restart preserves the empty-session policy', shape(groupEmpty));
  // Seed a saved native New Tab page: the HTTP API intentionally accepts only
  // HTTP(S) navigation, while human-created Firefox pages can use about:newtab.
  // This changes only this test's fresh, suspended profile/checkpoint.
  await supervisor.suspend(id, owner);
  const savedNativeTab = supervisor.store.session(id).checkpoint;
  savedNativeTab.tabs[0].url = 'about:newtab';
  delete savedNativeTab.tabs[0].managedPlaceholder;
  savedNativeTab.savedAt = Date.now();
  supervisor.store.update(id, { checkpoint: savedNativeTab });
  writeFileSync(join(stateDir, 'profiles', profile.id, 'checkpoint.json'), JSON.stringify(savedNativeTab), { mode: 0o600 });
  await supervisor.resume(id, owner);
  await exact('saved native about:newtab URL and identity survive restoration', shape(savedNativeTab.tabs));
  await create(url + '/after-native-tab');
  assert.ok((await checkpoint()).some(t => t.id === savedNativeTab.tabs[0].id && t.url === 'about:newtab'));
  report.checks.push('native New Tab page is not treated as a disposable placeholder');
  report.ok = true;
} finally {
  await supervisor.close();
  await new Promise(r => fixture.close(r));
  writeFileSync(join(stateDir, 'result.json'), JSON.stringify(report, null, 2));
  console.log('Isolated runtime and results:', stateDir);
}
