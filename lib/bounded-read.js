import { readOptions } from '../mcp/lib/read-contracts.mjs';
import { trackRefFrames, frameRefIdentity, currentRefFrame } from './frame-refs.js';
import { beforeDeadline, frameProvenance } from './accessibility-snapshot.js';
const fail = (code, message, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });

// Executed inside the selected frame. Only bounded primitive values cross back
// to Node; no image bytes, form values, scripts, or DOM handles are returned.
export function readDocument({ selector, fields, limit, maxChars }) {
  let nodes;
  try { nodes = document.querySelectorAll(selector); }
  catch { return { selectorError: true }; }
  const items = [], omissions = [];
  let remaining = maxChars;
  const text = element => {
    const sensitive = 'input,textarea,select,option,script,style,[contenteditable]:not([contenteditable="false"])';
    if (element.closest(sensitive)) return null;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let value = '', node;
    while ((node = walker.nextNode()) && value.length < 2049) {
      if (!node.parentElement?.closest(sensitive)) value += node.textContent.slice(0, 2049 - value.length);
    }
    return value;
  };
  for (let index = 0; index < Math.min(nodes.length, limit); index++) {
    const node = nodes[index], item = {};
    for (const field of fields) {
      let value;
      if (field === 'text') value = text(node);
      else if (field === 'role') value = node.getAttribute('role');
      else if (field === 'ariaLabel') value = node.getAttribute('aria-label');
      else value = node[field];
      if (!['string','number','boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) value = null;
      if (typeof value === 'string') {
        if (['src','currentSrc','srcset'].includes(field) && /(?:^|[\s,])data:/i.test(value)) {
          value = null; omissions.push({ index, field, reason: 'data_url' });
        } else {
          const budget = Math.min(2048, remaining);
          if (value.length > budget) omissions.push({ index, field, reason: remaining < 2048 ? 'character_budget' : 'string_limit' });
          value = value.slice(0, budget); remaining -= value.length;
        }
      }
      item[field] = value;
    }
    items.push(item);
  }
  const omittedItems = nodes.length - items.length;
  if (omittedItems) omissions.push({ index: null, field: null, reason: 'item_limit' });
  return { items, returned: items.length, matched: nodes.length, omittedItems, truncated: omissions.length > 0, omissions };
}

export async function boundedRead(page, input, timeoutMs = 5000) {
  const options = readOptions(input), deadline = Date.now() + Math.min(5000, timeoutMs);
  trackRefFrames(page);
  let frame = page.mainFrame(), handle;
  try {
    if (options.frameSelector) {
      let selectionExpired = false;
      const selected = page.evaluateHandle(selector => {
        let matches;
        try { matches = document.querySelectorAll(selector); } catch { throw new Error('camofox_invalid_selector'); }
        if (matches.length > 1) throw new Error('camofox_ambiguous_frame');
        if (matches.length !== 1 || matches[0].tagName !== 'IFRAME') throw new Error('camofox_missing_frame');
        return matches[0];
      }, options.frameSelector).then(value => {
        if (selectionExpired) void value.dispose().catch(() => {});
        return value;
      });
      try { handle = await beforeDeadline(selected, deadline); }
      catch (error) { selectionExpired = true; throw error; }
      frame = await beforeDeadline(handle.asElement().contentFrame(), deadline);
      if (!frame) throw fail('invalid_target', 'Selected iframe has no attached document', 400);
    }
    const identity = frameRefIdentity(frame), provenance = frameProvenance(frame, !options.frameSelector);
    if (!currentRefFrame(page, identity)) throw fail('target_changed', 'Selected document changed; inspect the frame and read again');
    let result;
    try { result = await beforeDeadline(frame.evaluate(readDocument, options), deadline); }
    catch (error) {
      if (!currentRefFrame(page, identity)) throw fail('target_changed', 'Selected document changed during read; discard the result and read again');
      throw error;
    }
    if (!currentRefFrame(page, identity)) throw fail('target_changed', 'Selected document changed during read; discard the result and read again');
    if (result.selectorError) throw fail('invalid_selector', 'selector must be a valid CSS selector', 400);
    return { frame: provenance, ...result };
  } catch (error) {
    if (error.message?.includes('camofox_invalid_selector')) throw fail('invalid_selector', 'frameSelector must be a valid CSS selector', 400);
    if (error.message?.includes('camofox_ambiguous_frame')) throw fail('ambiguous_target', 'frameSelector matches multiple elements; select exactly one iframe');
    if (error.message?.includes('camofox_missing_frame')) throw fail('invalid_target', 'frameSelector must match one attached iframe', 400);
    throw error;
  } finally {
    // Remote cleanup must not extend the read deadline if the frame is unresponsive.
    if (handle) void handle.dispose().catch(() => {});
  }
}
