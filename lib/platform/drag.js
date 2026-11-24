import sharp from 'sharp';
import { isInvalidSelectorError } from '../browser-errors.js';
import { problem } from './store.js';

export function staleObservation() {
  return problem('stale_observation', 'Target changed or expired. Locate again.');
}

// Click and drag both compare the selected patch in screenshot pixels before
// converting its centre into main-frame viewport CSS coordinates.
export async function visualPoint(capture, box, fresh, viewport) {
  if (Date.now() - capture.created > 300000 ||
      JSON.stringify(viewport) !== JSON.stringify(capture.geometry)) throw staleObservation();
  const {width, height} = await sharp(capture.png).metadata();
  if (!box || ![box.x1, box.y1, box.x2, box.y2].every(Number.isFinite) ||
      box.x1 < 0 || box.y1 < 0 || box.x2 > width || box.y2 > height ||
      box.x2 <= box.x1 || box.y2 <= box.y1) throw problem('invalid_target', 'Invalid target box', 400);
  const crop = {
    left: Math.floor(box.x1), top: Math.floor(box.y1),
    width: Math.max(1, Math.floor(box.x2) - Math.floor(box.x1)),
    height: Math.max(1, Math.floor(box.y2) - Math.floor(box.y1)),
  };
  const [before, now] = await Promise.all([capture.png, fresh].map(png => sharp(png).extract(crop).raw().toBuffer()));
  if (!before.equals(now)) throw staleObservation();
  return {x: (box.x1 + box.x2) / 2 * viewport.width / width, y: (box.y1 + box.y2) / 2 * viewport.height / height};
}

export async function drag({tabId, tab, from, to, geometry, captures, refToLocator, signal, invalidate}) {
  const {page} = tab;
  const viewport = await geometry(page);
  const fresh = (from.captureId || to.captureId) && await page.screenshot({fullPage: false, animations: 'disabled'});
  async function point(endpoint) {
    if (endpoint.captureId) {
      const capture = captures.get(endpoint.captureId);
      if (capture?.tabId !== tabId || capture.state !== 'pending') throw staleObservation();
      return visualPoint(capture, endpoint.box, fresh, viewport);
    }
    if (endpoint.coordinates) return endpoint.coordinates;
    const locator = endpoint.ref ? refToLocator(page, endpoint.ref, tab.refs) : page.locator('css=' + endpoint.selector);
    if (!locator) throw problem('stale_refs', 'Take a fresh snapshot before dragging', 422);
    let count;
    try { count = await locator.count(); }
    catch (error) {
      if (isInvalidSelectorError(error)) throw problem('invalid_selector', 'Supply a valid CSS selector', 400);
      throw error;
    }
    if (count !== 1) throw problem(count ? 'ambiguous_target' : 'invalid_target', 'Each drag endpoint must match one visible element', count ? 409 : 400);
    const box = await locator.isVisible() && await locator.boundingBox({timeout: 2000});
    if (!box?.width || !box.height) throw problem('invalid_target', 'Drag endpoint is hidden', 400);
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
  }
  const [start, end] = await Promise.all([point(from), point(to)]);
  for (const {x, y} of [start, end])
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= viewport.width || y >= viewport.height)
      throw problem('invalid_coordinates', 'Both drag endpoints must be in the visible viewport', 400);
  if (JSON.stringify(viewport) !== JSON.stringify(await geometry(page))) throw staleObservation();
  signal.throwIfAborted();
  await page.mouse.move(start.x, start.y);
  signal.throwIfAborted();
  try {
    await page.mouse.down();
    signal.throwIfAborted();
    await page.mouse.move(end.x, end.y, {steps: 12});
    signal.throwIfAborted();
    // A second motion over the destination delivers dragover for HTML drop zones.
    await page.mouse.move(end.x, end.y);
  } finally {
    invalidate();
    try { await page.mouse.up(); }
    catch { throw problem('operation_outcome_unknown', 'Mouse release could not be confirmed'); }
  }
  signal.throwIfAborted();
  return {ok: true, tabId, from: start, to: end};
}
