import assert from 'node:assert/strict';
import test from 'node:test';
import { currentStrictObservationId, publishStrictObservation, strictClick, strictFrameSnapshot } from '../../lib/strict-click.js';
import { validateClickTarget } from '../../lib/coordinate-click.js';
import { buildRequest } from '../../mcp/lib/tool-contracts.mjs';

test('bind only native key attributes, ignoring markers in accessible names, page text and expanded child frames', () => {
  const input = [
    '- button "Save [ref=e8]" [ref=e3]',
    '- text: button "Other" [ref=e88]',
    '- button "Unbound": injected [ref=e3]',
    '- iframe [ref=e4]:',
    '  - button "Nested" [ref=f2e3]',
    '- \'button "Save: today" [disabled] [ref=e5]\'',
    '- button "Next" [active] [ref=e6] [cursor=pointer]',
  ].join('\n');
  const {yaml, nativeRefs} = strictFrameSnapshot(input);
  assert.deepEqual([...nativeRefs.values()], ['e3', 'e4', 'e5', 'e6']);
  assert.match(yaml, /Save \[ref=e8\]/);
  assert.doesNotMatch(yaml, /Nested/);
});

test('expired observations cannot resolve targets, and a text revision is never an action ID', async t => {
  t.mock.timers.enable({apis:['Date'], now:1000});
  const refs = new Map();
  const id = publishStrictObservation(refs, new Map());
  assert.equal(currentStrictObservationId(refs), id);
  t.mock.timers.tick(300000);
  assert.equal(currentStrictObservationId(refs), undefined);
  await assert.rejects(strictClick({refs}, 'e1', id, new AbortController().signal), {code:'stale_observation'});
  for (const target of [{ref:'e1', strictObservationId:'text-' + id.slice(7)}, {selector:'button', strictObservationId:id},
    {ref:'e1', doubleClick:true, strictObservationId:id}, {ref:'e1', strictObservationId:null}])
    assert.throws(() => validateClickTarget(target), {code:'invalid_click_target'});
  assert.throws(() => buildRequest('camofox_snapshot', {tabId:'t', strictRefs:'true'}, {userId:'test'}), /boolean/);
});

test('cancellation during actionability skips dispatch and retires the observation and handle', async () => {
  const controller = new AbortController();
  let disposed = false;
  const calls = [];
  const handle = {
    ownerFrame: async () => frame,
    click: async options => { calls.push(options.trial); controller.abort(); },
    dispose: async () => { disposed = true; },
  };
  const frame = { isDetached: () => false, locator: () => ({ elementHandles: async () => [handle] }) };
  const refs = new Map([['e1', {}]]);
  const tab = { refs, page: { frames: () => [frame] } };
  const targets = new Map([['e1', {frameObject:frame, frameGeneration:0, nativeRef:'e9'}]]);
  const id = publishStrictObservation(refs, targets);
  await assert.rejects(strictClick(tab, 'e1', id, controller.signal), {name:'AbortError'});
  assert.deepEqual(calls, [true]);
  assert.ok(disposed);
  assert.equal(currentStrictObservationId(refs), undefined);
});
