import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { beginSnapshotRevision, revisionResponse } from '../../lib/snapshot-revisions.js';
import { snapshotQueryError } from '../../mcp/lib/snapshot-options.mjs';
import { buildRequest } from '../../mcp/lib/tool-contracts.mjs';

const response = snapshot => ({ snapshot, truncated: false, refCoverage: { status: 'complete' } });

test('splices reconstruct the exact text and preserve metadata and Unicode scalars', () => {
  const page = new EventEmitter();
  const scope = beginSnapshotRevision(page);
  let text = '';
  let revision = revisionResponse(page, scope, response(text)).changes.revision;
  for (const next of ['x😀y', 'x😁y', '𝄞xy', 'xy𝄞', 'xy', '']) {
    const result = revisionResponse(page, scope, response(next), revision);
    const { start, deleteCount, insert } = result.changes.edit;
    assert.equal(result.changes.baseRevision, revision);
    assert.equal(text.slice(0, start) + insert + text.slice(start + deleteCount), next);
    assert(insert.isWellFormed());
    assert.equal(result.snapshot, undefined);
    assert.deepEqual(result.refCoverage, { status: 'complete' });
    text = next;
    revision = result.changes.revision;
  }
  assert.deepEqual(revisionResponse(page, scope, response(''), revision).changes,
    { kind: 'unchanged', revision, baseRevision: revision });
});

test('bounded lifetime, eviction, coverage and navigation during an in-flight read', () => {
  const page = new EventEmitter();
  const scope = beginSnapshotRevision(page);
  const read = (text, base, time = 0) => revisionResponse(page, scope, response(text), base, time);
  const first = read('a').changes.revision;
  assert.equal(read('a', first, 299999).changes.kind, 'unchanged');
  assert.equal(read('a', first, 300000).changes.reason, 'base_unavailable');
  const other = read('b').changes.revision;
  for (const text of ['c', 'd', 'e', 'f']) read(text);
  const reset = read('g', other);
  assert.equal(reset.changes.reason, 'base_unavailable');
  assert.equal(reset.snapshot, 'g');
  const partial = { ...response('g'), refCoverage: { status: 'partial', reasons: ['timeout'], documents: [], documentsOmitted: 0 } };
  assert.equal(revisionResponse(page, scope, partial, reset.changes.revision, 0).changes.reason, 'coverage_changed');
  page.emit('frameattached');
  assert.deepEqual(read('g', reset.changes.revision).changes, { kind: 'reset', reason: 'document_changed', revision: null });
  assert.equal(revisionResponse(page, beginSnapshotRevision(page), response('g'), reset.changes.revision, 0).changes.reason, 'base_unavailable');
});

test('both host and HTTP inputs reject malformed revisions and incompatible options', () => {
  const token = 'text-00000000-0000-0000-0000-000000000001';
  for (const args of [{ baseRevision: token }, { delta: true, baseRevision: 'e1' }, { delta: true, offset: 1 },
    { delta: true, baseRevision: token + '\n' }, { delta: 'true' }, { includeScreenshot: 0 }]) {
    assert.throws(() => buildRequest('camofox_snapshot', { tabId: 't', ...args }, { userId: 'u' }));
  }
  for (const query of [{ delta: ['true'] }, { includeScreenshot: 'yes' }, { delta: 'true', format: 'json' },
    { delta: 'true', offset: 'hello' }, { delta: 'false', baseRevision: token }]) assert(snapshotQueryError(query));
  assert.equal(snapshotQueryError({ delta: 'true', baseRevision: token, includeScreenshot: 'false' }), undefined);
});
