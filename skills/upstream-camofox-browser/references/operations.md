# Operations, paced typing and viewer Stop

The supervised platform records browser mutations before queueing them, including create/close, navigation, input, evaluation, cookie import, download consumption/deletion and inspected target clicks. One mutation runs per session. Nested worker activity belongs to that operation. Read-only inspection is available, but a tab read may wait behind active input; operation status and cancellation bypass that queue.

## Submit, inspect, cancel

Fast calls keep their ordinary fields and add `operation`. After two seconds, unfinished calls return `{pending:true, operation:{id,state,...}}` (REST HTTP 202). **Pending is not success**: do not use a missing `tabId` or assume text was submitted. Wait for a terminal state and read the retained result.

| Tool | Inputs and result | Use it when |
|---|---|---|
| `camofox_operation_list` | Required `sessionId`; optional `limit` 1–100 (default 25), `offset` ≥0. Returns `operations` and `nextOffset` (null at the end). | Recover accepted work after a lost response, or check outstanding work before suspension. |
| `camofox_operation_status` | Required `operationId`. Returns `operation` and, when retained, its original `result`. Progress contains text unit counts, mode, WPM and elapsed milliseconds without text. | Follow a pending typing/navigation action, or resolve uncertain transport results. |
| `camofox_operation_cancel` | Required `operationId`. Returns the same envelope. `cancelling` means requested, not confirmed stopped. | Stop an obsolete action without cancelling unrelated sessions or pausing all future automation. |

```js
camofox_type({tabId:"TAB_ID", selector:"textarea[name=message]", text:"A longer message"})
// If pending, use the returned operation.id:
camofox_operation_status({operationId:"OPERATION_ID"})
camofox_operation_cancel({operationId:"OPERATION_ID"})
camofox_operation_status({operationId:"OPERATION_ID"})
camofox_operation_list({sessionId:"SESSION_ID", limit:25, offset:0})
```

States are `queued`, `running`, `cancelling`, `completed`, `cancelled`, `failed`, and `outcome_unknown`. Only `completed` confirms normal completion. Cancellation may leave partial text, navigations, downloads or application effects. Inspect the page before choosing another action. `outcome_unknown` may involve worker quarantine and loss of unsaved state: inspect session status, resume if needed, refresh references, and establish what happened before any retry.

Metadata and safe receipts persist for seven days. Ordinary results stay in bounded memory for up to 15 minutes (2 MiB per result, 32 MiB total); eviction, expiry or restart sets `resultUnavailable:true`. Never rerun a mutation to recover its result. Restart cancels undispatched work and marks interrupted dispatched work `outcome_unknown`; nothing replays automatically. Current session ownership is required. After explicit handover the new owner can inspect retained metadata; the old owner loses access.

Outstanding work is bounded to 32 operations per session and 256 per supervisor. `operation_limit` rejects admission before dispatch. Release, suspension and rerouting return `session_busy` while operations remain outstanding. Finish/cancel and inspect them first. Status/list/progress polling does not renew activity; active operations prevent idle suspension.

## Retry identities

Maintained MCP/OpenClaw adapters create a timestamped `idempotencyKey` before mutation submission and do not automatically retry mutations. For deliberate retry safety, supply a key and retain it with the exact original arguments. Format: `v1.<Unix milliseconds>.<UUID>`; generate fresh values at submission time. Keys older than seven days or more than five minutes ahead are rejected. Reusing a key for different arguments returns `idempotency_conflict`.

```js
// Construct once in your client; keep both key and arguments for a network retry.
const idempotencyKey = `v1.${Date.now()}.${crypto.randomUUID()}`;
camofox_click({tabId:"TAB_ID", ref:"e3", idempotencyKey})
```

A retry returns the existing operation even when automation is paused; it does not dispatch again. Prefer status/list after a transport error. Errors include the operation ID when one was created and the adapter's retry key when available. A lost response before the operation ID arrives can be recovered with the **same key and arguments**, within retention. A fresh key creates new work. Argument comparisons use a private keyed digest; raw arguments and typed contents are not stored in the operation database. LocateAnything's same-observation/same-target retry also resolves to the original operation.

