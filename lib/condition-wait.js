import {setTimeout as delay} from 'node:timers/promises';
import {beforeDeadline} from './accessibility-snapshot.js';
import {trackRefFrames, frameRefIdentity, currentRefFrame} from './frame-refs.js';

// A synchronous observation per poll leaves no timers or observers inside the page.
function observe({selector, text}) {
  if (selector !== undefined) {
    let nodes;
    try { nodes = document.querySelectorAll(selector); }
    catch { return 'invalid_selector'; }
    for (const node of nodes) {
      if (!node.checkVisibility({visibilityProperty: true})) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    }
    return false;
  }
  const root = document.documentElement;
  return Boolean(root?.getClientRects().length && root.innerText?.includes(text));
}

export async function waitForCondition(page, condition, startedAt) {
  const deadline = startedAt + condition.timeout;
  trackRefFrames(page);
  const frame = page.mainFrame();
  const identity = frameRefIdentity(frame);
  const checkDocument = error => {
    if (page.isClosed() || !currentRefFrame(page, identity) || /execution context was destroyed/i.test(error?.message))
      throw Object.assign(new Error('Document changed during wait. Inspect the current page.'), {code: 'target_changed', statusCode: 409});
  };
  while (Date.now() < deadline) {
    checkDocument();
    let observed;
    try { observed = await beforeDeadline(frame.evaluate(observe, condition), deadline); }
    catch (error) {
      checkDocument(error);
      throw error;
    }
    checkDocument();
    if (observed === 'invalid_selector') throw Object.assign(new Error('selector must be valid CSS.'), {code: 'invalid_selector', statusCode: 400});
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    if (observed === (condition.state === 'visible')) return {ok: true, ready: true};
    await delay(Math.min(50, remaining));
  }
  throw Object.assign(new Error('Page condition was not observed before the deadline.'), {code: 'read_timeout', statusCode: 408});
}
