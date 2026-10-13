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

test("viewer transfer is an additive capability-only route, not an MCP tool", () => {
  const spec = JSON.parse(readFileSync(new URL('../../agent-openapi.json', import.meta.url)));
  const route = spec.paths['/viewer/transfer'].post;
  assert.equal(route.operationId, 'camofox_viewer_transfer');
  assert.deepEqual(route.security, [{ ViewerCapabilityAuth: [] }]);
  assert.equal(route['x-internal'], true);
  assert.deepEqual(route.requestBody.content['application/json'].schema, { type: 'object', additionalProperties: false });
  assert.deepEqual(route.responses['200'].content['application/json'].schema.required, ['url', 'expiresInSeconds']);
  assert(!PLATFORM_TOOLS.some(tool => tool.path === '/viewer/transfer'));
});
