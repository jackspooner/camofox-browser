import { AsyncLocalStorage } from "node:async_hooks";
const scope = new AsyncLocalStorage();
export const currentOperation = () => scope.getStore();
export function installWorkerOperations(app, { generation, quarantine }) {
  const operations = new Map(),
    cancelled = new Set();
  const fail = (res, code, message, status = 409) =>
    res.status(status).json({ code, error: message });
  app.get("/internal/operations/:id", (req, res) => {
    if (req.query.generation !== generation)
      return fail(res, "operation_generation", "Worker generation changed");
    const op = operations.get(req.params.id);
    if (!op)
      return fail(
        res,
        "operation_not_found",
        "Operation not started or expired",
        404,
      );
    res.json({
      progress: op.progress,
      state: op.done
        ? "finished"
        : op.controller.signal.aborted
          ? "cancelling"
          : "running",
    });
  });
  app.post("/internal/operations/:id/cancel", (req, res) => {
    if (req.body.generation !== generation)
      return fail(res, "operation_generation", "Worker generation changed");
    const op = operations.get(req.params.id);
    if (op && !op.done) op.cancel();
    else if (!op) {
      cancelled.add(req.params.id);
      while (cancelled.size > 256)
        cancelled.delete(cancelled.values().next().value);
    }
    res.json({ state: op?.done ? "finished" : "cancelling" });
  });
  app.use((req, res, next) => {
    const id = req.headers["x-camofox-operation"];
    if (!id) return next();
    if (req.headers["x-camofox-generation"] !== generation)
      return fail(res, "operation_generation", "Worker generation changed");
    const deadline = Number(req.headers["x-camofox-deadline"]);
    if (
      typeof id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(id) ||
      !Number.isFinite(deadline) ||
      deadline > Date.now() + 650000
    )
      return fail(
        res,
        "invalid_request",
        "Invalid private operation metadata",
        400,
      );
    if (operations.has(id))
      return fail(
        res,
        "idempotency_conflict",
        "Operation already reached this worker",
      );
    const op = {
      id,
      deadline,
      controller: new AbortController(),
      progress: {},
      done: false,
      started: Date.now(),
      cancel: () => {
        if (op.done || op.controller.signal.aborted) return;
        op.controller.abort(
          Object.assign(
            new Error("Operation cancelled; partial effects may remain"),
            { code: "operation_cancelled", statusCode: 409 },
          ),
        );
        op.grace = setTimeout(async () => {
          if (op.done) return;
          // Fence first; return an uncertain outcome even if native teardown stalls.
          const teardown = quarantine();
          if (!res.headersSent)
            fail(
              res,
              "operation_outcome_unknown",
              "Input could not stop; browser quarantined",
            );
          await teardown.catch(() => {});
        }, 1000);
      },
    };
    operations.set(id, op);
    while (operations.size > 512) {
      const old = [...operations].find(([, v]) => v.done);
      if (!old) break;
      operations.delete(old[0]);
    }
    op.timer = setTimeout(op.cancel, Math.max(0, deadline - Date.now()));
    res.once("finish", () => {
      op.done = true;
      clearTimeout(op.timer);
      clearTimeout(op.grace);
    });
    if (cancelled.delete(id) || deadline <= Date.now()) {
      op.cancel();
      return fail(
        res,
        "operation_cancelled",
        "Operation cancelled before execution",
      );
    }
    scope.run(op, next);
  });
}
