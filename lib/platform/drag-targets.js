import { problem } from './store.js';
import { locate } from './media.js';
import { workerJson } from './worker-launcher.js';

export async function prepareDrag({config, worker, observations, sessionId, tabId, from, to, signal}) {
  const endpoints = {from, to};
  let capture;
  for (const [name, endpoint] of Object.entries(endpoints)) {
    signal.throwIfAborted();
    if (endpoint.observationId) {
      const observation = observations.get(endpoint.observationId);
      if (observation?.sessionId !== sessionId || observation.tabId !== tabId)
        throw problem('stale_observation', `Locate the ${name} endpoint again on this tab`);
      const box = observation.boxes.find(b => b.targetNumber === endpoint.targetNumber);
      if (!box) throw problem('invalid_target', `Unknown ${name} target number`, 400);
      endpoints[name] = { captureId: observation.captureId, box };
    } else if (endpoint.prompt) {
      capture ??= await workerJson(worker.socket, config.workerKey, 'POST', '/internal/capture', {tabId}, undefined, signal);
      const { boxes } = await locate(config, capture, endpoint.prompt, { signal, annotate: false })
        .catch(() => { throw problem('locate_failed', `LocateAnything failed for ${name}. Check the MediaTools connection and job status.`, 502); });
      if (boxes.length !== 1)
        throw problem(boxes.length ? 'ambiguous_target' : 'invalid_target',
          `LocateAnything found ${boxes.length} matches for ${name}. Refine the prompt or use a numbered observation.`, boxes.length ? 409 : 400);
      endpoints[name] = { captureId: capture.captureId, box: boxes[0] };
    }
  }
  return endpoints;
}
