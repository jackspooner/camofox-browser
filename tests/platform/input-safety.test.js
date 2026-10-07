import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { EventEmitter } from 'node:events';
import { runInputOperation, typeWithSignal } from '../../lib/input-lifecycle.js';
import { trackRefFrames, frameRefIdentity, currentRefFrame, annotateFrameSnapshot } from '../../lib/frame-refs.js';

test('timeout stops character input and never submits or dispatches later characters', async () => {
  const input = [];
  let submitted = false;
  await assert.rejects(runInputOperation(async signal => {
    await typeWithSignal({ type: async text => input.push(text) }, 'abcdef', 100, signal);
    signal.throwIfAborted(); submitted = true;
  }, {timeoutMs: 25, quarantine: () => assert.fail('Responsive input must not quarantine')}), {code:'operation_cancelled'});
  const stopped = input.length;
  await delay(120);
  assert.equal(stopped, 1); assert.equal(input.length, stopped); assert.equal(submitted, false);
});

test('timeout waits for an in-flight native character to finish before returning', async () => {
  let finish;
  let returned = false;
  const operation = runInputOperation(signal => typeWithSignal({type: () => new Promise(r => { finish = r; })}, 'ab', 0, signal), {
    timeoutMs: 10, graceMs: 500, quarantine: () => assert.fail('Input should settle'),
  });
  const observed = assert.rejects(operation, {code:'operation_cancelled'}).then(() => { returned = true; });
  await delay(40); assert.equal(returned, false);
  finish(); await observed;
});

test('unresponsive input quarantines before the caller can release ownership, including cleanup failure', async () => {
  for (const onTimeout of [undefined, async () => { throw Error('cleanup failed'); }]) {
    let releaseQuarantine; let returned = false; let quarantined = false;
    const operation = runInputOperation(() => new Promise(() => {}), {
      timeoutMs: 10, graceMs: 10, onTimeout,
      quarantine: () => { quarantined = true; return new Promise(r => { releaseQuarantine = r; }); },
    });
    const observed = assert.rejects(operation, {code:'operation_outcome_unknown'}).then(() => { returned = true; });
    await delay(60); assert.equal(quarantined,true); assert.equal(returned,false);
    releaseQuarantine(); await observed;
  }
});

test('successful typing preserves Unicode text and explicit delay validation', async () => {
  const chars = []; const signal = new AbortController().signal;
  await typeWithSignal({type: async value => chars.push(value)}, 'A😀e\u0301\n', 0, signal);
  assert.equal(chars.join(''), 'A😀e\u0301\n'); assert(chars.includes('😀'));
  await assert.rejects(typeWithSignal({}, 'x', -1, signal), {code:'invalid_request'});
});

test('frame refs reject detach, navigation, and replacement with the same name/URL', () => {
  const frame = {isDetached: () => false}; const page = new EventEmitter();
  let frames = [frame]; page.frames = () => frames;
  trackRefFrames(page); trackRefFrames(page);
  assert.equal(page.listenerCount('framenavigated'),1);
  const ref = frameRefIdentity(frame);
  assert.equal(currentRefFrame(page,ref),frame);
  page.emit('framenavigated',frame); assert.equal(currentRefFrame(page,ref),null);
  const fresh = frameRefIdentity(frame);
  frames = [{isDetached: () => false}]; assert.equal(currentRefFrame(page,fresh),null);
  frames = [frame]; frame.isDetached = () => true; assert.equal(currentRefFrame(page,fresh),null);
});

test('snapshot refs are annotated separately for duplicate names in main document and iframe', () => {
  const frame = {};
  const refs = new Map([['e1',{role:'button',name:'Approve',nth:0}],['e2',{role:'button',name:'Approve',nth:0,frameObject:frame}]]);
  assert.equal(annotateFrameSnapshot('- button "Approve"',refs),'- button "Approve" [e1]');
  assert.equal(annotateFrameSnapshot('- button "Approve"',refs,frame),'- button "Approve" [e2]');
});
