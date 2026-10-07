import { randomUUID, createHash } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { viewerStatus } from "./viewer.js";
import { Store, problem } from "./store.js";
import { startWorker, workerJson, workerRequest } from "./worker-launcher.js";
export class Supervisor {
  constructor(config, vpn) {
    this.config = { ...config, workerKey: randomUUID() };
    this.vpn = vpn;
    this.store = new Store(config.stateDir);
    this.workers = new Map();
    this.locks = new Map();
    this.observations = new Map();
    // Singleton service lease is acquired by the entrypoint before opening this store.
    for (const s of this.store.sessions())
      this.store.update(s.id, { state: "suspended" });
    this.timer = setInterval(
      () =>
        this.maintain().catch((e) =>
          console.error("Session maintenance:", e.message),
        ),
      15000,
    );
    this.timer.unref();
  }
  async serial(id, fn) {
    const prior = this.locks.get(id) || Promise.resolve();
    const next = prior.catch(() => {}).then(fn);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }
  publicSession(id) {
    const { checkpoint, ...s } = this.store.session(id);
    return {
      ...s,
      tabCount: checkpoint.tabs?.length || 0,
      humanControl: !!this.workers.get(id)?.humanControl,
      viewer: viewerStatus(this.workers.get(id)),
      routing: s.country
        ? { country: s.country, ready: !!this.workers.get(id)?.route?.ready }
        : { country: null, ready: s.state === "active" },
    };
  }
  async resume(id, owner) {
    return this.serial(id, () => this.resumeUnlocked(id, owner));
  }
  async resumeUnlocked(id, owner) {
    let s = this.store.claim(id, owner);
    if (this.workers.has(id)) {
      this.touch(id);
      return { ...this.publicSession(id), resumption: "live" };
    }
    const profileDir = join(this.config.stateDir, "profiles", s.profileId);
    mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    const lastFile = join(profileDir, "checkpoint.json");
    if (existsSync(lastFile)) {
      const recovered = JSON.parse(readFileSync(lastFile));
      if (
        recovered.sessionId === id &&
        recovered.savedAt > (s.checkpoint.savedAt || 0)
      )
        s.checkpoint = recovered;
    }
    const socket = join(this.config.stateDir, `${id.slice(0, 8)}.sock`);
    rmSync(socket, { force: true });
    let route = null,
      worker;
    try {
      if (s.country) route = await this.vpn.connect(s.country, id);
      const child = startWorker(
        this.config,
        s,
        profileDir,
        socket,
        route?.namespace,
      );
      worker = { child, socket, route, busy: 0, viewer: null, humanControl: false, requireFreshSnapshot: new Set((s.checkpoint.tabs || []).map(t => t.id)) };
      this.workers.set(id, worker);
      child.on("error", () => {});
      child.once("exit", () => {
        if (this.workers.get(id) === worker) {
          this.workers.delete(id);
          this.store.update(id, { state: "suspended" });
          worker.viewer?.close({ checkpoint: false });
          if (route) this.vpn.disconnect(route).catch(() => {});
        }
      });
      const deadline = Date.now() + 180000;
      let ready = false;
      while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null)
          throw problem(
            "worker_failed",
            "Browser worker failed to start; inspect its private log",
            503,
          );
        try {
          const cp = await workerJson(
            socket,
            this.config.workerKey,
            "GET",
            "/internal/checkpoint",
          );
          this.store.update(id, {
            checkpoint: cp,
            state: "active",
            lastActivity: Date.now(),
          });
          ready = true;
          break;
        } catch (e) {
          if (e.statusCode && e.statusCode !== 503) throw e;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!ready)
        throw problem(
          "worker_timeout",
          "Browser worker did not become ready",
          503,
        );
      return {
        ...this.publicSession(id),
        resumption: "restored",
        restorationLimits: [
          "Page JavaScript memory and unsaved forms may not survive suspension.",
        ],
      };
    } catch (e) {
      if (worker) {
        this.workers.delete(id);
        worker.child.kill("SIGTERM");
      }
      if (route) await this.vpn.disconnect(route).catch(() => {});
      this.store.update(id, { state: "suspended" });
      throw e;
    }
  }
  async changeRoute(id, owner, country) {
    return this.serial(id, async () => {
      this.store.checkOwner(id, owner);
      await this.suspendUnlocked(id, owner);
      this.store.update(id, { country });
      return this.resumeUnlocked(id, owner);
    });
  }
  touch(id) {
    this.store.update(id, { lastActivity: Date.now() });
  }
  async checkpoint(id) {
    const w = this.workers.get(id);
    if (!w) return;
    const cp = await workerJson(
      w.socket,
      this.config.workerKey,
      "GET",
      "/internal/checkpoint",
    );
    this.store.update(id, { checkpoint: cp });
    const s = this.store.session(id);
    if (cp.lastHumanActivity > s.lastActivity)
      this.store.update(id, { lastActivity: cp.lastHumanActivity });
    return cp;
  }
  async suspend(id, owner) {
    return this.serial(id, () => this.suspendUnlocked(id, owner));
  }
  async suspendUnlocked(id, owner, { force = false } = {}) {
    this.store.checkOwner(id, owner);
    const w = this.workers.get(id);
    if (!w) return this.publicSession(id);
    if (!force && (w.busy || w.humanControl))
      throw problem(
        "session_busy",
        "Session has an active operation or human viewer",
      );
    w.viewer?.close({ checkpoint: false });
    this.store.update(id, { state: "suspending" });
    try {
      await this.checkpoint(id);
    } catch (e) {
      if (!force) {
        this.store.update(id, { state: "active" });
        throw e;
      }
    }
    this.workers.delete(id);
    w.child.kill("SIGTERM");
    await new Promise((resolve) => {
      if (w.child.exitCode !== null || w.child.signalCode !== null)
        return resolve();
      const t = setTimeout(() => {
        w.child.kill("SIGKILL");
        resolve();
      }, 15000);
      w.child.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
    if (w.route) await this.vpn.disconnect(w.route);
    rmSync(w.socket, { force: true });
    this.store.update(id, { state: "suspended" });
    for (const [key, o] of this.observations)
      if (o.sessionId === id) this.observations.delete(key);
    return this.publicSession(id);
  }
  async release(id, owner) {
    return this.serial(id, async () => {
      this.store.checkOwner(id, owner);
      const w = this.workers.get(id);
      if (w?.busy || w?.humanControl)
        throw problem(
          "session_busy",
          "Finish the current operation before release",
        );
      w?.viewer?.close({ checkpoint: false });
      this.store.update(id, { owner: null });
      return this.publicSession(id);
    });
  }
  async run(id, owner, fn, { readOnly = false } = {}) {
    if (this.workers.get(id)?.humanControl && !readOnly)
      throw problem("human_control", "Human control is active or pending");
    return this.serial(id, async () => {
      const s = this.store.checkOwner(id, owner);
      const w = this.workers.get(id);
      if (!w || s.state !== "active")
        throw problem(
          "session_suspended",
          "Resume the session before using its tabs",
        );
      if (w.humanControl && !readOnly)
        throw problem("human_control", "Human login viewer owns this session");
      w.busy++;
      this.touch(id);
      try {
        return await fn(w);
      } finally {
        w.busy--;
        await this.checkpoint(id).catch(() => {});
      }
    });
  }
  async defaultSession(owner, key = "default") {
    return this.serial(`default:${owner}:${key}`, async () => {
      let row = this.store.db
        .prepare(
          "SELECT sessionId FROM defaults WHERE owner=? AND sessionKey=?",
        )
        .get(owner, key);
      if (!row) {
        const hash = createHash("sha256")
          .update(`${owner}:${key}`)
          .digest("hex")
          .slice(0, 20);
        let profile = this.store
          .profiles()
          .find((p) => p.name === `default-${hash}`);
        if (!profile) profile = this.store.createProfile(`default-${hash}`);
        const s = this.store.createSession(profile.id, "Default", owner);
        row = { sessionId: s.id };
        this.store.db
          .prepare("INSERT INTO defaults VALUES (?,?,?)")
          .run(owner, key, s.id);
      }
      if (!this.workers.has(row.sessionId))
        await this.resume(row.sessionId, owner);
      return row.sessionId;
    });
  }
  findTab(id, owner) {
    for (const s of this.store.sessions()) {
      const full = this.store.session(s.id);
      if (full.checkpoint.tabs?.some((t) => t.id === id)) {
        this.store.checkOwner(s.id, owner);
        return s.id;
      }
    }
    throw problem("tab_not_found", "Tab not found", 404);
  }
  async proxy(id, owner, method, path, body) {
    return this.run(
      id,
      owner,
      async (w) => {
        const match = path.match(/^\/tabs\/([^/?]+)(?:\/([^/?]+))?/);
        const tabId = match && decodeURIComponent(match[1]);
        if (body?.ref && w.requireFreshSnapshot?.has(tabId))
          throw problem("stale_observation", "Human control or restoration invalidated these element refs; take a fresh snapshot first");
        const result = await workerRequest(w.socket, this.config.workerKey, method, path, body);
        if (method === "GET" && match?.[2] === "snapshot" && result.status < 400)
          w.requireFreshSnapshot?.delete(tabId);
        return result;
      },
      { readOnly: method === "GET" },
    );
  }
  async maintain() {
    for (const [id, o] of this.observations)
      if (Date.now() - o.created > 300000) this.observations.delete(id);
    for (const s of this.store.sessions())
      if (this.workers.has(s.id) && !this.locks.has(s.id)) {
        await this.serial(s.id, async () => {
          await this.checkpoint(s.id);
          const fresh = this.store.session(s.id);
          const w = this.workers.get(s.id);
          if (
            w &&
            !w.busy &&
            Date.now() - fresh.lastActivity >= this.config.idleMs
          ) {
            w.viewer?.close({ checkpoint: false });
            await this.suspendUnlocked(s.id, fresh.owner);
          }
        }).catch(async (e) => {
          console.error("Session checkpoint:", e.code || e.message);
          await this.serial(s.id, () => this.suspendUnlocked(s.id, this.store.session(s.id).owner, {force:true}));
        });
      }
  }
  async close() {
    clearInterval(this.timer);
    await Promise.allSettled(
      [...this.workers.keys()].map(async (id) => {
        this.workers.get(id)?.viewer?.close({ checkpoint: false });
        await this.serial(id, () =>
          this.suspendUnlocked(id, this.store.session(id).owner, {
            force: true,
          }),
        );
      }),
    );
    this.store.close();
  }
}
