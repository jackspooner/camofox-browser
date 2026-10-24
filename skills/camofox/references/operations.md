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

Retry identities are session-scoped and survive explicit ownership handover. The new owner can recover the original operation with the same key and arguments; the initiating owner remains recorded in metadata. A retry returns the existing operation even when automation is paused; it does not dispatch again. Prefer status/list after a transport error. Errors include the operation ID when one was created and the adapter's retry key when available. A lost response before the operation ID arrives can be recovered with the **same key and arguments**, within retention. A fresh key creates new work. Argument comparisons use a private keyed digest; raw arguments and typed contents are not stored in the operation database. LocateAnything's same-observation/same-target retry also resolves to the original operation.

## Typing modes

The supervised `camofox_type` default is **paced replacement at 150 WPM**. Required: `tabId`, `text`, and one unambiguous editable `ref` or `selector`. WPM uses five grapheme clusters per word; approximately 35% cadence variation and modest punctuation pauses average around the requested rate. Browser responsiveness affects measured pace. No intentional typos are introduced.

```js
// A visible draft, replacing the old value:
camofox_type({tabId:"TAB_ID", selector:"#message", text:"Hello there.", mode:"paced", wpm:150})
// Append a continuation:
camofox_type({tabId:"TAB_ID", selector:"#message", text:" More detail.", append:true})
// Fill instantly when visible pacing is unnecessary:
camofox_type({tabId:"TAB_ID", ref:"e2", text:"search query", mode:"fill"})
// Legacy keyboard events, appending at the current selection/focus:
camofox_type({tabId:"TAB_ID", selector:"#editor", text:"extra", mode:"keyboard", delay:30})
```

Paced `wpm` accepts 30–300; `append` defaults false. `fill` replaces instantly; explicit `keyboard` keeps its prior append/selection and millisecond `delay` behavior. `wpm`/`append` apply only to paced mode. The retained upstream singleton still defaults to fill. `pressEnter:true` explicitly submits after successful typing; cancellation suppresses submission.

Paced input verifies editability/focus before clearing and before/after each grapheme. Frame/document changes, detached/replaced targets, focus loss and changed editability stop it. Textareas and contenteditable support LF multiline text; invalid Unicode, control characters other than LF, and multiline text in single-line inputs are rejected before clearing. Unsupported input types are rejected before modification. Playwright's browser text-insertion fallback handles characters without native key mappings, including Unicode; such characters need not generate the same key events as ASCII. Do not depend on them to trigger keyboard shortcuts. Final content is compared in memory to the exact requested value (or original plus appended text). Masks/transformations produce `typing_mismatch`, not success. `ambiguous_target`, `target_changed` and `focus_changed` require fresh inspection.

Budget: maximum of 30 seconds or twice estimated typing duration plus 10 seconds, capped at ten minutes. Requests needing more than ten minutes are rejected before modifying the field; split longer drafts deliberately. Cancellation waits for complete native input and cleanup. A stalled operation is quarantined after the one-second cooperative grace period and its worker is closed before input ownership is released.

## Viewer Stop and control

The watch toolbar displays kind, state, elapsed time and unit progress, never typed content. **Stop** persists a session-wide pause first, cancels current and queued operations, and rejects new mutations with `automation_paused`. **Resume automation** permits new work; cancelled actions never restart. Closing/reopening the viewer, session restoration, service restart or ownership handover does not clear this pause. Only explicit human Resume automation or Return to agent clears it.

Take control immediately reserves human ownership, cancels outstanding agent work and confirms cleanup before allowing VNC input. Accepted 15-second offers/requests use the same path; unanswered offers do not cancel work or transfer ownership. Returning control disables human input, checkpoints and invalidates refs/observations. Closing a controlling viewer performs cleanup but preserves a separate Stop-induced pause. Use `session_watch({sessionId,open:true})` to let the person resume a paused session. Agents cannot bypass Stop with a session resume or a new owner.

REST equivalents: `GET /agent-sessions/{sessionId}/operations?userId=OWNER`, `GET /operations/{operationId}?userId=OWNER`, `POST /operations/{operationId}/cancel` with `{userId:OWNER}`. Use bearer authentication; browser mutation bodies/query parameters accept `idempotencyKey`. Viewer controls use session-scoped capabilities and exact Origin checks, never the agent API key.
