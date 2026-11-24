import {randomUUID} from 'node:crypto';
import {EVENT_CAPACITY, READ_LIMIT} from '../../mcp/lib/diagnostics-contracts.mjs';
import {problem} from './store.js';

// Retain simple diagnostic prose only when *every* word is recognized.
// An arbitrary string, even a single short token, may itself be a secret.
const vocabulary = new Set(('a an the this that is was has been to be not no could cannot ' +
  'failed failure missing unavailable unexpected invalid unknown empty slow timed out timeout ' +
  'render rendering load loading fetch request response resource script style component ' +
  'button element control form input field image document page frame module data ' +
  'update state layout initialization validation warning error fallback used ' +
  'read properties of null undefined function object syntax reference type').split(' '));
function safeSummary(value) {
  if (typeof value !== 'string' || value.length > 160 || !/^[a-z]+(?: [a-z]+)*[.!]?$/i.test(value)) return null;
  const words = value.toLowerCase().replace(/[.!]$/, '').split(' ');
  return words.every(word => vocabulary.has(word)) ? value : null;
}
const errorNames = new Set(['Error', 'TypeError', 'SyntaxError', 'ReferenceError', 'RangeError', 'URIError', 'EvalError', 'AggregateError']);
const stale = () => problem('stale_observation', 'Diagnostic cursor is outside the current window. Read without a cursor or start a new window.');

export function createTabDiagnostics() {
  const windows = new Map();
  let pendingSummaries = 0;
  function start(tabId, page) {
    if (windows.size >= 8) throw problem('operation_limit', 'Stop another tab diagnostic window before starting one.', 429);
    const window = {id: randomUUID(), entries: [], last: 0};
    let documentId = randomUUID();
    function append(kind, severity, summary = null) {
      const record = {sequence: ++window.last, documentId, kind, severity, summary};
      if (window.entries.length === EVENT_CAPACITY) window.entries.shift();
      window.entries.push(record);
      return record;
    }
    function onConsole(message) {
      const severity = message.type();
      if (!['warning', 'error'].includes(severity) || message.worker()) return;
      const record = append('console', severity);
      const args = message.args();
      if (args.length !== 1 || pendingSummaries >= 8) return;
      pendingSummaries++;
      // Check the remote type before crossing the protocol. Never request an
      // argument preview, serialized object, property list or formatted text.
      args[0].evaluate(value => typeof value === 'string' && value.length <= 160 ? value : null)
        .then(value => { if (!Object.isFrozen(record)) record.summary = safeSummary(value); }, () => {})
        .finally(() => { pendingSummaries--; });
    }
    function onError(error) {
      append('pageerror', 'error', errorNames.has(error.name) ? error.name : 'Error');
    }
    function onNavigation(frame) {
      if (frame === page.mainFrame()) documentId = randomUUID();
    }
    function stop() {
      clearTimeout(timer);
      page.off('console', onConsole);
      page.off('pageerror', onError);
      page.off('framenavigated', onNavigation);
      page.off('close', stop);
      page.off('crash', stop);
      window.entries.length = 0;
      windows.delete(tabId);
    }
    const timer = setTimeout(stop, 300_000);
    timer.unref();
    window.stop = stop;
    windows.set(tabId, window);
    page.on('console', onConsole);
    page.on('pageerror', onError);
    page.on('framenavigated', onNavigation);
    page.once('close', stop);
    page.once('crash', stop);
    return window;
  }
  return {
    clear() { for (const window of windows.values()) window.stop(); },
    request(tabId, page, {action, cursor, limit = READ_LIMIT}) {
      let window = windows.get(tabId);
      if (action === 'start' && !window) window = start(tabId, page);
      if (action === 'stop') { window?.stop(); window = undefined; }
      const result = {tabId, active: !!window, events: [], nextCursor: null, evicted: 0, missed: 0, hasMore: false};
      if (!window) {
        if (cursor) throw stale();
        return result;
      }
      const [id, position] = cursor?.split('.') || [window.id, '0'];
      const after = Number(position);
      if (id !== window.id || after > window.last) throw stale();
      result.evicted = window.last - window.entries.length;
      if (action === 'read') {
        result.missed = Math.max(0, result.evicted - after);
        result.events = window.entries.filter(e => e.sequence > after).slice(0, limit).map(Object.freeze);
      }
      const last = result.events.at(-1)?.sequence ?? after;
      result.hasMore = last < window.last;
      result.nextCursor = window.id + '.' + last;
      return result;
    },
  };
}
