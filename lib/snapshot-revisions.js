import { randomUUID } from 'node:crypto';
import { MAX_SNAPSHOT_CHARS } from './snapshot.js';

// Each physical page owns a bounded history. Nothing is persisted in the
// profile or shared with the locator, action or observation registries.
const histories = new WeakMap();
const HISTORY_LIMIT = 4;
const RETENTION_MS = 5 * 60_000;

export function invalidateSnapshotRevisions(page) {
  const history = histories.get(page);
  if (history) {
    history.entries.clear();
    history.generation++;
  }
}

export function beginSnapshotRevision(page) {
  let history = histories.get(page);
  if (!history) {
    history = { entries: new Map(), generation: 0 };
    histories.set(page, history);
    const invalidate = () => invalidateSnapshotRevisions(page);
    for (const event of ['framenavigated', 'frameattached', 'framedetached', 'close'])
      page.on(event, invalidate);
  }
  return { history, generation: history.generation };
}

function coverageKey(coverage) {
  if (coverage.status === 'complete') return 'complete';
  return JSON.stringify([coverage.reasons, coverage.documentsOmitted, coverage.documents.map(doc =>
    [doc.main, doc.name, doc.origin, doc.reasons, doc.eligible === null ? null : doc.eligible - doc.assigned])]);
}

function textEdit(before, after) {
  let start = 0;
  const shorter = Math.min(before.length, after.length);
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  // Keep inserted Unicode scalar values intact even where two emoji share
  // their first or second UTF-16 code unit.
  if (start && /[\uD800-\uDBFF]/.test(after[start - 1])) start--;
  let suffix = 0;
  while (suffix < shorter - start &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix++;
  if (suffix && /[\uDC00-\uDFFF]/.test(after[after.length - suffix])) suffix--;
  return { start, deleteCount: before.length - start - suffix, insert: after.slice(start, after.length - suffix) };
}

export function revisionResponse(page, scope, response, baseRevision, now = Date.now()) {
  const { snapshot, ...metadata } = response;
  const { history, generation } = scope;
  const reset = (reason, revision = null) => ({ ...response, changes: { kind: 'reset', reason, revision } });
  if (histories.get(page) !== history || generation !== history.generation) return reset('document_changed');
  if (response.truncated || snapshot.length > MAX_SNAPSHOT_CHARS) return reset('text_limit');

  const { entries } = history;
  for (const [key, entry] of entries) if (now >= entry.expires) entries.delete(key);
  const base = entries.get(baseRevision);
  const coverage = coverageKey(response.refCoverage);
  if (base && base.coverage === coverage && snapshot === base.text)
    return { ...metadata, changes: { kind: 'unchanged', baseRevision, revision: baseRevision } };

  const revision = 'text-' + randomUUID();
  entries.set(revision, { text: snapshot, coverage, expires: now + RETENTION_MS });
  if (entries.size > HISTORY_LIMIT) entries.delete(entries.keys().next().value);
  if (!baseRevision) return reset('initial', revision);
  if (!base) return reset('base_unavailable', revision);
  if (base.coverage !== coverage) return reset('coverage_changed', revision);

  return { ...metadata, changes: { kind: 'delta', baseRevision, revision, edit: textEdit(base.text, snapshot) } };
}
