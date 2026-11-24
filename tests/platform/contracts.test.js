import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import swaggerJsdoc from "swagger-jsdoc";
import { swaggerDefinition } from "../../lib/openapi.js";
import { agentSpec } from "../../lib/platform/openapi.js";
import {
  PLATFORM_TOOLS,
  platformRequest,
} from "../../mcp/lib/platform-contracts.mjs";
test("generated agent OpenAPI is fresh and platform REST/MCP schemas have one owner", () => {
  const spec = agentSpec(
    swaggerJsdoc({
      definition: swaggerDefinition,
      apis: ["./server.js", "./lib/platform/routes.js", "./lib/platform/viewer.js"],
    }),
  );
  assert.deepEqual(
    spec,
    JSON.parse(
      readFileSync(new URL("../../agent-openapi.json", import.meta.url)),
    ),
  );
  for (const d of PLATFORM_TOOLS) {
    const operation = spec.paths[d.path][d.method.toLowerCase()];
    assert.equal(operation.operationId, d.operationId);
    assert.deepEqual(operation["x-error-codes"], d.errors);
    if (d.method === "POST")
      assert.deepEqual(
        operation.requestBody.content["application/json"].schema.required,
        [
          ...d.inputSchema.required.filter((k) => !d.path.includes(`{${k}}`)),
          "userId",
        ],
      );
  }
  assert(!spec.paths["/browser/stop"]);
});
test("drag validates the two endpoint unions independently", () => {
  const variants = [{coordinates:{x:1,y:2}}, {selector:'#card'}, {ref:'e1'},
    {observationId:'observed',targetNumber:2}, {prompt:'Drop zone'}];
  const request = (from, to) => platformRequest('camofox_drag', {tabId:'tab',from,to}, {userId:'agent'});
  for (const from of variants) for (const to of variants) {
    assert.deepEqual(request(from, to).body, {userId:'agent', from, to});
  }
  for (const bad of [null, {}, {prompt:' '}, {ref:'e1',prompt:'card'}, {coordinates:{x:0,y:Infinity}},
    {observationId:'missing number'}, {observationId:'o',targetNumber:0}, {coordinates:{x:-1,y:20}}]) {
    assert.throws(() => request(bad, variants[0]));
    assert.throws(() => request(variants[0], bad));
  }
});
test("invalid country selection cannot silently become a direct session", () => {
  for (const country of ["", false, 0])
    assert.throws(() =>
      platformRequest(
        "camofox_session_create",
        { profileId: "p", country },
        { userId: "a" },
      ),
    );
  assert.throws(() =>
    platformRequest(
      "camofox_session_route",
      { sessionId: "s" },
      { userId: "a" },
    ),
  );
  assert.equal(
    platformRequest(
      "camofox_session_route",
      { sessionId: "s", country: null },
      { userId: "a" },
    ).body.country,
    null,
  );
});
