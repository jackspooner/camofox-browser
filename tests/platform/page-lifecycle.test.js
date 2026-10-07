import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPageLifecycle } from '../../lib/platform/page-lifecycle.js';
function fixture() {
  const pages = [];
  const context = {
    pages: () => pages.filter(p => !p.closed),
    async newPage() {
      const p = new EventEmitter();
      p.isClosed = () => !!p.closed;
      p.mainFrame = () => p;
      p.close = async () => { await Promise.resolve(); p.closed = true; };
      pages.push(p);
      return p;
    },
  };
  const registered = [];
  const lifecycle = createPageLifecycle({ context, register: p => registered.push(p) });
  return { context, lifecycle, registered };
}
test('non-final closes have no replacement; concurrent final closes leave one tracked placeholder', async () => {
  const { context, lifecycle, registered } = fixture();
  const a = await context.newPage(), b = await context.newPage();
  await Promise.all([a, b].map(p => lifecycle.close(p, p => p.close())));
  assert.equal(context.pages().length, 1);
  assert.deepEqual(context.pages(), registered);
  assert.ok(lifecycle.isPlaceholder(registered[0]));
  await lifecycle.reconcile();
  assert.equal(context.pages().length, 1);
  const intentionalBlank = await context.newPage();
  await lifecycle.reconcile();
  assert.deepEqual(context.pages(), [intentionalBlank]);
});
test('only explicit placeholders are disposable; navigation and human input promote them', async () => {
  const { context, lifecycle } = fixture();
  const human = await context.newPage(), navigated = await context.newPage(), ordinary = await context.newPage();
  lifecycle.mark(human); lifecycle.mark(navigated);
  lifecycle.promote(human);
  navigated.emit('framenavigated', navigated);
  await lifecycle.reconcile();
  assert.deepEqual(context.pages(), [human, navigated, ordinary]);
});
test('failed placeholder creation leaves the final page open and later retries work', async () => {
  const { context, lifecycle } = fixture();
  const page = await context.newPage();
  const newPage = context.newPage;
  context.newPage = async () => { throw new Error('creation failed'); };
  await assert.rejects(lifecycle.close(page, p => p.close()), /creation failed/);
  assert.equal(page.isClosed(), false);
  context.newPage = newPage;
  await lifecycle.close(page, p => p.close());
  assert.equal(context.pages().length, 1);
});
test('intentional teardown does not create placeholders', async () => {
  const { context } = fixture();
  const page = await context.newPage();
  const lifecycle = createPageLifecycle({ context, closing: () => true, register: () => assert.fail() });
  await lifecycle.close(page, p => p.close());
  assert.equal(context.pages().length, 0);
});
