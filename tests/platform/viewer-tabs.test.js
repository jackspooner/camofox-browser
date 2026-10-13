import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewerTabs } from '../../lib/platform/viewer-tabs.js';

function harness() {
  let active = 'b', control = false, activity = 0, locks = 0;
  const pages = ['a', 'b', 'c'].map(id => ({ id, label: id, closed: false, focused: id === 'b', reads: 0,
    isClosed() { return this.closed; }, url() { return 'https://example.test/' + id; },
    async title() { this.reads++; return this.label; },
    async bringToFront() { for (const p of pages) p.focused = p === this; },
  }));
  const entries = () => pages.map(page => [page.id, { page }]);
  const tabs = createViewerTabs({ context: { pages: () => pages }, entries, getActive: () => active, setActive: id => { active = id; }, humanControl: () => control,
    withTabLock: async (_id, fn) => { locks++; return fn(); }, activity: () => { activity++; }, metadataTimeoutMs: 20 });
  return { pages, tabs, control: value => { control = value; }, active: () => active, activity: () => activity, locks: () => locks };
}
test('tab reads preserve order and focus without locks or human activity', async () => {
  const h = harness();
  assert.deepEqual((await h.tabs.status()).tabs.map(t => t.id), ['a', 'b', 'c']);
  assert.equal((await h.tabs.status()).activeTabId, 'b');
  assert.equal(h.locks(), 0); assert.equal(h.activity(), 0);
  h.pages[1].label = 'Changed'; assert.equal((await h.tabs.status()).tabs[1].title, 'Changed');
  h.pages[1].closed = true;
  assert.equal((await h.tabs.status()).activeTabId, null);
  assert.deepEqual((await h.tabs.status()).tabs.map(t => t.id), ['a', 'c']);
});
test('selection requires control, updates active identity and renews human activity only on success', async () => {
  const h = harness();
  await assert.rejects(h.tabs.select('a'), { code: 'viewer_busy' });
  h.control(true); await h.tabs.select('a');
  assert.equal(h.active(), 'a'); assert.equal(h.activity(), 1); assert.equal(h.locks(), 1);
  assert.equal((await h.tabs.status()).activeTabId, 'a');
  await assert.rejects(h.tabs.select('foreign'), { code: 'tab_not_found' });
  h.pages[2].bringToFront = async () => { h.pages[2].closed = true; };
  await assert.rejects(h.tabs.select('c'), { code: 'tab_not_found' });
  assert.equal(h.active(), 'a'); assert.equal(h.activity(), 1);
});
test('lagging document focus cannot override selection; hung metadata is bounded and coalesced', async () => {
  const h = harness(); h.control(true);
  h.pages[1].focused = false; h.pages[2].focused = true;
  assert.equal((await h.tabs.status()).activeTabId, 'b');
  let release, reads = 0;
  h.pages[0].title = () => { reads++; return new Promise(r => { release = r; }); };
  const first = h.tabs.status(); assert.equal(h.tabs.status(), first);
  assert.equal((await first).tabs[0].title, '');
  assert.equal((await h.tabs.status()).tabs[0].title, ''); assert.equal(reads, 1);
  release('Recovered'); await new Promise(r => setImmediate(r));
  h.pages[0].title = async () => 'Recovered';
  assert.equal((await h.tabs.status()).tabs[0].title, 'Recovered');
});

test('expired and prior-control selections never dispatch after waiting for a page lock', async () => {
  let release, version = 1, focused = 0;
  const page = { isClosed: () => false, bringToFront: async () => { focused++; } };
  const tabs = createViewerTabs({ context: { pages: () => [page] }, entries: () => [['a', { page }]], getActive: () => 'a', setActive() {}, humanControl: () => true, modeVersion: () => version,
    withTabLock: async (_id, fn) => { await new Promise(r => { release = r; }); return fn(); }, activity() {} });
  const old = tabs.select('a', { version, deadline: Date.now() + 1000 }); version++; release();
  await assert.rejects(old, { code: 'viewer_busy' }); assert.equal(focused, 0);
  const expired = tabs.select('a', { version, deadline: Date.now() - 1 }); release();
  await assert.rejects(expired, { code: 'viewer_busy' }); assert.equal(focused, 0);
});
