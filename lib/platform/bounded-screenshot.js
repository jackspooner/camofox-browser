import sharp from 'sharp';
import { problem } from './store.js';

const changed = () => problem('target_changed', 'Page or target changed during capture. Inspect it again.', 409);
const stale = () => problem('stale_refs', 'Take a fresh snapshot and select a current ref', 422);
const invalid = message => problem('invalid_target', message, 400);

async function documentSize(page) {
  return page.evaluate(() => {
    const nodes = [document.documentElement, document.body].filter(Boolean);
    return {
      width: Math.max(...nodes.flatMap(n => [n.scrollWidth, n.offsetWidth, n.clientWidth])),
      height: Math.max(...nodes.flatMap(n => [n.scrollHeight, n.offsetHeight, n.clientHeight])),
    };
  });
}

async function resolveElement(page, source, refs, refToLocator) {
  if (source.ref) {
    try {
      const locator = refToLocator(page, source.ref, refs);
      if (!locator || await locator.count() !== 1) throw stale();
      const handle = await locator.elementHandle({ timeout: 1000 });
      if (!handle) throw stale();
      return handle;
    } catch { throw stale(); }
  }
  // Resolve uniqueness and bind the selected DOM node in the same evaluation.
  const result = await page.evaluateHandle(selector => {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 ? matches[0] : matches.length;
    } catch { return 'invalid'; }
  }, source.selector);
  if (result.asElement()) return result.asElement();
  const count = await result.jsonValue();
  await result.dispose();
  if (count === 'invalid') throw problem('invalid_selector', 'Expected a valid CSS selector', 400);
  if (!count) throw invalid('Screenshot selector did not match an element');
  throw problem('ambiguous_target', 'Screenshot selector must match exactly one element');
}

async function elementClip(handle, view) {
  const box = await handle.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0 || !await handle.isVisible())
    throw invalid('Screenshot target needs a visible rendered box');
  // A ref can belong to an iframe. Pixels outside its frame would show a
  // different part of the parent page. Never scroll a frame to reveal them.
  for (let frame = await handle.ownerFrame(); frame?.parentFrame(); frame = frame.parentFrame()) {
    const host = await frame.frameElement();
    try {
      const bounds = await host.boundingBox();
      if (!bounds || box.x < bounds.x || box.y < bounds.y ||
          box.x + box.width > bounds.x + bounds.width || box.y + box.height > bounds.y + bounds.height)
        throw invalid('Bring the entire target into its iframe before capturing');
    } finally { await host.dispose(); }
  }
  const x = Math.floor(view.x + box.x), y = Math.floor(view.y + box.y);
  return { x, y, width: Math.ceil(view.x + box.x + box.width) - x,
    height: Math.ceil(view.y + box.y + box.height) - y };
}

export async function boundedScreenshot({ page, source, geometry, refs, refToLocator }) {
  let handle;
  try {
    const before = await geometry(page);
    const size = await documentSize(page);
    if (source.type === 'element') handle = await resolveElement(page, source, refs, refToLocator);
    const clip = handle ? await elementClip(handle, before) : { x: 0, y: 0, ...size };
    if (clip.x < 0 || clip.y < 0 || clip.x + clip.width > size.width || clip.y + clip.height > size.height)
      throw invalid('The complete screenshot target must fit inside the document');
    if (clip.width < 1 || clip.height < 1 || Math.max(clip.width, clip.height) > 8192 || clip.width * clip.height > 16000000)
      throw invalid('Screenshot exceeds 8192 pixels per side or 16 megapixels, or has no area');
    // A fixed document-space clip also bounds Firefox if the page grows
    // between the preflight and the native render.
    const bytes = await page.screenshot({ type: 'png', fullPage: true, clip, scale: 'css', timeout: 5000, animations: 'disabled' });
    if (bytes.length > 25000000) throw invalid('Screenshot exceeds 25 MB');
    const after = await geometry(page);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw changed();
    if (handle) {
      if (!await handle.evaluate(el => el.isConnected) ||
          JSON.stringify(clip) !== JSON.stringify(await elementClip(handle, after))) throw changed();
    } else if (JSON.stringify(size) !== JSON.stringify(await documentSize(page))) throw changed();
    const meta = await sharp(bytes).metadata();
    if (meta.width !== clip.width || meta.height !== clip.height) throw changed();
    return { bytes, sourceKind: source.type, fallback: false };
  } catch (error) {
    if (error.statusCode) throw error;
    if (error.name === 'TimeoutError') throw problem('read_timeout', 'Timed out rendering the screenshot', 408);
    if (page.isClosed() || /detached|destroyed|navigation|outside the resulting image/i.test(error.message)) throw changed();
    throw error;
  } finally { await handle?.dispose(); }
}
