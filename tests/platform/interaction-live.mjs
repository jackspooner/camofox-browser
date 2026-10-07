import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { workerJson } from "../../lib/platform/worker-launcher.js";
const root =
  process.env.CAMOFOX_AGENT_STATE_DIR ||
  join(homedir(), "services/runtime/camofox-agent");
const artifacts =
  process.env.CAMOFOX_ACCEPTANCE_DIR || join(root, "acceptance");
const env = Object.fromEntries(
  readFileSync(join(root, "service.env"), "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split(/=(.*)/s).slice(0, 2)),
);
const s = JSON.parse(readFileSync(join(artifacts, "camofox-acceptance.json")));
const call = async (path, body) => {
  const r = await fetch("http://127.0.0.1:" + env.CAMOFOX_PORT + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CAMOFOX_ACCESS_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userId: "acceptance", ...body }),
  });
  const j = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(JSON.stringify(j)), { status: r.status });
  return j;
};
await call(`/agent-sessions/${s.sessionId}/resume`, {});
const profile = join(root, "profiles", s.profileId);
const worker = JSON.parse(readFileSync(join(profile, "worker-env.json")));
const internal = (path, body) =>
  workerJson(
    worker.CAMOFOX_WORKER_SOCKET,
    worker.CAMOFOX_ACCESS_KEY,
    "POST",
    path,
    body,
  );
const evaluate = (expression) =>
  call(`/tabs/${s.tabId}/evaluate`, { expression });
assert.equal(
  spawnSync("flock", ["-n", join(profile, "profile.lock"), "true"]).status,
  1,
);
console.log("Cross-process native profile lock enforced");
await evaluate(
  `document.body.dataset.double='0';document.querySelectorAll('button')[1].addEventListener('dblclick',()=>document.body.dataset.double='1');document.body.style.zoom='1.25'`,
);
const coords = (
  await evaluate(
    `(()=>{const r=document.querySelectorAll('button')[1].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  )
).result;
await call(`/tabs/${s.tabId}/click`, {
  coordinates: coords,
  doubleClick: true,
});
assert.equal((await evaluate("document.body.dataset.double")).result, "1");
assert.equal((await evaluate("document.body.dataset.clicked")).result, "2");
console.log("Native double click and scaled layout verified");
const capture = await internal("/internal/capture", { tabId: s.tabId });
const box = (
  await evaluate(
    `(()=>{const r=document.querySelectorAll('button')[1].getBoundingClientRect();return{x1:r.x,y1:r.y,x2:r.right,y2:r.bottom}})()`,
  )
).result;
await evaluate(
  `document.querySelectorAll('button')[1].textContent='Changed target'`,
);
await assert.rejects(
  () =>
    internal("/internal/click-target", {
      captureId: capture.captureId,
      box,
      targetNumber: 1,
    }),
  (e) => e.code === "stale_observation",
);
console.log("Changed target rejected immediately before dispatch");
const before = await internal("/internal/capture", { tabId: s.tabId });
await call(`/tabs/${s.tabId}/refresh`, {});
await assert.rejects(
  () =>
    internal("/internal/click-target", {
      captureId: before.captureId,
      box,
      targetNumber: 1,
    }),
  (e) => e.code === "stale_observation",
);
console.log("Same-URL navigation invalidates visual observations");
