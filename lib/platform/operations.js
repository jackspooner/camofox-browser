import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { problem } from "./store.js";
import { terminalOperation } from "../../mcp/lib/operation-contracts.mjs";
import { loadPlatformConfig } from "../config.js";
const canonical = (value) => JSON.stringify(normalize(value));
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => [k, normalize(value[k])]),
    );
  return value;
}
const active = "('queued','running','cancelling')";
export class OperationRegistry {
  constructor(store, config) {
    this.store = store;
    this.db = store.db;
    this.config = { ...loadPlatformConfig().operations, ...config.operations };
    this.results = new Map();
    this.resultBytes = 0;
    this.pending = new Map();
    this.closing = false;
    const keyFile = join(config.stateDir, "operation-digest.key");
    try {
      this.key = readFileSync(keyFile);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      this.key = randomBytes(32);
      writeFileSync(keyFile, this.key, { mode: 0o600, flag: "wx" });
    }
    if (this.key.length !== 32)
      throw new Error("Invalid private operation digest key");
    this.db
      .prepare(
        `UPDATE operations SET state=CASE WHEN dispatch='not_dispatched' THEN 'cancelled' ELSE 'outcome_unknown' END,
      errorCode=CASE WHEN dispatch='not_dispatched' THEN 'operation_cancelled' ELSE 'operation_outcome_unknown' END,
      cancellationReason='service_restart',updated=? WHERE state IN ${active}`,
      )
      .run(Date.now());
    this.prune();
  }
  get(id) {
    const row = this.db.prepare("SELECT * FROM operations WHERE id=?").get(id);
    if (!row)
      throw problem(
        "operation_not_found",
        "Operation not found or retention expired",
        404,
      );
    return row;
  }
  count(sessionId) {
    return this.db
      .prepare(
        `SELECT count(*) AS n FROM operations WHERE state IN ${active}${sessionId ? " AND sessionId=?" : ""}`,
      )
      .get(...(sessionId ? [sessionId] : [])).n;
  }
  admit({
    sessionId,
    owner,
    tabId = null,
    generation,
    kind,
    args,
    key,
    budgetMs = 30000,
    beforeInsert,
  }) {
    if (this.closing) throw problem("session_busy", "Service is stopping");
    const now = Date.now();
    if (key !== undefined) {
      const match =
        typeof key === "string" &&
        key.match(
          /^v1\.(\d{13})\.[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/,
        );
      if (!match)
        throw problem(
          "invalid_request",
          "Use a timestamped retry key: v1.<milliseconds>.<UUID>",
          400,
        );
      if (now - Number(match[1]) > this.config.retentionMs)
        throw problem(
          "operation_expired",
          "Retry identity expired; inspect the session before a new action",
          409,
        );
      if (Number(match[1]) - now > this.config.futureSkewMs)
        throw problem(
          "invalid_request",
          "Retry identity is too far in the future",
          400,
        );
    }
    const digest = createHmac("sha256", this.key)
      .update(canonical({ kind, tabId, args }))
      .digest("hex");
    return this.db.transaction(() => {
      if (key) {
        const existing = this.db
          .prepare(
            "SELECT * FROM operations WHERE sessionId=? AND owner=? AND retryKey=?",
          )
          .get(sessionId, owner, key);
        if (existing) {
          if (existing.digest !== digest)
            throw problem(
              "idempotency_conflict",
              "Retry identity was already used with different arguments",
            );
          return { row: existing, fresh: false };
        }
      }
      beforeInsert?.();
      if (
        this.count(sessionId) >= this.config.perSession ||
        this.count() >= this.config.global
      )
        throw problem(
          "operation_limit",
          "Outstanding operation limit reached",
          429,
        );
      const row = {
        id: randomUUID(),
        sessionId,
        owner,
        tabId,
        generation,
        kind,
        state: "queued",
        created: now,
        updated: now,
        deadline: now + budgetMs,
        retryKey: key || null,
        digest,
      };
      this.db
        .prepare(
          `INSERT INTO operations (id,sessionId,owner,tabId,generation,kind,state,created,updated,deadline,retryKey,digest)
        VALUES (@id,@sessionId,@owner,@tabId,@generation,@kind,@state,@created,@updated,@deadline,@retryKey,@digest)`,
        )
        .run(row);
      return { row: this.get(row.id), fresh: true };
    })();
  }
  update(id, changes) {
    const keys = Object.keys(changes);
    const allowed = [
      "state",
      "updated",
      "deadline",
      "dispatch",
      "progress",
      "receipt",
      "errorCode",
      "cancellationReason",
    ];
    if (keys.some((k) => !allowed.includes(k)))
      throw new Error("Invalid operation update");
    this.db
      .prepare(
        `UPDATE operations SET ${keys.map((k) => `${k}=@${k}`).join(",")} WHERE id=@id`,
      )
      .run({ id, ...changes });
  }
  progress(id, progress) {
    const safe = {};
    for (const k of ["completed", "total", "elapsedMs", "wpm"])
      if (Number.isFinite(progress?.[k]) && progress[k] >= 0)
        safe[k] = progress[k];
    if (["paced", "fill", "keyboard"].includes(progress?.mode))
      safe.mode = progress.mode;
    if (!terminalOperation(this.get(id).state))
      this.update(id, { progress: JSON.stringify(safe), updated: Date.now() });
  }
  finish(id, state, result, errorCode, httpStatus) {
    if (terminalOperation(this.get(id).state)) return;
    const receipt = {};
    if (typeof result?.ok === "boolean") receipt.ok = result.ok;
    if (typeof result?.tabId === "string") receipt.tabId = result.tabId;
    this.update(id, {
      state,
      updated: Date.now(),
      errorCode: errorCode || null,
      receipt: JSON.stringify(receipt),
    });
    if (result !== undefined) {
      const bytes = Buffer.byteLength(JSON.stringify(result));
      if (bytes <= this.config.resultEntryBytes) {
        this.results.set(id, {
          value: result,
          httpStatus,
          bytes,
          expires: Date.now() + this.config.resultTtlMs,
        });
        this.resultBytes += bytes;
      }
    }
    this.pruneResults();
  }
  pruneResults() {
    for (const [id, r] of this.results)
      if (
        r.expires <= Date.now() ||
        this.resultBytes > this.config.resultBytes
      ) {
        this.results.delete(id);
        this.resultBytes -= r.bytes;
      }
  }
  public(id) {
    const r = this.get(id);
    this.pruneResults();
    const operation = {
      id: r.id,
      sessionId: r.sessionId,
      owner: r.owner,
      tabId: r.tabId,
      generation: r.generation,
      kind: r.kind,
      state: r.state,
      created: r.created,
      updated: r.updated,
      deadline: r.deadline,
      dispatch: r.dispatch,
      cancellationReason: r.cancellationReason,
      progress: JSON.parse(r.progress),
      resultUnavailable: terminalOperation(r.state) && !this.results.has(id),
    };
    if (r.receipt) operation.receipt = JSON.parse(r.receipt);
    if (r.errorCode)
      operation.problem = {
        code: r.errorCode,
        detail:
          r.state === "outcome_unknown"
            ? "Outcome could not be confirmed; worker recovery may lose unsaved state. Inspect session and page before retrying."
            : r.state === "cancelled"
              ? "Operation stopped; partial effects may remain."
              : "Operation failed; inspect session and page before retrying.",
      };
    return operation;
  }
  status(id, owner) {
    const r = this.get(id);
    this.store.checkOwner(r.sessionId, owner);
    return this.response(id);
  }
  response(id) {
    const operation = this.public(id);
    const result = this.results.get(id)?.value;
    return { operation, ...(result !== undefined ? { result } : {}) };
  }
  list(sessionId, owner, { limit = 25, offset = 0 } = {}) {
    this.store.checkOwner(sessionId, owner);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      throw problem(
        "invalid_request",
        "Use limit 1–100 and a nonnegative offset",
        400,
      );
    const rows = this.db
      .prepare(
        "SELECT id FROM operations WHERE sessionId=? ORDER BY created DESC,id DESC LIMIT ? OFFSET ?",
      )
      .all(sessionId, limit + 1, offset);
    return {
      operations: rows.slice(0, limit).map((r) => this.public(r.id)),
      nextOffset: rows.length > limit ? offset + limit : null,
    };
  }
  requestCancel(id, reason = "agent_request") {
    const r = this.get(id);
    if (terminalOperation(r.state)) return r;
    if (r.state === "queued") {
      this.update(id, { cancellationReason: reason });
      this.finish(id, "cancelled", undefined, "operation_cancelled");
    } else
      this.update(id, {
        state: "cancelling",
        cancellationReason: reason,
        updated: Date.now(),
      });
    return this.get(id);
  }
  active(sessionId) {
    return this.db
      .prepare(
        `SELECT * FROM operations WHERE sessionId=? AND state IN ${active} ORDER BY created,id`,
      )
      .all(sessionId);
  }
  prune() {
    this.pruneResults();
    this.db
      .prepare(
        `DELETE FROM operations WHERE state NOT IN ${active} AND created<?`,
      )
      .run(Date.now() - this.config.retentionMs - this.config.futureSkewMs);
  }
}
