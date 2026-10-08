# Bounded capture and advance

Use `camofox_capture_sequence` for book samples, slides, galleries, document viewers and paginated records whose **Next** action the user has authorized. The agent selects and inspects targets, scopes the capture, and validates saved images; the service performs the repetitive work. This is a supervised-platform capability, not a singleton route or a new browser driver. Discover the deployed schema: an older running service or adapter may still expose 30 tools rather than 32.

## Start and observe

Own an active session/tab. Take a snapshot and screenshot, inspect the desired region and Next control, and identify a unique selector or viewport CSS coordinates. Prefer an element selector or a clip excluding animated controls, ads, counters and clocks. Selectors may use `frameSelector` to scope to one iframe, including a cross-origin iframe. Re-resolved selectors are explicit targets, not cached element refs; this operation does not accept snapshot refs or LocateAnything observation IDs and does not change their stale-frame/observation rules. Refresh those observations after the sequence.

```json
camofox_capture_sequence({
  "tabId": "<owned-tab-id>",
  "options": {
    "outputDir": "/absolute/service-host/folder/book-sample",
    "maxCaptures": 30,
    "capture": {"clip": {"x": 608, "y": 118, "width": 386, "height": 594}},
    "next": {"selector": "button[aria-label='Next page']", "frameSelector": "iframe#reader"},
    "frameSelector": "iframe#reader",
    "positionSelector": "#page-position",
    "readySelector": "#page[data-loaded='true']",
    "endSelector": "#sample-end",
    "changeTimeoutMs": 15000,
    "stableMs": 750,
    "budgetMs": 120000
  }
})
```

These selectors and coordinates are illustrative, not Amazon-specific defaults. Use only values inspected in the current viewer. Omit optional selectors that do not exist. For an element region use `capture:{"selector":"#slide","frameSelector":"iframe#reader"}`; omit `capture` for the viewport. For coordinate advance use `next:{"coordinates":{"x":1440,"y":420}}`. Coordinates cannot report a disabled control; configure an explicit end selector when possible. No automatic cropping, scrolling, target selection, inferred total page count, full-page capture or page-content interpretation is performed.

The output directory must be an absolute writable path **on the service host**, not the MCP client's machine. It is created if needed. Captures are `<sequenceId>-0001.png`, etc.; the portable manifest is `<sequenceId>.manifest.json`. Names are exclusive and existing assets are never overwritten. Region geometry records viewport CSS bounds, scroll, scale, raster bounds and screenshot dimensions. A selected element must fit entirely within the viewport. Screenshot resolution is the actual browser raster resolution, not the original document/image resolution. Each asset records SHA-256, position text when configured, URL and timestamp. Files may contain private page content; directory/file permissions are private when created, but existing directory permissions are unchanged.

The operation waits up to two seconds, then returns `pending:true` and an `operation.id`. **For a new sequence that operation ID is also the sequence ID.** Poll `camofox_operation_status`, or cancel using `camofox_operation_cancel`. Cancellation is only confirmed at a terminal operation state. A pending result is not a completed capture. The complete result is `{sequence,operation}`; `sequence` reports captured, skipped and failed counts, assets, events, phase and stop reason. A successful operation can still have stopped early; inspect `sequence.reason` and its count.

```json
camofox_operation_status({"operationId":"<operation-id>"})
camofox_capture_sequence_status({"sessionId":"<owned-session-id>","sequenceId":"<first-operation-id>"})
```

The second read uses the private native-profile checkpoint, works while suspended and after in-memory results expire, and does not renew session activity. The private checkpoint is authoritative; the output manifest is a portable projection and may lag after a crash or output-write failure. No sequence list tool is added: save the initial operation/sequence ID and output path. Operations remain discoverable through `camofox_operation_list` within its normal seven-day retention. Checkpoints/assets persist until deliberately removed; there is no automatic cleanup tool.

## Readiness and stop reasons

Before saving, the service waits for the document to leave `loading`, an optional readiness selector to be visible, and stable capture pixels/geometry/position for `stableMs`. After one native click it requires a **different stable image**. It never force-clicks, dispatches a DOM fallback or retries a click after a timeout. Exact repeated images, including a return to any previously captured image, stop the sequence without another asset/advance.

- `max_captures`: reached the requested bound; no extra Next click.
- `end_marker` / `next_disabled`: captured the current page and stopped at explicit end evidence.
- `next_missing`: Next was absent/hidden; inspect whether this is the actual end.
- `no_page_change`: no changed, stable capture was confirmed before the change deadline; one skipped attempt, no repeated click. A delayed load may still finish afterwards.
- `repeated_page`: a previously saved image recurred; it was skipped.
- `not_ready`: no acceptable stable initial/recovery image before the deadline.
- `resume_ambiguous` / `resume_mismatch`: recovery needs inspection, as described below.

Exact pixel equality is deliberately conservative. Animated content may never stabilize; changed chrome inside a broad capture may look like a new page. Stable placeholders can be captured if the viewer does not expose/use a reliable `readySelector`. If available, use a viewer-specific loaded state rather than assuming stable pixels alone prove loaded content. The first/last page and representative saved PNGs still need agent validation. Position text is bounded to 1024 characters and is recorded, not parsed into an inferred page count.

## Cancellation and recovery

Viewer Stop and human takeover use the existing operation cancellation/fencing mechanisms. Stop's automation pause persists; only the human Resume automation/Return to agent action clears it. Never bypass ownership, resume another agent's session, or request a restart to recover this batch without checking active work.

After cancellation, worker failure, transport loss or a deadline:

1. Inspect the original operation until terminal, then session status and the durable sequence status. If the operation outcome is unknown, recover the session normally; unsaved browser state may be lost. A missing checkpoint means the batch may not have started; it does not authorize replaying an uncertain operation.
2. Inspect the actual current page and saved PNGs. Refresh snapshots after restoration/human control. Keep the same logical tab and original options.
3. Explicitly resume with `camofox_capture_sequence({"tabId":"<same-tab>","sequenceId":"<sequence-id>"})`. Do not send `options` on resume. A resume creates a new tracked operation and retains the sequence ID and original **total** capture bound. Resume calls may use their own seven-day `idempotencyKey`; repeat identical requests with the same key only to recover their retained response, never to replay an uncertain mutation.

A durable write-ahead phase is saved before each advance. If recovery sees that advance may have occurred, it **never clicks again on the unchanged last page**: `resume_ambiguous` stops for inspection. If the current image has changed, explicit resume captures it and records that the advance was reconciled from current pixels, without claiming how many pages a human or delayed viewer may have moved. If the phase proves no advance was attempted, the current image must match the saved page before continuing; otherwise `resume_mismatch` stops. A complete-but-not-checkpointed PNG is recovered only when its recorded hash matches. Missing/changed previously committed captures yield `capture_output_collision`; restore the originals or choose a new sequence after inspection. Do not edit private checkpoints to force progress.

`operation_outcome_unknown` retains the normal browser quarantine behavior. `capture_not_found` means the private checkpoint is absent or belongs to another session. `capture_resume_required` bounds repeated recovery attempts. Filesystem errors leave the last durable phase available when possible; inspect destination permissions/free space and status before retrying. The service does not automatically retry failed writes or mutations.

## Limits and API ownership

At most 30 captures per sequence and ten minutes per operation; defaults are 30 captures, 120 seconds, 15 seconds per change and 750 ms of stability. Bounds are `maxCaptures:1–30`, `budgetMs:1000–600000`, `changeTimeoutMs:1000–60000`, `stableMs:250–5000`. Polling captures approximately every 150 ms plus screenshot/PNG-processing time; CPU, browser and disk use scale with region/viewport size and duration. No model inference, external generation, original-image downloads or paid API is used. Disk capacity is the operator's responsibility. Recovery events are capped at 256 per sequence.

REST equivalents: `POST /tabs/{tabId}/capture-sequence` with `userId` plus either `options` or `sequenceId`, and `GET /agent-sessions/{sessionId}/capture-sequences/{sequenceId}?userId=...`. Use the normal authenticated gateway. Shared owners are `mcp/lib/capture-contracts.mjs` and `mcp/lib/platform-contracts.mjs`; `npm run generate-openapi` projects them to route metadata and both specifications. The MCP/OpenClaw adapters share request shaping and automatic retry-identity creation. Worker-private endpoints are not public APIs.
