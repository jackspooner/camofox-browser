import { setTimeout as delay } from 'node:timers/promises';

function inputError(code, message) {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}

async function settledWithin(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

// The caller must retain its lock until this promise settles, including cleanup.
export async function runInputOperation(operation, { timeoutMs, onTimeout, quarantine, graceMs = 1000, signal }) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, {once:true});
  let rejectCancellation;
  const cancelled = new Promise((_, reject) => { rejectCancellation = () => reject(controller.signal.reason); });
  if (controller.signal.aborted) rejectCancellation(); else controller.signal.addEventListener('abort', rejectCancellation, {once:true});
  const expired = inputError('operation_cancelled', 'Action deadline reached; input stopped. Partial effects may remain. Inspect the page before another action.');
  let timer;
  const action = Promise.resolve().then(() => operation(controller.signal));
  try {
    return await Promise.race([
      action,
      cancelled,
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(expired); reject(expired); }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    const stopped = await settledWithin(action, graceMs);
    let cleanupError;
    if (onTimeout) {
      try { await onTimeout(); } catch (error) { cleanupError = error; }
    }
    if (!stopped && !await settledWithin(action, 0)) {
      // Block every new input path before attempting browser teardown.
      try { await quarantine(); } catch { /* The caller's input fence remains in place. */ }
      throw inputError('operation_outcome_unknown', 'Input cleanup could not be confirmed; browser quarantined. Inspect session status and restored state before any retry; unsaved state may be lost.');
    }
    if (cleanupError) throw cleanupError;
    if (onTimeout) throw Object.assign(expired, { code: 'tab_timeout', statusCode: 410 });
    throw controller.signal.reason || expired;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', rejectCancellation); }
}

export async function typeWithSignal(keyboard, text, delayMs, signal) {
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 60000)
    throw Object.assign(new Error('delay must be between 0 and 60000 milliseconds'), { code: 'invalid_request', statusCode: 400 });
  for (const character of text) {
    signal.throwIfAborted();
    // One complete native character dispatch (including key-up) per boundary.
    await keyboard.type(character, { delay: 0 });
    signal.throwIfAborted();
    if (delayMs) await delay(delayMs, undefined, { signal });
  }
}
