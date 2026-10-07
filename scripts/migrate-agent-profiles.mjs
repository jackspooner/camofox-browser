#!/usr/bin/env node
// Run with the new supervisor stopped. Copies old state; never modifies it.
import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { Store } from "../lib/platform/store.js";
import { loadPlatformConfig } from "../lib/config.js";
const source = process.argv[2];
if (!source)
  throw new Error(
    "Usage: node scripts/migrate-agent-profiles.mjs OLD_PROFILE_DIRECTORY",
  );
const config = loadPlatformConfig();
const store = new Store(config.stateDir);
let count = 0;
try {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const state = join(source, entry.name, "storage-state.json");
    if (!existsSync(state)) continue;
    const name = `imported-${entry.name}`;
    if (store.profiles().some((p) => p.name === name)) continue;
    const data = JSON.parse(readFileSync(state, "utf8"));
    if (!Array.isArray(data.cookies) || !Array.isArray(data.origins))
      throw new Error("Invalid stored profile");
    const profile = store.createProfile(name),
      target = join(config.stateDir, "profiles", profile.id);
    mkdirSync(target, { recursive: true, mode: 0o700 });
    copyFileSync(state, join(target, "import-storage.json"));
    chmodSync(join(target, "import-storage.json"), 0o600);
    count++;
  }
  console.log(`Imported ${count} profiles; source files retained.`);
} finally {
  store.close();
}
