import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
const runtime =
  process.env.CAMOFOX_AGENT_STATE_DIR ||
  join(homedir(), "services/runtime/camofox-agent");
const artifacts =
  process.env.CAMOFOX_ACCEPTANCE_DIR || join(runtime, "acceptance");
mkdirSync(artifacts, { recursive: true, mode: 0o700 });
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const state = JSON.parse(
  readFileSync(join(artifacts, "camofox-acceptance.json")),
);
const client = new Client({ name: "camofox-acceptance", version: "1" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [`--env-file=${join(runtime, "service.env")}`, "mcp/server.mjs"],
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    CAMOFOX_USER_ID: "acceptance",
  },
  stderr: "pipe",
});
await client.connect(transport);
try {
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 26);
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args }, undefined, {
      timeout: 610000,
    });
    if (r.isError) throw Error(r.content[0].text);
    return r;
  };
  await call("camofox_session_resume", { sessionId: state.sessionId });
  const status = await call("camofox_session_status", {
    sessionId: state.sessionId,
  });
  assert.equal(status.structuredContent.state, "active");
  const located = await call("camofox_locate", {
    tabId: state.tabId,
    prompt: "a purple elephant",
  });
  assert.equal(located.structuredContent.boxes.length, 0);
  assert(
    located.content.some(
      (c) => c.type === "image" && c.mimeType === "image/png",
    ),
  );
  console.log(
    "Live MCP: 26 tools, validated structured session output, zero-match result with actual image block",
  );
  const invalid = await client.callTool({
    name: "camofox_session_status",
    arguments: { sessionId: "not-found" },
  });
  assert(invalid.isError);
  assert.equal(invalid.structuredContent.problem.code, "session_not_found");
  console.log("REST/MCP structured application error parity verified");
} finally {
  await client.close();
}
