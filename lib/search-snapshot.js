import { refSnapshot, specializedCoverage } from './accessibility-snapshot.js';
import { currentRefFrame } from './frame-refs.js';
import { searchOptions } from '../mcp/lib/accessibility-search.mjs';

const FRAME_CHARS = 65536;
const LABEL_CHARS = 512;

// Playwright emits one sequence entry per line. Keys needing YAML escaping
// use single quotes; accessible names inside keys use JSON string escaping.
function parseEntry(entry) {
  if (entry.startsWith("'")) {
    const quoted = /^'((?:[^']|'')*)'(:.*)?$/.exec(entry);
    if (!quoted) return null;
    entry = quoted[1].replaceAll("''", "'") + (quoted[2] || '');
  }
  const parts = /^([a-z][a-z0-9-]*)(?: ("(?:\\.|[^"\\])*"|\/.*\/))?(?: \[[^\]]+\])*(?::(?: (.*))?)?$/u.exec(entry);
  if (!parts) return null;
  try {
    const name = parts[2]?.startsWith('"') ? JSON.parse(parts[2]) : parts[2] || '';
    const value = parts[3] || '';
    // YAML uses \xNN for selected control characters. Translate only actual
    // escape sequences, preserving a literal backslash followed by xNN.
    const text = value.startsWith('"') ? JSON.parse(value.replace(/\\(?:x([0-9a-fA-F]{2})|.)/g,
      (escape, hex) => hex ? '\\u00' + hex : escape)) : value;
    return { role: parts[1], name, text };
  } catch { return null; }
}

export function searchSnapshot({ page, refs }, input) {
  const { query, role, limit } = searchOptions(input);
  const observed = refSnapshot(refs);
  const refCoverage = observed?.coverage || specializedCoverage(refs);
  const result = {
    items: [], matched: 0, omittedMatches: 0, skippedChars: 0, skippedLines: 0, changedFrames: 0,
    partial: refCoverage.status !== 'complete', refCoverage,
  };
  if (!observed) return result;
  for (const [index, { start, end, identity, record }] of observed.frameRanges.entries()) {
    if (page.isClosed() || !currentRefFrame(page, identity)) {
      result.changedFrames++;
      continue;
    }
    const frame = { index, main: record.main, name: record.name, origin: record.origin };
    let content = observed.yaml.slice(start, Math.min(end, start + FRAME_CHARS));
    if (end - start > FRAME_CHARS) {
      content = content.slice(0, content.lastIndexOf('\n') + 1);
      result.skippedChars += end - start - content.length;
    }
    const parents = [];
    const ordinals = new Map();
    for (const line of content.split('\n')) {
      if (!line) continue;
      const row = /^( *)- (.*)$/.exec(line);
      if (!row) { result.skippedLines++; continue; }
      const depth = row[1].length;
      while (parents.length && parents.at(-1).depth >= depth) parents.pop();
      let entry = row[2];
      if (entry.startsWith('/')) continue; // e.g. /url is a node property
      // Undo exactly the collector's annotation, including when its legacy
      // name matcher stopped inside an escaped quote. Check parsed semantics
      // and the real map before exposing the ref to the caller.
      const marked = /^(\w+(?:\s+"[^"]*")?) \[(e\d+)\]/.exec(entry);
      if (marked) entry = marked[1] + entry.slice(marked[0].length);
      const node = parseEntry(entry);
      if (!node) { result.skippedLines++; continue; }
      const key = node.role + ':' + node.name;
      const nth = ordinals.get(key) || 0;
      ordinals.set(key, nth + 1);
      if ((!role || node.role === role) &&
          (!query || node.name.toLowerCase().includes(query) || node.text.toLowerCase().includes(query))) {
        result.matched++;
        if (result.items.length < limit) {
          const info = marked && refs.get(marked[2]);
          const validRef = info && info.role === node.role && info.name === node.name && info.nth === nth &&
            (record.main ? !info.frameObject : info.frameObject === identity.frameObject);
          const nearest = parents.slice(-2);
          result.items.push({ role: node.role, name: node.name.slice(0, LABEL_CHARS), text: node.text.slice(0, LABEL_CHARS),
            ref: validRef ? marked[2] : null, frame,
            ancestors: nearest.map(({ role, name }) => ({ role, name: name.slice(0, LABEL_CHARS) })),
            clipped: [node.name, node.text, ...nearest.map(p => p.name)].some(s => s.length > LABEL_CHARS) });
        }
      }
      parents.push({ depth, role: node.role, name: node.name });
    }
  }
  result.omittedMatches = result.matched - result.items.length;
  result.partial ||= Boolean(result.changedFrames || result.skippedChars || result.skippedLines);
  return result;
}
