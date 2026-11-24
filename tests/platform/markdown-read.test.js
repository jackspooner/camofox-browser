import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readMarkdown } from '../../lib/markdown-read.js';
import { browserOperation } from '../../mcp/lib/operation-contracts.mjs';
import { PLATFORM_TOOLS, platformRequest } from '../../mcp/lib/platform-contracts.mjs';

test('Markdown uses bounded options and read-only dispatch', () => {
  const name = 'camofox_read_markdown', ctx = { userId: 'fixture' };
  const descriptor = PLATFORM_TOOLS.find(tool => tool.name === name);
  assert.ok(descriptor.annotations.readOnlyHint);
  const request = platformRequest(name, { tabId: 't', selector: '#story', maxChars: 1 }, ctx);
  assert.deepEqual(request.body, { userId: 'fixture', selector: '#story', maxChars: 1 });
  assert.deepEqual(browserOperation(request.method, request.path), { kind: 'read-markdown', tabId: 't', mutation: false });
  for (const args of [{ selector: '' }, { frameSelector: 'a'.repeat(2049) }, { maxChars: 0 },
    { maxChars: 1.5 }, { maxChars: 64001 }, { expression: '1' }])
    assert.throws(() => platformRequest(name, { tabId: 't', ...args }, ctx));
});

test('Markdown discards a navigated document and times out a stalled evaluation', async () => {
  const page = new EventEmitter();
  const frame = { name: () => '', url: () => 'https://fixture.test/', isDetached: () => false };
  page.frames = () => [frame];
  page.mainFrame = () => frame;
  frame.evaluate = async () => {
    page.emit('framenavigated', frame);
    return { markdown: 'obsolete' };
  };
  await assert.rejects(readMarkdown(page, {}), { code: 'target_changed' });
  frame.evaluate = () => new Promise(() => {});
  await assert.rejects(readMarkdown(page, {}, 10), { code: 'read_timeout' });
});
