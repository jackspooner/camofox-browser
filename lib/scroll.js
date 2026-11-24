// Selection, scrolling and both measurements run in one browser task, so a
// rerender cannot redirect a gesture between the uniqueness check and input.
function scrollElement({ selector, left, top }) {
  let matches;
  try {
    matches = document.querySelectorAll(selector);
  } catch {
    return { error: 'invalid_selector' };
  }
  if (!matches.length) return { error: 'invalid_target' };
  if (matches.length > 1) return { error: 'ambiguous_target' };

  const element = matches[0];
  const before = { x: element.scrollLeft, y: element.scrollTop };
  element.scrollBy({ left, top, behavior: 'instant' });
  const after = { x: element.scrollLeft, y: element.scrollTop };
  const delta = { x: after.x - before.x, y: after.y - before.y };
  return { before, after, delta, moved: delta.x !== 0 || delta.y !== 0 };
}

export async function scrollTab(page, { selector, direction, amount }) {
  if (!['up', 'down', 'left', 'right'].includes(direction) || !Number.isFinite(amount))
    throw Object.assign(new Error('Supply a valid scroll direction and finite pixel amount'), { code: 'invalid_request', statusCode: 400 });
  const distance = direction === 'up' || direction === 'left' ? -amount : amount;
  const vertical = direction === 'up' || direction === 'down';
  const left = vertical ? 0 : distance;
  const top = vertical ? distance : 0;

  if (selector === undefined) {
    await page.mouse.wheel(left, top);
    await page.waitForTimeout(300);
    return { ok: true };
  }
  if (typeof selector !== 'string' || !selector.trim() || selector.length > 2048)
    throw Object.assign(new Error('selector must be a non-empty CSS selector of at most 2048 characters'), { code: 'invalid_selector', statusCode: 400 });

  const movement = await page.evaluate(scrollElement, { selector, left, top });
  if (movement.error) {
    const messages = {
      invalid_selector: 'Invalid CSS selector for scroll container',
      invalid_target: 'No element matches the scroll selector in the main document',
      ambiguous_target: 'Scroll selector matches multiple elements. Select exactly one container',
    };
    throw Object.assign(new Error(messages[movement.error]), {
      code: movement.error, statusCode: movement.error === 'ambiguous_target' ? 409 : 400,
    });
  }
  return { ok: true, movement };
}
