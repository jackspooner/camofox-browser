import { setTimeout as delay } from 'node:timers/promises';

// Run in the owning document. A label selector can target its associated control.
function matchOption(element, option) {
  const select = element instanceof HTMLSelectElement ? element : element.closest('label')?.control;
  if (!element.isConnected || !(select instanceof HTMLSelectElement)) return 'invalid';
  const choices = Array.from(select.options);
  // Playwright's native label matcher collapses whitespace, including hidden
  // soft hyphens and zero-width spaces. Values compare literally.
  const normalize = text => text.replace(/[\u200b\u00ad]/g, '').trim().replace(/\s+/g, ' ');
  const label = normalize(option);
  if (choices.some(choice => normalize(choice.label) === label)) return 'label';
  if (choices.some(choice => choice.value === option)) return 'value';
  return null;
}

export async function selectOption(element, option, signal) {
  const deadline = Date.now() + 5000;
  // Wait for asynchronously populated options without dispatching a speculative
  // label selection or rebinding the selector while waiting.
  while (true) {
    signal?.throwIfAborted();
    const match = await element.evaluate(matchOption, option);
    signal?.throwIfAborted();
    if (match === 'invalid') throw Object.assign(new Error('Choose a connected native select control.'), {code:'invalid_target', statusCode:400});
    if (match) return element.selectOption({[match]:option}, {timeout:5000});
    if (Date.now() >= deadline) throw Object.assign(new Error('No option matched that label or value.'), {code:'invalid_target', statusCode:400});
    await delay(100, undefined, {signal});
  }
}
