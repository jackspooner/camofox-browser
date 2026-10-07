#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlatformConfig } from "../lib/config.js";
const config = loadPlatformConfig();
mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
const child = spawn(
  "flock",
  [
    "-n",
    "-F",
    join(config.stateDir, "supervisor.lock"),
    process.execPath,
    fileURLToPath(new URL("../agent-server.js", import.meta.url)),
  ],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code || 0));
