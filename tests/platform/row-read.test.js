import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { platformRequest } from '../../mcp/lib/platform-contracts.mjs';
import { boundedRead } from '../../lib/bounded-read.js';

const field = { name: 'price', selector: '.price', read: 'text', type: 'number' };
const args = { tabId: 'tab', selector: '.card', projection: { fields: [field] } };
const request = input => platformRequest('camofox_read', input, { userId: 'fixture' });

test('row projection validates nested fields and mutually exclusive flat reads', () => {
  assert.deepEqual(request(args).body, { selector: '.card', projection: args.projection, userId: 'fixture' });
  assert.throws(() => request({ ...args, fields: ['text'] }));
  for (const projection of [null, {}, { fields: [] }, { fields: [field, field] },
    { fields: Array.from({ length: 17 }, (_, i) => ({ ...field, name: 'n' + i })) },
    { fields: [{ ...field, read: 'value' }] }, { fields: [{ ...field, type: 'object' }] },
    { fields: [{ ...field, name: '__proto__' }] }, { fields: [{ ...field, selector: ' ' }] },
    { fields: [{ ...field, expression: '1+1' }] }, { fields: [field], unknown: true },
    ...[1, 64001, 10.5].map(maxBytes => ({ fields: [field], maxBytes }))]) {
    assert.throws(() => request({ ...args, projection }));
  }
});

test('row publication uses frame replacement checks and the existing read deadline', async () => {
  const page = new EventEmitter();
  const frame = { name: () => 'grid', url: () => 'https://example.test/grid', isDetached: () => false };
  page.mainFrame = () => frame;
  page.frames = () => [frame];
  page.evaluateHandle = async () => ({
    asElement: () => ({ contentFrame: async () => frame }), dispose: async () => {},
  });
  frame.evaluate = async () => {
    page.frames = () => [];
    return { rows: [{ price: { status: 'ok', value: 1 } }] };
  };
  await assert.rejects(boundedRead(page, { ...args, frameSelector: '#grid' }), { code: 'target_changed' });
  page.frames = () => [frame];
  frame.evaluate = () => new Promise(() => {});
  await assert.rejects(boundedRead(page, args, 10), { code: 'read_timeout' });
});
