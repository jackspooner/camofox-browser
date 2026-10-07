import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installWorkerRoutes } from '../../lib/platform/worker-routes.js';

// Exercise the actual private route handler and filesystem publication while
// page evaluation is held open, as when a gateway times out and retries.
test('overlapping checkpoints share one capture; later calls and failed writes can retry', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'camofox-checkpoint-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const page = new EventEmitter();
  let captures = 0, release;
  Object.assign(page, {
    url: () => 'https://fixture.invalid/', isClosed: () => false,
    evaluate: async () => {
      captures++;
      await new Promise(r => { release = r; });
      return { active: true, scroll: { x: 0, y: captures }, sessionStorage: { origin: 'https://fixture.invalid', values: {} } };
    },
  });
  const context = Object.assign(new EventEmitter(), {
    pages: () => [page], exposeBinding: async () => {}, addInitScript: async () => {}, cookies: async () => [],
  });
  const session = { context, tabGroups: new Map([['default', new Map()]]) };
  const routes = new Map();
  const app = { get: (path, handler) => routes.set(path, handler), post: () => {} };
  await installWorkerRoutes(app, {
    config: { workerSession: 'fixture', nativeProfileDir: dir, workerCheckpoint: {} },
    getSession: async () => session, getTabGroup: (s, group) => s.tabGroups.get(group),
    createTabState: page => ({ page }), attachPopupHandler: () => {},
    setPageCloseHandler: () => {}, setBeforeTabOperation: () => {}, pluginEvents: new EventEmitter(),
    findTab: (s, id) => ({ tabState: s.tabGroups.get('default').get(id) }),
  });
  const call = async () => {
    const result = { status: 200 };
    const response = { status: value => { result.status = value; return response; }, json: value => { result.body = value; } };
    await routes.get('/internal/checkpoint')({}, response);
    return result;
  };
  const waitCapture = async count => {
    for (let i = 0; i < 100 && captures < count; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(captures, count);
    release();
  };
  const requests = Array.from({ length: 20 }, call);
  await waitCapture(1);
  const results = await Promise.all(requests);
  assert.ok(results.every(r => r.status === 200));
  assert.ok(results.every(r => r.body === results[0].body));
  const file = join(dir, 'checkpoint.json');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), results[0].body);
  await rm(file);
  await mkdir(file); // Make atomic publication fail; the next capture must retry.
  const failed = call(); await waitCapture(2);
  assert.equal((await failed).status, 500);
  await rm(file, { recursive: true });
  const retried = call(); await waitCapture(3);
  assert.equal((await retried).status, 200);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).tabs[0].scroll.y, 3);
});
