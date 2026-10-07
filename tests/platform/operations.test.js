import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "../../lib/platform/store.js";
import { OperationRegistry } from "../../lib/platform/operations.js";
import { Supervisor } from "../../lib/platform/supervisor.js";
import { browserOperation } from "../../mcp/lib/operation-contracts.mjs";
import { cadence, typingBudget, textUnits } from "../../lib/paced-typing.js";
const key = (date = Date.now()) => `v1.${date}.${randomUUID()}`;
function setup(t, limits = {}) {
  const root = mkdtempSync(join(tmpdir(), "camofox-operations-test-"));
  const store = new Store(root),
    registry = new OperationRegistry(store, {
      stateDir: root,
      operations: limits,
    });
  const session = store.createSession(
    store.createProfile("Test").id,
    "Operations",
    "alice",
  );
  const admit = (overrides = {}) =>
    registry.admit({
      sessionId: session.id,
      owner: "alice",
      generation: "g",
      kind: "type",
      args: { text: "sensitive-passphrase" },
      ...overrides,
    });
  t.after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { root, store, registry, session, admit };
}
test("retry identities compare private digests; conflicting, expired and future requests never dispatch", (t) => {
  const h = setup(t),
    k = key(),
    a = h.admit({ key: k });
  assert.equal(h.admit({ key: k }).row.id, a.row.id);
  assert.throws(() => h.admit({ key: k, args: { text: "different" } }), {
    code: "idempotency_conflict",
  });
  assert.throws(() => h.admit({ key: key(Date.now() - 8 * 86400000) }), {
    code: "operation_expired",
  });
  assert.throws(() => h.admit({ key: key(Date.now() + 600000) }), {
    code: "invalid_request",
  });
  assert(
    !JSON.stringify(h.registry.get(a.row.id)).includes("sensitive-passphrase"),
  );
  h.store.db.pragma("wal_checkpoint(FULL)");
  assert(
    !readFileSync(join(h.root, "sessions.sqlite")).includes(
      Buffer.from("sensitive-passphrase"),
    ),
  );
});
test("admission limits, retained results, pagination, ownership handover and pause survive restart", (t) => {
  const h = setup(t, { perSession: 2, global: 2 }),
    a = h.admit(),
    b = h.admit();
  assert.throws(() => h.admit(), { code: "operation_limit" });
  h.registry.finish(
    a.row.id,
    "completed",
    { ok: true, result: "private page result" },
    undefined,
    201,
  );
  assert.equal(
    h.registry.status(a.row.id, "alice").result.result,
    "private page result",
  );
  assert.throws(() => h.registry.status(a.row.id, "bob"), {
    code: "session_owned",
  });
  h.store.update(h.session.id, { owner: "bob", automationPaused: true });
  assert.equal(h.registry.status(a.row.id, "bob").operation.owner, "alice");
  assert.throws(() => h.registry.status(a.row.id, "alice"), {
    code: "session_owned",
  });
  assert.equal(
    h.registry.list(h.session.id, "bob", { limit: 1 }).nextOffset,
    1,
  );
  h.registry.update(b.row.id, { state: "running", dispatch: "dispatched" });
  const c = h.admit({ owner: "bob" });
  const recovered = new OperationRegistry(h.store, { stateDir: h.root });
  assert.equal(recovered.get(b.row.id).state, "outcome_unknown");
  assert.equal(recovered.get(c.row.id).state, "cancelled");
  assert.equal(recovered.public(a.row.id).resultUnavailable, true);
  assert.equal(h.store.session(h.session.id).automationPaused, true);
});
test("result TTL and size bounds never erase safe receipts or rerun work", (t) => {
  const h = setup(t, { resultTtlMs: -1, resultEntryBytes: 20 }),
    a = h.admit({ key: key() });
  h.registry.finish(a.row.id, "completed", {
    ok: true,
    tabId: "tab",
    result: "secret".repeat(10),
  });
  assert.deepEqual(h.registry.public(a.row.id).receipt, {
    ok: true,
    tabId: "tab",
  });
  assert.equal(h.registry.public(a.row.id).resultUnavailable, true);
  assert.equal(h.registry.count(), 0);
});
test("explicit effects cover aliases, evaluation, cookie import, download consumption and deletions", () => {
  for (const [method, path] of [
    ["POST", "/tabs/open"],
    ["DELETE", "/tabs/group/key"],
    ["POST", "/tabs/t/evaluate"],
    ["POST", "/sessions/s/cookies"],
    ["GET", "/tabs/t/downloads?consume=true"],
    ["DELETE", "/tabs/t/downloads"],
  ])
    assert.equal(browserOperation(method, path).mutation, true);
  assert.equal(browserOperation("GET", "/tabs/t/downloads").mutation, false);
  assert.equal(browserOperation("POST", "/tabs/t/extract").mutation, false);
  assert.equal(browserOperation("POST", "/unknown"), null);
});
test("paced budgets use graphemes and normalized cadence; over-budget text fails preflight", () => {
  assert.equal(textUnits("a👩‍💻é").length, 3);
  assert.throws(() => typingBudget({ text: "bad\tcontrol" }), {
    code: "invalid_request",
  });
  assert.throws(() => typingBudget({ text: "bad\ud800" }), {
    code: "invalid_request",
  });
  assert(
    Number.isInteger(
      typingBudget({ text: "x".repeat(500), wpm: 123.4 }).budgetMs,
    ),
  );
  assert.equal(typingBudget({ text: "x".repeat(500) }).expectedMs, 40000);
  assert.throws(() => typingBudget({ text: "x".repeat(8000) }), {
    code: "invalid_request",
  });
  const intervals = cadence(textUnits("Hello, world!"), 150, () => 0.5);
  assert(
    Math.abs(intervals.reduce((a, b) => a + b) / intervals.length - 80) <
      0.0001,
  );
  assert(intervals[5] > intervals[0]);
});
async function queueHarness(t) {
  const root = mkdtempSync(join(tmpdir(), "camofox-op-queue-"));
  const s = new Supervisor(
    { stateDir: root, operations: { initialWaitMs: 10 } },
    {},
  );
  const id = s.store.createSession(
    s.store.createProfile("Queue").id,
    "Queue",
    "a",
  ).id;
  s.store.update(id, { state: "active" });
  const w = { generation: "g", busy: 0, humanControl: false };
  s.workers.set(id, w);
  s.checkpoint = async () => {};
  t.after(() => {
    clearInterval(s.timer);
    s.store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { s, id, w };
}
const result = () => ({ status: 200, bytes: Buffer.from('{"ok":true}') });
test("FIFO queue, pending envelopes, queued cancellation and generation fencing", async (t) => {
  const { s, id, w } = await queueHarness(t);
  const order = [];
  let release;
  const first = s.submitOperation(
    id,
    "a",
    { kind: "type" },
    {},
    key(),
    async () => {
      order.push(1);
      await new Promise((r) => (release = r));
      return result();
    },
  );
  const a = JSON.parse((await first).bytes);
  assert.equal(a.pending, true);
  const second = await s.submitOperation(
    id,
    "a",
    { kind: "click" },
    {},
    key(),
    async () => {
      order.push(2);
      return result();
    },
  );
  const b = JSON.parse(second.bytes);
  assert.equal(b.operation.state, "queued");
  await assert.rejects(s.release(id, "a"), { code: "session_busy" });
  await s.cancelOperation(b.operation.id, "a");
  release();
  await s.operations.pending.get(a.operation.id);
  assert.deepEqual(order, [1]);
  assert.equal(s.operations.get(b.operation.id).state, "cancelled");
  let unlock;
  const lock = s.serial(id, () => new Promise((r) => (unlock = r)));
  await delay(1);
  const third = JSON.parse(
    (
      await s.submitOperation(
        id,
        "a",
        { kind: "click" },
        {},
        key(),
        async () => {
          assert.fail("obsolete generation dispatched");
        },
      )
    ).bytes,
  );
  w.generation = "changed";
  unlock();
  await lock;
  await s.operations.pending.get(third.operation.id);
  assert.equal(
    s.operations.get(third.operation.id).errorCode,
    "operation_generation",
  );
});
test("accepted retries resolve the same outcome even while automation is paused", async (t) => {
  const { s, id } = await queueHarness(t);
  const k = key();
  let dispatches = 0;
  const dispatch = async () => {
    dispatches++;
    return result();
  };
  const a = JSON.parse(
    (await s.submitOperation(id, "a", { kind: "click" }, {}, k, dispatch))
      .bytes,
  );
  s.store.update(id, { automationPaused: true });
  const b = JSON.parse(
    (await s.submitOperation(id, "a", { kind: "click" }, {}, k, dispatch))
      .bytes,
  );
  assert.equal(a.operation.id, b.operation.id);
  assert.equal(dispatches, 1);
  await assert.rejects(
    s.submitOperation(id, "a", { kind: "click" }, {}, key(), dispatch),
    { code: "automation_paused" },
  );
});
