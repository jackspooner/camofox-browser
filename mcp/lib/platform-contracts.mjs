import { ERROR_CODES, problemSchema } from "./problems.mjs";
const text = { type: "string", minLength: 1 };
const session = {
  sessionId: { ...text, description: "Saved session identifier." },
};
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const array = (items) => ({ type: "array", items });
const profile = object({ id: text, name: text, created: { type: "integer" } });
const sessionProperties = {
  automationPaused: {type:"boolean"},
  id: text,
  profileId: text,
  name: text,
  owner: { type: ["string", "null"] },
  state: { enum: ["starting", "active", "suspending", "suspended"] },
  country: { type: ["string", "null"] },
  lastActivity: { type: "integer" },
};
const viewer = object({ state: { type: "string", enum: ["closed", "opening", "connected"] }, mode: { type: "string", enum: ["watch", "control"] } });
const sessionOutput = object(
  {
    ...sessionProperties,
    tabCount: { type: "integer" },
    humanControl: { type: "boolean" },
    viewer,
    routing: object({
      country: { type: ["string", "null"] },
      ready: { type: "boolean" },
    }),
    resumption: { enum: ["live", "restored"] },
    restorationLimits: array(text),
  },
  [...Object.keys(sessionProperties), "tabCount", "humanControl", "viewer", "routing"],
);
const box = object(
  {
    targetNumber: { type: "integer", minimum: 1 },
    x1: { type: "number" },
    y1: { type: "number" },
    x2: { type: "number" },
    y2: { type: "number" },
  },
  ["targetNumber", "x1", "y1", "x2", "y2"],
);
const outputs = {
  session_control: object({ sessionId: text, requestId: text, action: { type: 'string', enum: ['give', 'request'] }, outcome: { type: 'string', enum: ['accepted', 'declined', 'timed_out', 'cancelled', 'already_in_mode'] }, ...viewer.properties }),
  session_watch: object({ sessionId: text, ...viewer.properties }),
  profile_list: object({ profiles: array(profile) }),
  profile_create: profile,
  session_list: object({ sessions: array(object(sessionProperties)) }),
  session_viewer: object({
    sessionId: text,
    url: text,
    expiresInSeconds: { type: "integer" },
    humanControl: { type: "boolean" },
  }),
  vpn_countries: object({
    countries: array(object({ code: text, name: text })),
    maxConnections: { type: "integer" },
  }),
  vpn_status: object(
    {
      authenticated: { type: "boolean" },
      setupRequired: { type: "boolean" },
      code: text,
    },
    ["authenticated", "setupRequired"],
  ),
  locate: object({
    observationId: text,
    tabId: text,
    width: { type: "integer" },
    height: { type: "integer" },
    boxes: array(box),
    nextAction: text,
  }),
  click_target: object(
    {
      ok: { type: "boolean" },
      tabId: text,
      coordinates: object({ x: { type: "number" }, y: { type: "number" } }),
      url: { type: "string" },
      code: text,
      retryable: { type: "boolean" },
    },
    ["ok"],
  ),
};

const operations = [
  [
    'session_control',
    'Offer control to the user (give) or ask them to return it (request). Shows an Accept/Decline prompt in the connected viewer for 15 seconds and waits for the outcome; never takes control without acceptance.',
    'POST', '/agent-sessions/{sessionId}/control',
    { ...session, action: { type: 'string', enum: ['give', 'request'] } },
    ['sessionId', 'action'],
  ],
  [
    "profile_list",
    "List saved login profiles",
    "GET",
    "/profiles",
    {},
    [],
    true,
  ],
  [
    "profile_create",
    "Create a named persistent login profile",
    "POST",
    "/profiles",
    { name: text },
    ["name"],
  ],
  [
    "session_list",
    "List saved sessions and ownership",
    "GET",
    "/agent-sessions",
    {},
    [],
    true,
  ],
  [
    "session_create",
    "Start a session in a named profile; optionally route through a Proton country",
    "POST",
    "/agent-sessions",
    { profileId: text, name: text, country: text },
    ["profileId"],
  ],
  [
    "session_status",
    "Read session status without extending its idle lifetime",
    "GET",
    "/agent-sessions/{sessionId}",
    session,
    ["sessionId"],
    true,
  ],
  [
    "session_resume",
    "Claim and resume a saved session; returns live or restored state. Failed startup releases the active profile reservation.",
    "POST",
    "/agent-sessions/{sessionId}/resume",
    session,
    ["sessionId"],
  ],
  [
    "session_release",
    "Release ownership so another agent can resume this session",
    "POST",
    "/agent-sessions/{sessionId}/release",
    session,
    ["sessionId"],
  ],
  [
    "session_suspend",
    "Checkpoint and close this session; login profile and tabs are retained. Network cleanup failures remain errors, but a stopped worker is reported as suspended.",
    "POST",
    "/agent-sessions/{sessionId}/suspend",
    session,
    ["sessionId"],
  ],
  [
    "session_route",
    "Checkpoint and restart the session through a Proton country; null selects direct routing",
    "POST",
    "/agent-sessions/{sessionId}/route",
    { ...session, country: { type: ["string", "null"] } },
    ["sessionId", "country"],
  ],
  [
    "session_viewer",
    "Open a one-time authenticated human login viewer; agent mutations pause until it closes",
    "POST",
    "/agent-sessions/{sessionId}/viewer",
    session,
    ["sessionId"],
  ],
  [
    "session_watch",
    "Open or close the desktop watch window. Watching permits agent work; human takeover pauses mutations. Repeated opens preserve the current mode.",
    "POST",
    "/agent-sessions/{sessionId}/watch",
    { ...session, open: { type: "boolean" } },
    ["sessionId", "open"],
  ],
  [
    "vpn_countries",
    "List countries available to the authenticated Proton account",
    "GET",
    "/vpn/countries",
    {},
    [],
    true,
  ],
  [
    "vpn_status",
    "Read Proton account readiness without revealing credentials. Interrupted provider processes report unavailable readiness.",
    "GET",
    "/vpn/status",
    {},
    [],
    true,
  ],
  [
    "locate",
    "Locate areas described by prompt. Inspect the numbered image before making a separate click_target call. Never clicks automatically.",
    "POST",
    "/tabs/{tabId}/locate",
    { tabId: text, prompt: text },
    ["tabId", "prompt"],
  ],
  [
    "click_target",
    "Click the centre of a numbered target after visually inspecting its locate image. Stale observations require another locate.",
    "POST",
    "/observations/{observationId}/click",
    { observationId: text, targetNumber: { type: "integer", minimum: 1 } },
    ["observationId", "targetNumber"],
  ],
];
export const PLATFORM_TOOLS = operations.map(
  ([
    name,
    description,
    method,
    path,
    properties,
    required,
    readOnly = false,
  ]) => ({
    name: `camofox_${name}`,
    title: description.split(";")[0],
    description,
    method,
    path,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      anyOf: [
        outputs[name] || sessionOutput,
        object({ problem: problemSchema }),
      ],
    },
    errors: Object.keys(ERROR_CODES),
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: false,
      idempotentHint:
        readOnly ||
        ["session_resume", "session_suspend", "session_watch", "click_target"].includes(name),
      openWorldHint: !readOnly,
    },
    operationId: `camofox_${name}`,
  }),
);
export function platformRequest(name, args, ctx) {
  const d = PLATFORM_TOOLS.find((t) => t.name === name);
  if (!d) return null;
  for (const k of d.inputSchema.required)
    if (args[k] === undefined) throw new Error(`${k} required`);
  if (Object.keys(args).some((k) => !(k in d.inputSchema.properties)))
    throw new Error("Unknown tool argument");
  for (const [key, value] of Object.entries(args)) {
    const schema = d.inputSchema.properties[key];
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const valid = types.some((type) =>
      type === "null"
        ? value === null
        : type === "integer"
          ? Number.isInteger(value)
          : typeof value === type,
    );
    if (
      !valid ||
      (schema.enum && !schema.enum.includes(value)) ||
      (typeof value === "string" && schema.minLength && !value.trim()) ||
      (typeof value === "number" &&
        (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity)))
    )
      throw new Error(`Invalid ${key}`);
  }
  let path = d.path.replace(/\{([^}]+)\}/g, (_, k) =>
    encodeURIComponent(args[k]),
  );
  const body = Object.fromEntries(
    Object.entries(args).filter(([k]) => !d.path.includes(`{${k}}`)),
  );
  body.userId = ctx.userId;
  if (d.method === "GET")
    path += `?${new URLSearchParams({ userId: ctx.userId })}`;
  return {
    method: d.method,
    path,
    auth: "accessKey",
    responseKind: name === "camofox_locate" ? "snapshot" : "json",
    ...(d.method === "GET" ? {} : { body }),
  };
}
