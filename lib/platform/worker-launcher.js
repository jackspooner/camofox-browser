import { spawn } from "node:child_process";
import {
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
const root = fileURLToPath(new URL("../../", import.meta.url));
export function startWorker(
  config,
  session,
  profileDir,
  socket,
  namespace = null,
) {
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const log = openSync(join(profileDir, "worker.log"), "a", 0o600);
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: "en_GB.UTF-8",
    CAMOUFOX_VIRTUAL_DISPLAY_SIZE: "1920x1080x24",
    CAMOFOX_NATIVE_PROFILE: profileDir,
    CAMOFOX_WORKER_SOCKET: socket,
    CAMOFOX_PORT: "0",
    CAMOFOX_WORKER_SESSION: session.id,
    CAMOFOX_ACCESS_KEY: config.workerKey,
    CAMOFOX_API_KEY: config.workerKey,
    CAMOFOX_BIND_HOST: "127.0.0.1",
    CAMOFOX_CRASH_REPORT_ENABLED: "false",
    SESSION_TIMEOUT_MS: "0",
    BROWSER_IDLE_TIMEOUT_MS: "0",
    TAB_INACTIVITY_MS: "2147483647",
    NATIVE_MEM_RESTART_THRESHOLD_MB: "2147483647",
    BROWSER_RSS_RESTART_THRESHOLD_MB: "2147483647",
    XDG_CACHE_HOME: join(config.stateDir, "cache"),
    CAMOUFOX_INSTALL_DIR: config.browserDir,
    CAMOFOX_DISABLE_DEFAULT_ADDONS: "true",
    CAMOFOX_PROFILE_DIR: join(profileDir, "storage"),
    CAMOFOX_COOKIES_DIR: join(profileDir, "cookies"),
    CAMOFOX_UPLOADS_DIR: join(profileDir, "uploads"),
    CAMOFOX_TRACES_DIR: join(profileDir, "traces"),
    CAMOFOX_WORKER_CHECKPOINT: JSON.stringify(session.checkpoint),
  };
  writeFileSync(join(profileDir, "worker-env.json"), JSON.stringify(env), {
    mode: 0o600,
  });
  const args = [join(root, "server.js")];
  // The helper receives a fixed worker identifier, never an arbitrary executable.
  const child = namespace
    ? spawn(
        "sudo",
        [
          "-n",
          config.vpnHelper,
          "worker",
          namespace,
          profileDir,
          socket,
          session.id,
        ],
        { cwd: root, env, stdio: ["ignore", log, log] },
      )
    : spawn(
        "flock",
        [
          "-n",
          "-F",
          join(profileDir, "profile.lock"),
          process.execPath,
          ...args,
        ],
        { cwd: root, env, stdio: ["ignore", log, log] },
      );
  closeSync(log);
  if (child.pid) {
    const stat = readFileSync(`/proc/${child.pid}/stat`, "utf8");
    writeFileSync(
      join(profileDir, "worker-process.json"),
      JSON.stringify({
        pid: child.pid,
        birth: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19],
        namespace,
      }),
      { mode: 0o600 },
    );
  }
  return child;
}
export function workerRequest(socketPath, key, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path,
        method,
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > 32 * 1024 * 1024)
            req.destroy(new Error("Worker response too large"));
          else chunks.push(c);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            type: res.headers["content-type"],
            bytes: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.setTimeout(["/internal/checkpoint", "/internal/display", "/internal/viewer-mode"].includes(path) ? 10000 : 650000, () =>
      req.destroy(new Error("Worker request timed out")),
    );
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
export async function workerJson(...args) {
  const r = await workerRequest(...args);
  const data = JSON.parse(r.bytes.toString());
  if (r.status >= 400)
    throw Object.assign(new Error(data.error || "Worker request failed"), {
      code: data.code,
      statusCode: r.status,
    });
  return data;
}

export async function recoverWorkers(config) {
  const { readdirSync, readFileSync, existsSync, unlinkSync } =
    await import("node:fs");
  const profiles = join(config.stateDir, "profiles");
  if (!existsSync(profiles)) return;
  for (const entry of readdirSync(profiles, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(profiles, entry.name, "worker-process.json");
    if (!existsSync(file)) continue;
    const record = JSON.parse(readFileSync(file, "utf8"));
    try {
      const stat = readFileSync(`/proc/${record.pid}/stat`, "utf8");
      const birth = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
      if (birth !== record.birth) continue;
      process.kill(record.pid, "SIGTERM");
      for (let i = 0; i < 100 && existsSync(`/proc/${record.pid}`); i++)
        await new Promise((r) => setTimeout(r, 100));
      if (existsSync(`/proc/${record.pid}`))
        throw new Error(
          "Previous browser worker did not stop; refusing to reuse its profile",
        );
    } catch (e) {
      if (e.code !== "ENOENT" && e.code !== "ESRCH") throw e;
    }
    if (record.namespace)
      await new Promise((resolve, reject) => {
        const child = spawn(
          "sudo",
          ["-n", config.vpnHelper, "down", record.namespace],
          { stdio: "ignore" },
        );
        child.once("error", reject);
        child.once("exit", (code) =>
          code
            ? reject(new Error("Could not clean up previous tunnel"))
            : resolve(),
        );
      });
    unlinkSync(file);
  }
}
