import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../lib/platform/store.js";
test("profiles and session checkpoints survive reopening; ownership and one active session are enforced", () => {
  const root = mkdtempSync(join(tmpdir(), "camofox-store-"));
  let store = new Store(root);
  try {
    const p = store.createProfile("Work");
    assert.throws(() => store.createProfile("Work"), {
      code: "profile_exists",
    });
    const first = store.createSession(p.id, "Research", "alice"),
      second = store.createSession(p.id, "Writing", "bob");
    store.claim(first.id, "alice");
    assert.throws(() => store.claim(first.id, "bob"), {
      code: "session_owned",
    });
    assert.throws(() => store.claim(second.id, "bob"), {
      code: "profile_busy",
    });
    store.update(first.id, {
      checkpoint: { tabs: [{ id: "stable-tab", url: "https://example.com" }] },
      state: "suspended",
      owner: null,
    });
    store.claim(first.id, "bob");
    assert.equal(store.session(first.id).owner, "bob");
    store.update(first.id, { state: "suspended" });
    store.close();
    store = new Store(root);
    assert.equal(store.session(first.id).checkpoint.tabs[0].id, "stable-tab");
    assert.equal(store.profiles()[0].name, "Work");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
