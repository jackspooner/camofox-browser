import test from "node:test";
import assert from "node:assert/strict";
import {
  validateClickTarget,
  coordinateClick,
} from "../../lib/coordinate-click.js";
import {
  buildRequest,
  adaptResponse,
  TOOL_DEFS,
} from "../../mcp/lib/tool-contracts.mjs";
test("coordinate clicks reject ambiguous, non-finite, and off-screen inputs before dispatch", async () => {
  for (const input of [
    {},
    { ref: "e1", coordinates: { x: 1, y: 1 } },
    { coordinates: { x: NaN, y: 1 } },
    { coordinates: { x: 1, y: 1 }, doubleClick: "yes" },
  ])
    assert.throws(() => validateClickTarget(input));
  const calls = [];
  const page = {
    evaluate: async () => ({ width: 200, height: 100 }),
    mouse: { click: async (...args) => calls.push(args) },
  };
  await assert.rejects(() => coordinateClick(page, { x: 200, y: 50 }));
  assert.equal(calls.length, 0);
  await coordinateClick(page, { x: 100, y: 50 }, true);
  assert.deepEqual(calls, [[100, 50, { clickCount: 2 }]]);
});
test("MCP carries coordinates and explicit sessions; locate images are image blocks, not JSON text", () => {
  const ctx = { userId: "agent", sessionKey: "default" };
  const click = buildRequest(
    "camofox_click",
    { tabId: "t", coordinates: { x: 8, y: 9 }, sessionId: "saved" },
    ctx,
  );
  assert.deepEqual(click.body.coordinates, { x: 8, y: 9 });
  assert.equal(click.body.sessionId, "saved");
  const locate = buildRequest(
    "camofox_locate",
    { tabId: "t", prompt: "blue buttons" },
    ctx,
  );
  assert.equal(locate.path, "/tabs/t/locate");
  const content = adaptResponse(locate, {
    observationId: "o",
    boxes: [{ targetNumber: 1 }],
    screenshot: { data: "PNG", mimeType: "image/png" },
  });
  assert.equal(content[1].type, "image");
  assert(!content[0].text.includes("PNG"));
  const confirm = buildRequest(
    "camofox_click_target",
    { observationId: "o", targetNumber: 1 },
    ctx,
  );
  assert.equal(confirm.path, "/observations/o/click");
  assert.equal(new Set(TOOL_DEFS.map((d) => d.name)).size, TOOL_DEFS.length);
});
