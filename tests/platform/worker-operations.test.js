import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  installWorkerOperations,
  currentOperation,
} from "../../lib/worker-operations.js";
import {
  runInputOperation,
  typeWithSignal,
} from "../../lib/input-lifecycle.js";
test("worker control fences exact generation, cancels before arrival, cleans native input and quarantines stalls", async (t) => {
  const app = express();
  app.use(express.json());
  let quarantined = 0,
    input = "",
    released = false;
  installWorkerOperations(app, {
    generation: "g",
    quarantine: async () => {
      quarantined++;
    },
  });
  app.post("/type", async (req, res) => {
    const op = currentOperation();
    try {
      await runInputOperation(
        async (signal) => {
          if (req.body.stall) await new Promise(() => {});
          await typeWithSignal(
            {
              type: async (c) => {
                input += c;
                released = false;
                await delay(20);
                released = true;
              },
            },
            "abcdefghijklmnop",
            25,
            signal,
          );
          signal.throwIfAborted();
          input += "ENTER";
        },
        {
          timeoutMs: 30000,
          signal: op.controller.signal,
          quarantine: async () => {
            quarantined++;
          },
        },
      );
      res.json({ ok: true });
    } catch (e) {
      if (!res.headersSent) res.status(409).json({ code: e.code });
    }
  });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body = {}, id) => {
    const r = await fetch(base + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(id
          ? {
              "x-camofox-operation": id,
              "x-camofox-generation": "g",
              "x-camofox-deadline": String(Date.now() + 30000),
            }
          : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, ...(await r.json()) };
  };
  const first = randomUUID();
  await post("/internal/operations/" + first + "/cancel", { generation: "g" });
  assert.equal((await post("/type", {}, first)).code, "operation_cancelled");
  assert.equal(input, "");
  const id = randomUUID(),
    running = post("/type", {}, id);
  await delay(40);
  assert.equal(
    (
      await post("/internal/operations/" + id + "/cancel", {
        generation: "wrong",
      })
    ).code,
    "operation_generation",
  );
  await post("/internal/operations/" + id + "/cancel", { generation: "g" });
  assert.equal((await running).code, "operation_cancelled");
  assert(released);
  assert(!input.includes("ENTER"));
  const stable = input;
  await delay(70);
  assert.equal(input, stable);
  const hung = randomUUID(),
    hang = post("/type", { stall: true }, hung);
  await delay(20);
  await post("/internal/operations/" + hung + "/cancel", { generation: "g" });
  assert.equal((await hang).code, "operation_outcome_unknown");
  assert(quarantined > 0);
});
