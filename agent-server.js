import express from "express";
import { applicationProblem } from "./mcp/lib/problems.mjs";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { loadPlatformConfig } from "./lib/config.js";
import { requireAuth } from "./lib/auth.js";
import { recoverWorkers } from "./lib/platform/worker-launcher.js";
import { Supervisor } from "./lib/platform/supervisor.js";
import { ProtonProvider } from "./lib/platform/proton-launcher.js";
import { installPlatformRoutes } from "./lib/platform/routes.js";
import { installViewer } from "./lib/platform/viewer.js";
import { agentSpec } from "./lib/platform/openapi.js";
import { mountDocs } from "./lib/openapi.js";

const config = loadPlatformConfig();
mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
await recoverWorkers(config);
const supervisor = new Supervisor(config, new ProtonProvider(config));
const app = express();
const server = createServer(app);
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    service: "camofox-agent",
    browser: "156.0.1-beta.36",
    activeSessions: supervisor.workers.size,
  }),
);
const openViewer = installViewer(app, server, supervisor, config);
// Viewer uses short-lived, single-use tickets; all agent routes use bearer auth.
app.use((req, res, next) => {
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
    return res.status(403).json({ error: "Origin rejected" });
  return requireAuth(config)(req, res, next);
});
installPlatformRoutes(app, supervisor, config, openViewer);
mountDocs(app, {
  transformSpec: agentSpec,
  apis: ["./server.js", "./lib/platform/routes.js", "./lib/platform/viewer.js"],
});
app.use((err, _req, res, _next) => {
  console.error("Agent request failed:", err.code || err.message);
  const problem = applicationProblem(err);
  res
    .status(problem.status)
    .json({ error: problem.detail, code: problem.code, problem });
});
server.listen(config.port, config.bindHost || "127.0.0.1", () =>
  console.log(`Camofox agent listening on ${config.port}`),
);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    server.close();
    await supervisor.close();
    process.exit(0);
  });
