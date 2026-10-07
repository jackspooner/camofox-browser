import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
const runtime =
  process.env.CAMOFOX_AGENT_STATE_DIR ||
  join(homedir(), "services/runtime/camofox-agent");
const artifacts =
  process.env.CAMOFOX_ACCEPTANCE_DIR || join(runtime, "acceptance");
mkdirSync(artifacts, { recursive: true, mode: 0o700 });
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const env = Object.fromEntries(
  readFileSync(join(runtime, "service.env"), "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split(/=(.*)/s).slice(0, 2)),
);
const call = async (path, body) => {
  const r = await fetch("http://127.0.0.1:" + env.CAMOFOX_PORT + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${env.CAMOFOX_ACCESS_KEY}`,
      "Content-Type": "application/json",
    },
    body: body
      ? JSON.stringify({ userId: "vpn-acceptance", ...body })
      : undefined,
  });
  const j = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(JSON.stringify(j)), { status: r.status });
  return j;
};
const sessions = [];
try {
  for (const country of ["GB", "NL"]) {
    const p = await call("/profiles", { name: `VPN ${country} ${Date.now()}` });
    const s = await call("/agent-sessions", { profileId: p.id, country });
    sessions.push(s);
    writeFileSync(join(artifacts, "vpn-session.json"), JSON.stringify(s));

    const t = await call("/tabs", {
      sessionId: s.id,
      url: "https://api.protonvpn.ch/vpn/v1/location",
    });
    const r = await call(`/tabs/${t.tabId}/evaluate`, {
      expression: `fetch("/vpn/v1/location",{headers:{"x-pm-appversion":"linux-vpn-cli@5.8.7"}}).then(r=>r.text())`,
    });
    const data = JSON.parse(r.result);
    assert(
      ["GB", "UK"].includes(country)
        ? ["GB", "UK"].includes(data.Country)
        : data.Country === country,
    );
    console.log("Native profile browser verified country", country);
  }
  const changed = await call(`/agent-sessions/${sessions[0].id}/route`, {
    country: "Netherlands",
  });
  assert.equal(changed.country, "NL");
  assert.equal(changed.resumption, "restored");
  console.log("Country change checkpointed and restarted browser");
} finally {
  for (const s of sessions)
    await call(`/agent-sessions/${s.id}/suspend`, {}).catch((e) =>
      console.error(e.message),
    );
}
