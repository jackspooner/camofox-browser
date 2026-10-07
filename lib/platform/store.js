import Database from "better-sqlite3";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export function problem(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}
export class Store {
  constructor(root) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.db = new Database(join(root, "sessions.sqlite"));
    chmodSync(join(root, "sessions.sqlite"), 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, profileId TEXT NOT NULL REFERENCES profiles(id), name TEXT NOT NULL,
      owner TEXT, state TEXT NOT NULL DEFAULT 'suspended', country TEXT,
      lastActivity INTEGER NOT NULL, checkpoint TEXT NOT NULL DEFAULT '{}');
      CREATE UNIQUE INDEX IF NOT EXISTS active_profile ON sessions(profileId) WHERE state IN ('starting','active','suspending');
      CREATE TABLE IF NOT EXISTS defaults (owner TEXT NOT NULL, sessionKey TEXT NOT NULL, sessionId TEXT NOT NULL REFERENCES sessions(id), PRIMARY KEY(owner,sessionKey));`);
    this.migrateOperations();
  }
  migrateOperations() {
    if (this.db.pragma("user_version", { simple: true }) > 1)
      throw new Error("Runtime database is newer than this service");
    this.db.transaction(() => {
      if (!this.db.prepare("PRAGMA table_info(sessions)").all().some(c => c.name === "automationPaused"))
        this.db.exec("ALTER TABLE sessions ADD COLUMN automationPaused INTEGER NOT NULL DEFAULT 0");
      this.db.exec(`CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY, sessionId TEXT NOT NULL REFERENCES sessions(id), owner TEXT NOT NULL,
        tabId TEXT, generation TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL,
        created INTEGER NOT NULL, updated INTEGER NOT NULL, deadline INTEGER NOT NULL,
        dispatch TEXT NOT NULL DEFAULT 'not_dispatched', retryKey TEXT, digest TEXT NOT NULL,
        progress TEXT NOT NULL DEFAULT '{}', receipt TEXT, errorCode TEXT, cancellationReason TEXT,
        UNIQUE(sessionId,owner,retryKey));
        CREATE INDEX IF NOT EXISTS operations_session_created ON operations(sessionId,created,id);
        PRAGMA user_version=1;`);
    })();
  }
  profiles() {
    return this.db.prepare("SELECT * FROM profiles ORDER BY created").all();
  }
  profile(id) {
    const p = this.db.prepare("SELECT * FROM profiles WHERE id=?").get(id);
    if (!p) throw problem("profile_not_found", "Profile not found", 404);
    return p;
  }
  createProfile(name) {
    if (typeof name !== "string" || !name.trim() || name.length > 128)
      throw problem(
        "invalid_request",
        "name must contain 1–128 characters",
        400,
      );
    const p = { id: randomUUID(), name: name.trim(), created: Date.now() };
    try {
      this.db
        .prepare("INSERT INTO profiles VALUES (@id,@name,@created)")
        .run(p);
    } catch (e) {
      if (e.code?.startsWith("SQLITE_CONSTRAINT"))
        throw problem("profile_exists", "Profile name already exists");
      throw e;
    }
    return p;
  }
  sessions() {
    return this.db
      .prepare(
        "SELECT id,profileId,name,owner,state,country,lastActivity,automationPaused FROM sessions ORDER BY lastActivity DESC",
      )
      .all().map(s=>({...s,automationPaused:!!s.automationPaused}));
  }
  session(id) {
    const s = this.db.prepare("SELECT * FROM sessions WHERE id=?").get(id);
    if (!s) throw problem("session_not_found", "Session not found", 404);
    return { ...s, automationPaused: !!s.automationPaused, checkpoint: JSON.parse(s.checkpoint) };
  }
  createSession(profileId, name, owner, country = null) {
    if (typeof profileId !== "string" || !profileId)
      throw problem("invalid_request", "profileId required", 400);
    if (
      name !== undefined &&
      (typeof name !== "string" || !name.trim() || name.length > 128)
    )
      throw problem(
        "invalid_request",
        "name must contain 1–128 characters",
        400,
      );
    this.profile(profileId);
    const s = {
      id: randomUUID(),
      profileId,
      name: name || "Session",
      owner,
      country,
      lastActivity: Date.now(),
    };
    this.db
      .prepare(
        "INSERT INTO sessions(id,profileId,name,owner,country,lastActivity) VALUES (@id,@profileId,@name,@owner,@country,@lastActivity)",
      )
      .run(s);
    return this.session(s.id);
  }
  claim(id, owner) {
    return this.db
      .transaction(() => {
        const s = this.session(id);
        if (s.owner && s.owner !== owner)
          throw problem(
            "session_owned",
            `Session is owned by ${s.owner}; release it before handover`,
          );
        const active = this.db
          .prepare(
            "SELECT id,owner,state FROM sessions WHERE profileId=? AND id<>? AND state IN ('starting','active','suspending')",
          )
          .get(s.profileId, id);
        if (active)
          throw problem(
            "profile_busy",
            `Profile is ${active.state} in session ${active.id}, owned by ${active.owner || "unclaimed"}`,
          );
        this.update(id, {
          owner,
          state: s.state === "active" ? "active" : "starting",
        });
        return this.session(id);
      })
      .immediate();
  }
  checkOwner(id, owner) {
    const s = this.session(id);
    if (s.owner !== owner)
      throw problem(
        "session_owned",
        `Session is ${s.state}, owned by ${s.owner || "unclaimed"}; resume it after the owner releases it`,
      );
    return s;
  }
  update(id, changes) {
    const allowed = ["owner", "state", "country", "lastActivity", "checkpoint", "automationPaused"];
    if (Object.keys(changes).some((k) => !allowed.includes(k)))
      throw new Error("Invalid session update");
    this.db
      .prepare(
        `UPDATE sessions SET ${Object.keys(changes)
          .map((k) => `${k}=@${k}`)
          .join(",")} WHERE id=@id`,
      )
      .run({
        ...changes,
        ...(changes.automationPaused !== undefined ? { automationPaused: Number(changes.automationPaused) } : {}),
        id,
        ...(changes.checkpoint
          ? { checkpoint: JSON.stringify(changes.checkpoint) }
          : {}),
      });
  }
  close() {
    this.db.close();
  }
}
