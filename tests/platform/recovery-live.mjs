import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
const runtime =
  process.env.CAMOFOX_AGENT_STATE_DIR ||
  join(homedir(), "services/runtime/camofox-agent");
const artifacts =
  process.env.CAMOFOX_ACCEPTANCE_DIR || join(runtime, "acceptance");
mkdirSync(artifacts, { recursive: true, mode: 0o700 });
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
const root = runtime;
const env = Object.fromEntries(
  readFileSync(root + "/service.env", "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split(/=(.*)/s).slice(0, 2)),
);
const s = JSON.parse(readFileSync(join(artifacts, "camofox-acceptance.json")));
const base = "http://127.0.0.1:" + env.CAMOFOX_PORT;
const call = async (path, body) => {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${env.CAMOFOX_ACCESS_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify({ userId: "acceptance", ...body }) : undefined,
  });
  const j = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(JSON.stringify(j)), { status: r.status });
  return j;
};
const resume = () => call(`/agent-sessions/${s.sessionId}/resume`, {});
const status = () => call(`/agent-sessions/${s.sessionId}`);
const evalTab = (expression) =>
  call(`/tabs/${s.tabId}/evaluate`, { expression });
async function healthy() {
  for (let i = 0; i < 100; i++) {
    try {
      await call("/health");
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("Service not ready");
}
await healthy();
await resume();
assert.equal(
  (await evalTab('localStorage.getItem("profile")')).result,
  "retained",
);
execFileSync("systemctl", [
  "--user",
  "restart",
  "camofox-agent-staging.service",
]);
await healthy();
assert.equal((await status()).state, "suspended");
await resume();
assert.equal(
  (await evalTab('localStorage.getItem("profile")')).result,
  "retained",
);
console.log("Service restart preserved profile and tab ID");
// A forced coordinator crash exercises systemd cgroup cleanup and persisted checkpoints.
const pid = Number(
  execFileSync(
    "systemctl",
    [
      "--user",
      "show",
      "camofox-agent-staging.service",
      "-p",
      "MainPID",
      "--value",
    ],
    { encoding: "utf8" },
  ),
);
process.kill(pid, "SIGKILL");
await new Promise((r) => setTimeout(r, 6500));
await healthy();
await resume();
assert.equal(
  (await evalTab('localStorage.getItem("profile")')).result,
  "retained",
);
console.log("Coordinator crash recovered profile and saved tabs");
// This restored worker has no human input timestamp; age only this acceptance session.
const db = new Database(root + "/sessions.sqlite");
db.prepare("UPDATE sessions SET lastActivity=? WHERE id=?").run(
  Date.now() - 1801000,
  s.sessionId,
);
db.close();
for (let i = 0; i < 90; i++) {
  const state = await status();
  if (state.state === "suspended") {
    console.log(
      "30-minute idle suspension passed; repeated status polling did not keep session alive",
    );
    break;
  }
  if (i === 89) throw Error("Idle suspension failed");
  await new Promise((r) => setTimeout(r, 250));
}
await resume();
assert.equal(
  (await evalTab('localStorage.getItem("profile")')).result,
  "retained",
);
console.log("Idle resume retained login storage");
