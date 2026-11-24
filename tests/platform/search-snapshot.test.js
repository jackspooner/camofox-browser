import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { collectAccessibility } from '../../lib/accessibility-snapshot.js';
import { searchSnapshot } from '../../lib/search-snapshot.js';
import { platformRequest } from '../../mcp/lib/platform-contracts.mjs';
import { browserOperation } from '../../mcp/lib/operation-contracts.mjs';

async function observed(...documents) {
  const frames = documents.map((yaml, i) => ({
    name: () => 'frame' + i, url: () => 'http://fixture.test/', isDetached: () => false,
    locator: () => ({ ariaSnapshot: async () => yaml }),
  }));
  const page = Object.assign(new EventEmitter(), { frames: () => frames, mainFrame: () => frames[0], isClosed: () => false });
  const { refs } = await collectAccessibility(page);
  return { page, refs };
}

test('quoted keys, escaped names and ref-like text keep their literal meaning', async () => {
  const tab = await observed([
    '- button "Save \\"copy\\""',
    '- \'button "It\'\'s: time"\'',
    '- paragraph: "[e1] literal"',
    '- button "Real [e1]"',
    '  - /url: secret-property',
  ].join('\n'));
  assert.equal(searchSnapshot(tab, { query: 'save "copy"' }).items[0].ref, null);
  assert.equal(searchSnapshot(tab, { query: "it's: time" }).matched, 1);
  const literal = searchSnapshot(tab, { query: '[e1]' }).items;
  assert.equal(literal.length, 2);
  assert.equal(literal[0].ref, null);
  assert.equal(literal[1].ref, 'e2');
  assert.equal(searchSnapshot(tab, { query: 'secret-property' }).matched, 0);
});

test('bounded scanning separates source omissions, clipped fields and omitted matches', async () => {
  const tab = await observed('- paragraph: ' + 'x'.repeat(800) + '\n- text: ' + 'y'.repeat(66000), '- button "child"');
  const parent = searchSnapshot(tab, { role: 'paragraph' });
  assert.equal(parent.items[0].text.length, 512);
  assert(parent.items[0].clipped);
  assert(parent.partial && parent.skippedChars > 66000);
  assert.equal(parent.omittedMatches, 0);
  const child = searchSnapshot(tab, { query: 'child' });
  assert.equal(child.items[0].frame.index, 1);
  tab.page.emit('framenavigated', tab.page.frames()[1]);
  const stale = searchSnapshot(tab, { query: 'child' });
  assert.equal(stale.matched, 0);
  assert.equal(stale.changedFrames, 1);
});

test('search maps only valid bounded criteria onto a read-only tab route', () => {
  const req = args => platformRequest('camofox_search_snapshot', { tabId: 't', ...args }, { userId: 'u' });
  for (const args of [{}, { role: 'button.*' }, { query: '' }, { query: 'x'.repeat(257) }, { query: 'x', limit: 0 },
    { role: 'button', limit: 51 }, { role: 'button', regex: true }]) assert.throws(() => req(args));
  const request = req({ role: 'button', query: '.' });
  assert.deepEqual(request.body, { userId: 'u', role: 'button', query: '.' });
  assert.equal(browserOperation(request.method, request.path).mutation, false);
});
