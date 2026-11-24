import { randomUUID } from 'node:crypto';
import { currentRefFrame } from './frame-refs.js';

const observations = new WeakMap();
const lifetimeMs = 5 * 60 * 1000;

// Playwright's AI snapshot emits exact-node refs as key attributes. Never
// interpret a marker in the accessible name, text value or embedded frame.
const nodeKey = /^(\s*- \w+)( "(?:[^"\\]|\\.)*")?((?: \[(?:checked(?:=mixed)?|disabled|expanded|active|invalid(?:=grammar|=spelling)?|level=\d+|pressed(?:=mixed)?|selected)\])*) \[ref=((?:f\d+)?e\d+)\](?: \[cursor=pointer\])?(?=:|$)/;

export function strictFrameSnapshot(raw) {
  const lines = [], nativeRefs = new Map();
  let iframeIndent = -1;
  for (let line of raw.split('\n')) {
    const indent = line.length - line.trimStart().length;
    if (iframeIndent >= 0 && indent > iframeIndent) continue;
    iframeIndent = /^\s*- iframe\b/.test(line) ? indent : -1;
    // YAML quotes the whole key for names containing e.g. ": ". Only unwrap
    // a key after validating the complete native attribute within the quotes.
    const quoted = /^(\s*- )'((?:[^']|'')*)'(:.*)?$/.exec(line);
    if (quoted) {
      const key = quoted[1] + quoted[2].replaceAll("''", "'");
      if (nodeKey.exec(key)?.[0] === key) line = key + (quoted[3] || '');
    }
    const match = nodeKey.exec(line);
    if (match) {
      nativeRefs.set(lines.length, match[4]);
      lines.push(line.replace(nodeKey, '$1$2$3'));
    } else lines.push(line);
  }
  return { yaml: lines.join('\n'), nativeRefs };
}

export function publishStrictObservation(refs, targets) {
  const id = 'strict-' + randomUUID();
  observations.set(refs, { id, targets, expires: Date.now() + lifetimeMs });
  return id;
}

export function currentStrictObservationId(refs) {
  const observation = observations.get(refs);
  return observation && Date.now() < observation.expires ? observation.id : undefined;
}

const failure = (code, message, statusCode = 409) =>
  Object.assign(new Error(message), { code, statusCode });
const stale = () => failure('stale_observation', 'Strict target is unavailable. Take a fresh strict snapshot.');

export async function strictClick(tab, ref, id, signal) {
  const refs = tab.refs;
  const observation = observations.get(refs);
  if (!observation || observation.id !== id || Date.now() >= observation.expires) throw stale();
  // Consume before awaiting anything. Supervised replay uses the operation ID.
  observations.delete(refs);
  const target = observation.targets.get(ref);
  if (!refs.has(ref) || !target || !currentRefFrame(tab.page, target)) throw stale();
  const frame = target.frameObject;
  let handles = [];
  try {
    try {
      handles = await frame.locator('aria-ref=' + target.nativeRef).elementHandles();
      if (handles.length !== 1 || await handles[0].ownerFrame() !== frame) throw stale();
    } catch {
      throw stale();
    }
    if (refs !== tab.refs || !currentRefFrame(tab.page, target)) throw stale();
    signal.throwIfAborted();
    // A trial distinguishes a blocked target with no click dispatched. The
    // actual click repeats actionability on the same handle; it cannot rebind.
    try {
      await handles[0].click({ trial: true, timeout: 2000, signal });
    } catch {
      signal.throwIfAborted();
      throw failure('target_changed', 'Observed node is unavailable or obstructed. Inspect the page and take a fresh strict snapshot.');
    }
    signal.throwIfAborted();
    if (await handles[0].ownerFrame() !== frame || refs !== tab.refs || !currentRefFrame(tab.page, target)) throw stale();
    try {
      await handles[0].click({ timeout: 2000, noWaitAfter: true, signal });
    } catch {
      signal.throwIfAborted();
      throw failure('click_outcome_unknown', 'Native click completion is uncertain. Inspect the operation and page before further input.');
    }
    return { ok: true, url: tab.page.url(), refsAvailable: false };
  } finally {
    await Promise.all(handles.map(handle => handle.dispose().catch(() => {})));
  }
}
