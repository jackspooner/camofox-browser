import { readFileSync } from "node:fs";
const env = JSON.parse(readFileSync(process.argv[2], "utf8"));
for (const [k, v] of Object.entries(env))
  if (v !== undefined) process.env[k] = String(v);
await import("../../server.js");
