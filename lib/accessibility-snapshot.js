import { INTERACTIVE_ROLES } from './interactive-roles.js';
import { trackRefFrames, frameRefIdentity, currentRefFrame, annotateFrameSnapshot } from './frame-refs.js';

export const REF_LIMITS = Object.freeze({ main: 500, perFrame: 500, frames: 8, total: 4500 });
const snapshots = new WeakMap();
const SKIP_NAMES = [/datepicker/i, /date.?picker/i, /calendar/i, /^date$/i];
const SKIP_FRAMES = [
  /web-pixel/i, /analytics/i, /tracking/i, /gtm/i, /facebook/i,
  /doubleclick/i, /google.*tag/i, /hotjar/i, /segment/i, /sentry/i,
  /recaptcha/i, /gstatic/i, /app-bridge/i, /extensions\.shopifycdn/i,
  /px-iframe/i, /px-captcha/i, /perimeterx/i, /\bcaptcha\b/i, /hcaptcha/i,
  /arkose/i, /funcaptcha/i, /datadome/i,
];

export function frameProvenance(frame, main = false) {
  let origin = null;
  try { origin = new URL(frame.url()).origin; } catch { /* Blank/detached frames have no origin. */ }
  const rawName = String(frame.name() || '');
  // Advertising frames can put JSON, URLs and tracking query strings in name.
  const name = /^[\p{L}\p{N}_ .:-]*$/u.test(rawName)
    ? rawName.slice(0, 256) : '[omitted complex frame name]';
  return { main, name, origin: origin?.slice(0, 256) || null };
}

// Racing returns immutable publication data: a late browser response never gets
// access to the ref map or the tab's cached snapshot.
export async function beforeDeadline(promise, deadline) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Read deadline exceeded'), { code: 'read_timeout', statusCode: 408 })), Math.max(0, deadline - Date.now()));
    })]);
  } finally { clearTimeout(timer); }
}

export function refSnapshot(refs) { return snapshots.get(refs); }
export function specializedCoverage(refs) {
  return { status: 'partial', limits: REF_LIMITS, assigned: refs.size, documents: [], documentsOmitted: 0, reasons: ['not_inspected'] };
}

export async function collectAccessibility(page, { timeoutMs = 10000, frameTimeoutMs = 3000 } = {}) {
  const refs = new Map();
  const coverage = { status: 'complete', limits: REF_LIMITS, assigned: 0, documents: [], documentsOmitted: 0, reasons: [] };
  const documents = [];
  let observedFrames = [];
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const note = (frame, main, reason, assigned = 0, eligible = null) => {
    const record = { ...frameProvenance(frame, main), assigned, eligible, reasons: reason ? [reason] : [] };
    if (coverage.documents.length < 64) coverage.documents.push(record);
    else coverage.documentsOmitted++;
    if (reason) { coverage.status = 'partial'; if (!coverage.reasons.includes(reason)) coverage.reasons.push(reason); }
    return record;
  };
  if (!page || page.isClosed()) {
    coverage.status = 'partial'; coverage.reasons.push('inaccessible');
  } else {
    trackRefFrames(page);
    const main = page.mainFrame();
    observedFrames = [main, ...page.frames().filter(f => f !== main)];
    let included = 0;
    for (const frame of observedFrames) {
      const isMain = frame === main;
      const url = frame.url();
      if (!isMain && (SKIP_FRAMES.some(p => p.test(url) || p.test(frame.name())) || !url || ['about:blank', 'about:srcdoc'].includes(url))) {
        note(frame, false, 'skipped_frame'); continue;
      }
      if (!isMain && included >= REF_LIMITS.frames) { note(frame, false, 'frame_limit'); continue; }
      if (Date.now() >= deadline) { note(frame, isMain, 'timeout'); continue; }
      const identity = frameRefIdentity(frame);
      let yaml;
      try {
        const remaining = Math.min(deadline - Date.now(), isMain ? 5000 : frameTimeoutMs);
        yaml = await beforeDeadline(frame.locator('body').ariaSnapshot({ timeout: remaining }), Date.now() + remaining);
      } catch (error) {
        const reason = !currentRefFrame(page, identity) ? 'frame_changed'
          : error.code === 'read_timeout' || error.name === 'TimeoutError' ? 'timeout' : 'inaccessible';
        note(frame, isMain, reason); continue;
      }
      if (!currentRefFrame(page, identity)) { note(frame, isMain, 'frame_changed'); continue; }
      const controls = [];
      const counts = new Map();
      for (const line of (yaml || '').split('\n')) {
        const match = line.match(/^\s*-\s+(\w+)(?:\s+"([^"]*)")?/);
        if (!match || !INTERACTIVE_ROLES.includes(match[1].toLowerCase())) continue;
        const role = match[1].toLowerCase(), name = match[2] || '', key = `${role}:${name}`;
        const nth = counts.get(key) || 0;
        counts.set(key, nth + 1);
        if (!SKIP_NAMES.some(p => p.test(name))) controls.push({ role, name, nth });
      }
      if (!isMain && (!yaml || yaml.trim().length < 10 || !controls.length)) { note(frame, false, 'no_interactive_content', 0, controls.length); continue; }
      if (!isMain) included++;
      const limit = isMain ? REF_LIMITS.main : REF_LIMITS.perFrame;
      const assigned = Math.min(controls.length, limit);
      const record = note(frame, isMain, controls.length > limit ? 'ref_limit' : null, assigned, controls.length);
      const ids = [];
      for (const info of controls.slice(0, limit)) {
        const id = `e${refs.size + 1}`;
        refs.set(id, isMain ? info : { ...info, frameName: frame.name() || null, frameUrl: url, ...identity });
        ids.push(id);
      }
      documents.push({ frame, isMain, identity, yaml: yaml || '', record, ids });
    }
  }
  if (page && !page.isClosed()) {
    for (const frame of page.frames()) {
      if (!observedFrames.includes(frame)) note(frame, frame === page.mainFrame(), 'frame_changed');
    }
  }
  const parts = [];
  for (const doc of documents) {
    if (!currentRefFrame(page, doc.identity)) {
      for (const id of doc.ids) refs.delete(id);
      doc.record.assigned = 0; doc.record.reasons.push('frame_changed');
      coverage.status = 'partial'; if (!coverage.reasons.includes('frame_changed')) coverage.reasons.push('frame_changed');
      continue;
    }
    const yaml = annotateFrameSnapshot(doc.yaml, refs, doc.isMain ? null : doc.frame);
    const label = doc.record.name || doc.record.origin || 'iframe';
    parts.push(doc.isMain ? yaml : `- iframe ${JSON.stringify(label)}:\n${yaml.split('\n').map(l => '  ' + l).join('\n')}`);
  }
  coverage.assigned = refs.size;
  const result = { refs, yaml: parts.join('\n'), coverage };
  snapshots.set(refs, result);
  return result;
}
