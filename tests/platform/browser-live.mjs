import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
const runtime =
  process.env.CAMOFOX_AGENT_STATE_DIR ||
  join(homedir(), "services/runtime/camofox-agent");
const artifacts =
  process.env.CAMOFOX_ACCEPTANCE_DIR || join(runtime, "acceptance");
mkdirSync(artifacts, { recursive: true, mode: 0o700 });
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync(join(runtime, "service.env"), "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split(/=(.*)/s).slice(0, 2)),
);
const base = "http://127.0.0.1:" + env.CAMOFOX_PORT;
const owner = "acceptance";
export async function call(path, body, method = body ? "POST" : "GET") {
  const r = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.CAMOFOX_ACCESS_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify({ userId: owner, ...body }) : undefined,
  });
  const j = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(JSON.stringify(j)), { status: r.status });
  return j;
}
const fixture = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<!doctype html><title>Camofox acceptance</title><style>body{font:24px sans-serif;margin:60px;background:#f7f8fa}button{background:#1266df;color:white;border:0;border-radius:8px;font:22px sans-serif;padding:20px;margin:25px}section{height:1300px}</style><h1>Choose a workspace</h1><button onclick="document.body.dataset.clicked=1">Open workspace</button><button onclick="document.body.dataset.clicked=2">Open workspace</button><button onclick="document.body.dataset.clicked=3">Open workspace</button><p id="status">Ready</p><section></section>`,
  );
});
await new Promise((r) => fixture.listen(23161, "127.0.0.1", r));
let state;
if (existsSync(join(artifacts, "camofox-acceptance.json")))
  state = JSON.parse(readFileSync(join(artifacts, "camofox-acceptance.json")));
else {
  const p = await call("/profiles", { name: "Acceptance " + Date.now() });
  const s = await call("/agent-sessions", { profileId: p.id });
  state = { profileId: p.id, sessionId: s.id };
}
let sessionId = state.sessionId;
try {
  await call(`/agent-sessions/${sessionId}/resume`, {});
  const tab = await call("/tabs", {
    sessionId,
    url: "http://127.0.0.1:23161",
    sessionKey: "default",
  });
  const tabId = tab.tabId;
  console.log("Created real persistent tab");
  const evaluate = (expression) =>
    call(`/tabs/${tabId}/evaluate`, { expression });
  await evaluate(
    `document.cookie='login=retained; path=/';localStorage.setItem('profile','retained');sessionStorage.setItem('task','retained');document.body.dataset.clicked=0;new Promise(resolve=>{const r=indexedDB.open('acceptance',1);r.onupgradeneeded=()=>r.result.createObjectStore('values');r.onsuccess=()=>{const tx=r.result.transaction('values','readwrite');tx.objectStore('values').put('retained','login');tx.oncomplete=()=>{r.result.close();resolve(true)}}})`,
  );
  const bounds = await evaluate(
    `JSON.stringify((()=>{const r=document.querySelectorAll('button')[1].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})())`,
  );
  console.log("Evaluate shape", Object.keys(bounds));
  const coords = JSON.parse(bounds.result);
  await call(`/tabs/${tabId}/click`, { coordinates: coords });
  assert.equal(
    (await evaluate("Number(document.body.dataset.clicked)")).result,
    2,
  );
  console.log("Native coordinate click verified");
  await assert.rejects(
    () => call(`/tabs/${tabId}/click`, { coordinates: { x: -1, y: 0 } }),
    (e) => e.status === 400,
  );
  await call(`/agent-sessions/${sessionId}/suspend`, {});
  await call(`/agent-sessions/${sessionId}/resume`, {});
  const restored = await evaluate(
    `JSON.stringify({cookie:document.cookie,local:localStorage.getItem('profile'),session:sessionStorage.getItem('task')})`,
  );
  assert.equal(JSON.parse(restored.result).local, "retained");
  assert.equal(JSON.parse(restored.result).session, "retained");
  assert.match(JSON.parse(restored.result).cookie, /login=retained/);
  const idb = await evaluate(
    `new Promise(resolve=>{const r=indexedDB.open('acceptance',1);r.onsuccess=()=>{const q=r.result.transaction('values').objectStore('values').get('login');q.onsuccess=()=>resolve(q.result)}})`,
  );
  assert.equal(idb.result, "retained");
  console.log(
    "Cookies, localStorage, sessionStorage, IndexedDB and stable tab ID restored",
  );
  const second = await call("/profiles", { name: "Isolation " + Date.now() });
  const other = await call("/agent-sessions", { profileId: second.id });
  const otherTab = await call("/tabs", {
    sessionId: other.id,
    url: "http://127.0.0.1:23161",
  });
  const isolated = await call(`/tabs/${otherTab.tabId}/evaluate`, {
    expression: `localStorage.getItem('profile')`,
  });
  assert.equal(isolated.result, null);
  await call(`/agent-sessions/${other.id}/suspend`, {});
  console.log("Profile isolation verified");
  await call(`/agent-sessions/${sessionId}/release`, {});
  await assert.rejects(
    () => evaluate("1"),
    (e) => e.status === 409,
  );
  await call(`/agent-sessions/${sessionId}/resume`, {});
  console.log("Release and resume verified");
  writeFileSync(
    join(artifacts, "camofox-acceptance.json"),
    JSON.stringify({ ...state, tabId }),
  );
  if (process.argv.includes("--locate")) {
    const observation = await call(`/tabs/${tabId}/locate`, {
      prompt: "All three blue buttons labeled Open workspace",
    });
    console.log("LocateAnything matches", observation.boxes.length);
    assert.equal(observation.boxes.length, 3);
    writeFileSync(
      join(artifacts, "camofox-locate-preview.png"),
      Buffer.from(observation.screenshot.data, "base64"),
    );
    writeFileSync(
      join(artifacts, "camofox-observation.json"),
      JSON.stringify({ observationId: observation.observationId, tabId }),
    );
    console.log(
      "Preview saved; awaiting separate visual inspection and target selection.",
    );
    await new Promise((resolve) => {
      process.on("SIGTERM", resolve);
      process.on("SIGINT", resolve);
    });
  }
} finally {
  await new Promise((r) => fixture.close(r));
}
