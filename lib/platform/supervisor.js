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
import { applicationProblem } from "../../mcp/lib/problems.mjs";
import { OperationRegistry } from "./operations.js";
import {
  browserOperation,
  terminalOperation,
} from "../../mcp/lib/operation-contracts.mjs";
import { typingBudget } from "../paced-typing.js";
import { Store, problem } from "./store.js";
import { startWorker, workerJson, workerRequest } from "./worker-launcher.js";
export class Supervisor {
  constructor(config, vpn) {
    this.config = { ...config, workerKey: randomUUID() };
    this.vpn = vpn;
    this.store = new Store(config.stateDir);
    this.operations = new OperationRegistry(this.store, config);
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
    let route = null,
      worker;
    try {
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
      if (s.country) route = await this.vpn.connect(s.country, id);
      const generation = randomUUID();
      const child = startWorker(
        { ...this.config, workerGeneration: generation },
        s,
        profileDir,
        socket,
        route?.namespace,
      );
      worker = {
        child,
        socket,
        route,
        generation,
        busy: 0,
        viewer: null,
        humanControl: false,
        requireFreshSnapshot: new Set(
          (s.checkpoint.tabs || []).map((t) => t.id),
        ),
      };
      this.workers.set(id, worker);
      child.on("error", () => {});
      child.once("exit", () => {
        if (this.workers.get(id) === worker) {
          this.workers.delete(id);
          this.store.update(id, { state: "suspended" });
          Promise.resolve(worker.viewer?.close({ checkpoint: false }))
            .then(() => route && this.vpn.disconnect(route))
            .catch(error => console.error('Worker viewer/route cleanup failed:', error.code || 'viewer_failed'));
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
    this.store.checkOwner(id, owner);
    this.assertNoOperations(id);
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
    this.store.checkOwner(id, owner);
    this.assertNoOperations(id);
    return this.serial(id, () => this.suspendUnlocked(id, owner));
  }
  async suspendUnlocked(id, owner, { force = false } = {}) {
    this.store.checkOwner(id, owner);
    const w = this.workers.get(id);
    if (!w) return this.publicSession(id);
    if (!force && (w.busy || w.humanControl || this.operations.count(id)))
      throw problem(
        "session_busy",
        "Session has an active operation or human viewer",
      );
    await w.viewer?.close({ checkpoint: false });
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
    try {
      if (w.route) await this.vpn.disconnect(w.route);
    } finally {
      // The browser has stopped even if privileged network cleanup fails.
      // Keep the error visible without retaining a dead profile reservation.
      this.store.update(id, { state: "suspended" });
      for (const [key, o] of this.observations)
        if (o.sessionId === id) this.observations.delete(key);
      rmSync(w.socket, { force: true });
    }
    return this.publicSession(id);
  }
  async release(id, owner) {
    this.store.checkOwner(id, owner);
    this.assertNoOperations(id);
    return this.serial(id, async () => {
      this.store.checkOwner(id, owner);
      const w = this.workers.get(id);
      if (w?.busy || w?.humanControl || this.operations.count(id))
        throw problem(
          "session_busy",
          "Finish the current operation before release",
        );
      await w?.viewer?.close({ checkpoint: false });
      this.store.update(id, { owner: null });
      return this.publicSession(id);
    });
  }
  async run(id, owner, fn, { readOnly = false } = {}) {
    if (!readOnly && this.store.checkOwner(id, owner).automationPaused)
      throw problem(
        "automation_paused",
        "Automation is paused by the user; use the viewer to resume",
      );
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
      if (!readOnly && s.automationPaused)
        throw problem("automation_paused", "Automation is paused by the user");
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
  findTab(id, owner, retryKey) {
    for (const s of this.store.sessions()) {
      const full = this.store.session(s.id);
      if (full.checkpoint.tabs?.some((t) => t.id === id)) {
        this.store.checkOwner(s.id, owner);
        return s.id;
      }
    }
    if (retryKey) {
      const prior = this.store.db
        .prepare(
          "SELECT sessionId FROM operations WHERE tabId=? AND retryKey=?",
        )
        .get(id, retryKey);
      if (prior) {
        this.store.checkOwner(prior.sessionId, owner);
        return prior.sessionId;
      }
    }
    throw problem("tab_not_found", "Tab not found", 404);
  }
  assertNoOperations(id) {
    if (this.operations.count(id))
      throw problem(
        "session_busy",
        "Cancel or finish outstanding operations first",
      );
  }
  checkMutation(id, owner, generation) {
    const s = this.store.checkOwner(id, owner),
      w = this.workers.get(id);
    if (!w || s.state !== "active")
      throw problem(
        "session_suspended",
        "Resume this session before using its tabs",
      );
    if (generation && generation !== w.generation)
      throw problem(
        "operation_generation",
        "Worker changed; inspect restored state",
      );
    if (s.automationPaused)
      throw problem(
        "automation_paused",
        "Automation is paused by the user; use the viewer to resume",
      );
    if (w.humanControl)
      throw problem("human_control", "Human control is active or pending");
    return w;
  }
  async cancelOperation(operationId, owner, reason = "agent_request") {
    const row = this.operations.get(operationId);
    this.store.checkOwner(row.sessionId, owner);
    const next = this.operations.requestCancel(operationId, reason);
    if (next.state === "cancelling") {
      const w = this.workers.get(row.sessionId);
      if (w && w.generation === row.generation) {
        try {
          await workerJson(
            w.socket,
            this.config.workerKey,
            "POST",
            `/internal/operations/${row.id}/cancel`,
            { generation: row.generation },
          );
        } catch {
          await this.quarantineWorker(row.sessionId, w).catch(() => {});
          this.operations.finish(
            row.id,
            "outcome_unknown",
            undefined,
            "operation_outcome_unknown",
          );
        }
      } else
        this.operations.finish(
          row.id,
          "outcome_unknown",
          undefined,
          "operation_outcome_unknown",
        );
    }
    return this.operations.status(operationId, owner);
  }
  async quarantineWorker(id, w) {
    w.humanControl = true;
    await w.viewer?.close({ checkpoint: false });
    // Fence before killing; keep the worker reserved until its exit is confirmed.
    w.humanControl = true;
    this.store.update(id, { state: "suspending" });
    w.child.kill("SIGTERM");
    if (w.child.exitCode === null && w.child.signalCode === null)
      await new Promise((resolve, reject) => {
        const kill = setTimeout(() => w.child.kill("SIGKILL"), 1000);
        const deadline = setTimeout(() => {
          clearTimeout(kill);
          reject(
            problem(
              "worker_failed",
              "Worker teardown unconfirmed; session remains fenced",
              503,
            ),
          );
        }, 5000);
        w.child.once("exit", () => {
          clearTimeout(kill);
          clearTimeout(deadline);
          resolve();
        });
      });
    if (this.workers.get(id) === w) this.workers.delete(id);
    this.store.update(id, { state: "suspended" });
  }
  async cancelSessionOperations(id, reason = "human_takeover") {
    const owner = this.store.session(id).owner;
    const rows = this.operations.active(id);
    await Promise.all(
      rows.map((row) => this.cancelOperation(row.id, owner, reason)),
    );
    await Promise.allSettled(
      rows.map((row) => this.operations.pending.get(row.id)),
    );
  }
  async pauseAutomation(id) {
    this.store.update(id, { automationPaused: true });
    await this.cancelSessionOperations(id, "viewer_stop");
  }
  resumeAutomation(id) {
    this.assertNoOperations(id);
    this.store.update(id, { automationPaused: false });
  }
  viewerOperations(id) {
    return {
      automationPaused: !!this.store.session(id).automationPaused,
      operations: this.operations
        .active(id)
        .map((r) => this.operations.public(r.id)),
    };
  }
  async submitOperation(
    id,
    owner,
    policy,
    args,
    key,
    dispatch,
    budgetMs = 30000,
    onAdmitted,
  ) {
    this.store.checkOwner(id, owner);
    const w = this.workers.get(id);
    const { row, fresh } = this.operations.admit({
      sessionId: id,
      owner,
      tabId: policy.tabId,
      generation: w?.generation || "unavailable",
      kind: policy.kind,
      args,
      key,
      budgetMs,
      beforeInsert: () => this.checkMutation(id, owner),
    });
    onAdmitted?.(row);
    if (fresh) {
      const task = this.serial(id, async () => {
        if (terminalOperation(this.operations.get(row.id).state)) return;
        let polling, timer;
        try {
          const worker = this.checkMutation(id, owner, row.generation);
          policy.validate?.(worker);
          this.operations.update(row.id, {
            state: "running",
            updated: Date.now(),
            deadline: Date.now() + budgetMs,
          });
          const operation = this.operations.get(row.id);
          worker.busy++;
          this.touch(id);
          const poll = async () => {
            if (polling) return polling;
            polling = (async () => {
              try {
                const value = await workerJson(
                  worker.socket,
                  this.config.workerKey,
                  "GET",
                  `/internal/operations/${row.id}?generation=${row.generation}`,
                );
                this.operations.progress(row.id, value.progress);
              } catch {}
            })();
            try {
              await polling;
            } finally {
              polling = null;
            }
          };
          try {
            this.operations.update(row.id, { dispatch: "dispatched" });
            timer = setInterval(poll, 250);
            timer.unref();
            const result = await dispatch(worker, operation);
            await poll();
            let payload;
            try {
              payload = JSON.parse(result.bytes);
            } catch {
              throw problem(
                "operation_outcome_unknown",
                "Worker mutation returned an unreadable result",
              );
            }
            const code = payload.code || payload.problem?.code;
            const failure = result.status >= 400 || payload.ok === false;
            if (
              ["operation_outcome_unknown", "click_outcome_unknown"].includes(
                code,
              )
            )
              await this.quarantineWorker(id, worker).catch(() => {});
            this.operations.finish(
              row.id,
              !failure
                ? "completed"
                : [
                      "operation_outcome_unknown",
                      "click_outcome_unknown",
                    ].includes(code)
                  ? "outcome_unknown"
                  : ["operation_cancelled", "tab_timeout"].includes(code)
                    ? "cancelled"
                    : "failed",
              payload,
              failure ? code || "worker_error" : undefined,
              result.status,
            );
          } finally {
            clearInterval(timer);
            await polling;
            worker.busy--;
            await this.checkpoint(id).catch(() => {});
          }
        } catch (error) {
          const old = this.operations.get(row.id);
          if (old.dispatch === "dispatched" && this.workers.get(id) === w)
            await this.quarantineWorker(id, w).catch(() => {});
          this.operations.finish(
            row.id,
            old.dispatch === "dispatched" ? "outcome_unknown" : "failed",
            undefined,
            old.dispatch === "dispatched"
              ? "operation_outcome_unknown"
              : error.code || "worker_error",
          );
        }
      });
      this.operations.pending.set(row.id, task);
      task
        .finally(() => this.operations.pending.delete(row.id))
        .catch(() => {});
    }
    return this.operationReply(row.id);
  }
  async operationReply(operationId) {
    const row = this.operations.get(operationId);
    const pending = this.operations.pending.get(row.id);
    if (pending) {
      let timer;
      try {
        await Promise.race([
          pending,
          new Promise((resolve) => {
            timer = setTimeout(resolve, this.operations.config.initialWaitMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    const state = this.operations.response(row.id),
      op = state.operation;
    if (!terminalOperation(op.state))
      return {
        status: 202,
        type: "application/json",
        bytes: Buffer.from(JSON.stringify({ pending: true, operation: op })),
      };
    const payload = state.result;
    const value =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? { ...payload, operation: op }
        : {
            ...(payload !== undefined ? { result: payload } : {}),
            operation: op,
          };
    if (op.state !== "completed") {
      value.code = op.problem?.code || "worker_error";
      value.error ||= op.problem?.detail;
      value.problem = applicationProblem({
        code: value.code,
        message: value.error,
        statusCode: this.operations.results.get(row.id)?.httpStatus || 409,
      });
    }
    return {
      status:
        this.operations.results.get(row.id)?.httpStatus ||
        (op.state === "completed" ? 200 : 409),
      type: "application/json",
      bytes: Buffer.from(JSON.stringify(value)),
    };
  }
  async proxy(id, owner, method, path, body) {
    const policy = browserOperation(method, path);
    if (!policy)
      throw problem("invalid_request", "Unsupported browser operation", 400);
    policy.validate = (w) => {
      if (body?.ref && w.requireFreshSnapshot?.has(policy.tabId))
        throw problem(
          "stale_observation",
          "Take a fresh snapshot after restoration or human control",
        );
    };
    const dispatch = async (w, operation) => {
      const result = await workerRequest(
        w.socket,
        this.config.workerKey,
        method,
        path,
        body,
        operation,
      );
      if (policy.kind === "snapshot" && result.status < 400)
        w.requireFreshSnapshot?.delete(policy.tabId);
      return result;
    };
    if (!policy.mutation)
      return this.run(id, owner, dispatch, { readOnly: true });
    const url = new URL(path, "http://worker");
    const key =
      body?.idempotencyKey ??
      url.searchParams.get("idempotencyKey") ??
      undefined;
    const args = {
      method,
      path: url.pathname,
      query: Object.fromEntries(
        [...url.searchParams].filter(
          ([k]) => !["userId", "idempotencyKey"].includes(k),
        ),
      ),
      body: body
        ? Object.fromEntries(
            Object.entries(body).filter(
              ([k]) => !["userId", "idempotencyKey"].includes(k),
            ),
          )
        : undefined,
    };
    const budget =
      policy.kind === "type" && (!body?.mode || body.mode === "paced")
        ? typingBudget(body).budgetMs
        : this.config.handlerTimeoutMs || 30000;
    return this.submitOperation(id, owner, policy, args, key, dispatch, budget);
  }
  async maintain() {
    this.operations.prune();
    for (const [id, o] of this.observations)
      if (Date.now() - o.created > 300000) this.observations.delete(id);
    for (const s of this.store.sessions())
      if (
        this.workers.has(s.id) &&
        !this.locks.has(s.id) &&
        !this.operations.count(s.id)
      ) {
        await this.serial(s.id, async () => {
          await this.checkpoint(s.id);
          const fresh = this.store.session(s.id);
          const w = this.workers.get(s.id);
          if (
            w &&
            !w.busy &&
            Date.now() - fresh.lastActivity >= this.config.idleMs
          ) {
            await w.viewer?.close({ checkpoint: false });
            await this.suspendUnlocked(s.id, fresh.owner);
          }
        }).catch(async (e) => {
          console.error("Session checkpoint:", e.code || e.message);
          await this.serial(s.id, () =>
            this.suspendUnlocked(s.id, this.store.session(s.id).owner, {
              force: true,
            }),
          );
        });
      }
  }
  async close() {
    clearInterval(this.timer);
    this.operations.closing = true;
    await Promise.allSettled(
      [...this.workers.keys()].map((id) =>
        this.cancelSessionOperations(id, "service_shutdown"),
      ),
    );
    await Promise.allSettled(
      [...this.workers.keys()].map(async (id) => {
        await this.workers.get(id)?.viewer?.close({ checkpoint: false });
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
