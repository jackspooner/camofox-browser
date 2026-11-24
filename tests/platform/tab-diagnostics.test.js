import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createTabDiagnostics} from '../../lib/platform/tab-diagnostics.js';
import {platformRequest} from '../../mcp/lib/platform-contracts.mjs';

test('expiry and tab close detach only the active diagnostic listeners', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const manager = createTabDiagnostics();
  const page = new EventEmitter();
  const otherListener = () => {};
  page.on('pageerror', otherListener);
  const request = (action, options) => manager.request('tab', page, {action, ...options});
  const {nextCursor} = request('start');
  t.mock.timers.tick(299_999);
  assert.equal(request('start').nextCursor, nextCursor);
  t.mock.timers.tick(1);
  assert.equal(request('read').active, false);
  assert.throws(() => request('read', {cursor:nextCursor}), {code:'stale_observation'});
  assert.deepEqual(page.eventNames(), ['pageerror']);
  assert.deepEqual(page.listeners('pageerror'), [otherListener]);
  request('start');
  page.emit('close');
  assert.equal(request('read').active, false);
  assert.deepEqual(page.eventNames(), ['pageerror']);
});

test('each session has at most eight windows and clearing detaches every listener', () => {
  const manager = createTabDiagnostics();
  const pages = Array.from({length:9}, () => new EventEmitter());
  for (let i=0; i<8; i++) manager.request(String(i), pages[i], {action:'start'});
  assert.throws(() => manager.request('8', pages[8], {action:'start'}), {code:'operation_limit'});
  pages[3].emit('crash');
  assert(manager.request('8', pages[8], {action:'start'}).active);
  manager.clear();
  for (const page of pages) assert.deepEqual(page.eventNames(), []);
});

test('slow remote summaries stay bounded and cannot revise published results', async () => {
  const manager = createTabDiagnostics();
  const page = new EventEmitter();
  manager.request('a', page, {action:'start'});
  const pending = [];
  const message = {type: () => 'warning', worker: () => null,
    args: () => [{evaluate: () => new Promise(resolve => pending.push(resolve))}]};
  for (let i=0; i<12; i++) page.emit('console', message);
  assert.equal(pending.length, 8);
  const read = () => manager.request('a', page, {action:'read'});
  assert.equal(read().events.length, 12);
  for (const resolve of pending) resolve('Layout warning');
  await new Promise(r => setImmediate(r));
  assert(read().events.every(e => e.summary === null));
  manager.clear();
});

test('adapter validates cursor syntax and permits pagination only on reads', () => {
  const request = opts => platformRequest('camofox_tab_diagnostics', {tabId:'tab', ...opts}, {userId:'owner'});
  for (const opts of [{action:'read',cursor:'x'}, {action:'read',limit:33}, {action:'start',limit:1}, {action:'stop',cursor:'x'}, {action:'dump'}])
    assert.throws(() => request(opts));
  assert.deepEqual(request({action:'read',limit:1}).body, {action:'read',limit:1,userId:'owner'});
});
