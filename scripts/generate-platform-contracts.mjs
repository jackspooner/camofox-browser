import { ERROR_CODES } from '../mcp/lib/problems.mjs';
// Generate route-adjacent OpenAPI metadata from the shared MCP/HTTP descriptors.
import { readFileSync, writeFileSync } from "node:fs";
import { pendingOperationSchema, operationSchema } from '../mcp/lib/operation-contracts.mjs';
import { PLATFORM_TOOLS } from "../mcp/lib/platform-contracts.mjs";
const file = new URL("../lib/platform/routes.js", import.meta.url);
let source = readFileSync(file, "utf8");
const oa = (value) => {
  if(value===operationSchema)return {$ref:'#/components/schemas/Operation'};
  if(value===pendingOperationSchema)return {$ref:'#/components/schemas/PendingOperation'};
  if (Array.isArray(value)) return value.map(oa);
  if (!value || typeof value !== "object") return value;
  const o = Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, oa(v)]),
  );
  if (Array.isArray(o.type) && o.type.includes("null")) {
    o.type = o.type.find((t) => t !== "null");
    o.nullable = true;
  }
  return o;
};
for (const d of PLATFORM_TOOLS) {
  const pathParams = [...d.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  const properties = Object.fromEntries(
    Object.entries(d.inputSchema.properties).filter(
      ([k]) => !pathParams.includes(k),
    ),
  );
  const schema = oa(d.outputSchema.anyOf[0]);
  if (d.name === "camofox_locate") {
    schema.properties.screenshot = {
      type: "object",
      required: ["data", "mimeType"],
      properties: {
        data: { type: "string", format: "byte" },
        mimeType: { type: "string", enum: ["image/png"] },
      },
    };
    schema.required.push("screenshot");
  }
  const op = {
    operationId: d.operationId,
    tags: [
      d.name.includes("locate") || d.name.includes("click_target")
        ? "Interaction"
        : "Sessions",
    ],
    summary: d.description,
    security: [{ AccessKeyAuth: [] }],
    parameters: pathParams.map((name) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    })),
    responses: {
      [d.name.endsWith("_create") ? "201" : "200"]: {
        description: "Operation result",
        content: { "application/json": { schema } },
      },
      400: { description: "Invalid request" },
      404: { description: "Profile, session or tab not found" },
      409: {
        description:
          "Ownership conflict, active operation, or stale observation",
      },
      422: { description: "Request cannot be applied, including stale refs or unavailable country" },
      503: { description: "Browser or Proton provider unavailable" },
    },
    "x-agent-notes": {
      sideEffects: d.annotations.readOnlyHint ? "none" : d.description,
      consistency: {
        refresh: d.annotations.readOnlyHint
          ? "none"
          : "Read session status or take a fresh snapshot",
      },
    },
  };
  if (['camofox_click_target','camofox_capture_sequence'].includes(d.name)) op.responses[202]={description:'Operation accepted and still pending',content:{'application/json':{schema:oa(pendingOperationSchema)}}};
  if (d.method === 'GET') for(const [name,schema] of Object.entries(properties)) op.parameters.push({name,in:'query',required:d.inputSchema.required.includes(name),schema:oa(schema)});
  if (d.method === 'GET' && (d.name.startsWith('camofox_operation_') || d.name==='camofox_capture_sequence_status')) op.parameters.push({name:'userId',in:'query',required:true,schema:{type:'string'}});
  if (d.method !== "GET")
    op.requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: oa({
            type: "object",
            properties: {
              ...properties,
              userId: { type: "string", minLength: 1, maxLength: 256 },
            },
            required: [
              ...d.inputSchema.required.filter((k) => !pathParams.includes(k)),
              "userId",
            ],
            additionalProperties: false,
            ...(d.inputSchema.oneOf ? {oneOf:d.inputSchema.oneOf} : {}),
          }),
        },
      },
    };
  for (const code of [...new Set([400, 403, 404, 409, 422, 429, 502, 503, 500, ...d.errors.map(code => ERROR_CODES[code])])]) {
    op.responses[code] ||= { description: "Application failure" };
    op.responses[code].content = {
      "application/json": {
        schema: { $ref: "#/components/schemas/AgentError" },
      },
    };
  }
  op["x-error-codes"] = d.errors;
  const block = JSON.stringify({ [d.path]: { [d.method.toLowerCase()]: op } });
  source = source.replace(
    new RegExp(' \\* \\{[^\\n]*"operationId":"' + d.operationId + '"[^\\n]*'),
    " * " + block,
  );
}
writeFileSync(file, source);
// OpenClaw ownership and package discovery consume the same canonical catalog.
const { TOOL_DEFS } = await import('../mcp/lib/tool-contracts.mjs');
const packageFile = new URL('../package.json', import.meta.url);
const packageJson = JSON.parse(readFileSync(packageFile, 'utf8'));
packageJson.openclaw.tools = TOOL_DEFS.map(({name, description}) => ({name, description}));
writeFileSync(packageFile, JSON.stringify(packageJson, null, 2) + '\n');
const manifestFile = new URL('../openclaw.plugin.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
manifest.contracts.tools = TOOL_DEFS.map(t => t.name);
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
