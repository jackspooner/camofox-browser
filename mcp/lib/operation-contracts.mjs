// Shared operation metadata and route effects, used by runtime and OpenAPI.
export const OPERATION_STATES = [
  "queued",
  "running",
  "cancelling",
  "completed",
  "cancelled",
  "failed",
  "outcome_unknown",
];
export const terminalOperation = (state) =>
  ["completed", "cancelled", "failed", "outcome_unknown"].includes(state);
export const retryKeySchema = {
  type: "string",
  maxLength: 100,
  pattern: "^v1\\.[0-9]{13}\\.[0-9a-f-]{36}$",
  description:
    "Seven-day retry identity: v1.<Unix milliseconds>.<UUID>. Reuse only for identical arguments; never automatically replay an uncertain operation.",
};
export const operationSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "sessionId",
    "owner",
    "kind",
    "generation",
    "state",
    "created",
    "updated",
    "deadline",
    "dispatch",
    "progress",
    "resultUnavailable",
  ],
  properties: {
    id: { type: "string" },
    sessionId: { type: "string" },
    owner: { type: "string" },
    tabId: { type: ["string", "null"] },
    kind: { type: "string" },
    generation: { type: "string" },
    state: { type: "string", enum: OPERATION_STATES },
    created: { type: "integer" },
    updated: { type: "integer" },
    deadline: { type: "integer" },
    dispatch: { type: "string", enum: ["not_dispatched", "dispatched"] },
    cancellationReason: { type: ["string", "null"] },
    progress: {
      type: "object",
      additionalProperties: false,
      properties: {
        completed: { type: "integer" },
        total: { type: "integer" },
        elapsedMs: { type: "integer" },
        mode: { type: "string" },
        wpm: { type: "number" },
      },
    },
    resultUnavailable: { type: "boolean" },
    receipt: {
      type: "object",
      additionalProperties: false,
      properties: { ok: { type: "boolean" }, tabId: { type: "string" } },
    },
    problem: {
      type: "object",
      properties: { code: { type: "string" }, detail: { type: "string" } },
    },
  },
};
export const pendingOperationSchema = {
  type: "object",
  required: ["pending", "operation"],
  additionalProperties: false,
  properties: {
    pending: { type: "boolean", enum: [true] },
    operation: operationSchema,
  },
};
export const operationResultSchema = {
  type: "object",
  required: ["operation"],
  additionalProperties: false,
  properties: {
    operation: operationSchema,
    result: { description: "Original in-memory result, when retained." },
  },
};

const mutating = new Set([
  "navigate",
  "click",
  "upload",
  "type",
  "select",
  "press",
  "scroll",
  "viewport",
  "back",
  "forward",
  "refresh",
  "evaluate",
]);
const reading = new Set([
  "snapshot",
  "links",
  "images",
  "screenshot",
  "stats",
  "downloads",
]);
export function browserOperation(method, path) {
  const url = new URL(path, "http://worker");
  const p = url.pathname.replace(/\/$/, "").toLowerCase();
  if (method === "POST" && (p === "/tabs" || p === "/tabs/open"))
    return { kind: "create_tab", mutation: true };
  if (method === "GET" && p === "/tabs")
    return { kind: "list_tabs", mutation: false };
  if (method === "DELETE" && /^\/tabs\/group\/[^/]+$/.test(p))
    return { kind: "close_group", mutation: true };
  const match = p.match(/^\/tabs\/([^/]+)(?:\/([^/]+))?$/);
  if (match) {
    const tabId = decodeURIComponent(url.pathname.split("/")[2]);
    const action = match[2];
    if (method === "DELETE" && (!action || action === "downloads"))
      return {
        kind: action ? "delete_downloads" : "close_tab",
        mutation: true,
        tabId,
      };
    if (method === "POST" && mutating.has(action))
      return { kind: action, mutation: true, tabId };
    if (
      method === "POST" &&
      ["wait", "extract", "fetch-current-resource"].includes(action)
    )
      return { kind: action, mutation: false, tabId };
    if (method === "GET" && reading.has(action))
      return {
        kind: action,
        mutation:
          action === "downloads" &&
          url.searchParams.getAll("consume").includes("true"),
        tabId,
      };
  }
  if (/^\/sessions\/[^/]+\/(cookies|storage_state)$/.test(p)) {
    if (method === "GET") return { kind: "read_storage", mutation: false };
    if (method === "POST" && p.endsWith("/cookies"))
      return { kind: "import_cookies", mutation: true };
  }
  return null;
}

// OpenAPI 3.0 represents nullable types differently from MCP JSON Schema.
export function openApiSchema(value) {
  if (Array.isArray(value)) return value.map(openApiSchema);
  if (!value || typeof value !== "object") return value;
  const out = Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, openApiSchema(v)]),
  );
  if (Array.isArray(out.type) && out.type.includes("null")) {
    out.type = out.type.find((t) => t !== "null");
    out.nullable = true;
  }
  return out;
}
