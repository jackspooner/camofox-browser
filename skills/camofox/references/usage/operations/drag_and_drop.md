# `drag_and_drop`

Send a native left-button drag between two visible points in one tab. For
example, move a known card onto a visible drop zone with unique CSS selectors.

```json
{"tabId":"TAB_ID","from":{"selector":"#draft"},"to":{"selector":"#done"}}
```

## Endpoint forms

Pass exactly one of these forms in each of `from` and `to`. They can be
mixed independently. A ref, selector or visual box supplies its centre.

| Endpoint object | Choose it when |
| --- | --- |
| `{"coordinates":{"x":120,"y":140}}` | You know a point in the current viewport, measured in CSS pixels. Use finite nonnegative values strictly inside the width and height. |
| `{"ref":"e4"}` | The latest snapshot identifies the visible element by ref. |
| `{"selector":"#done"}` | A CSS selector matches exactly one visible element. |
| `{"prompt":"the blue drop zone labelled DONE"}` | A description of 1–2,048 characters should return exactly one valid LocateAnything box. |
| `{"observationId":"OBSERVATION_ID","targetNumber":1}` | You have inspected a `camofox_locate` overlay on this tab and selected its positive integer target number. |

Bring both endpoints into view before submitting. Measure CSS coordinates
from the browser viewport. Chat and viewer previews may scale the pixels.

### Inline LocateAnything prompts

Supply a distinct prompt for each endpoint that needs visual grounding.
Two prompt endpoints use the same screenshot. Each must yield one valid box
before the gesture can start. A unique match proceeds directly to the drag,
so use this when separate visual review is unnecessary.

### Reviewed locate observations

Call `camofox_locate` for the source and destination while they are visible
together, inspect the images, and pass the corresponding `observationId`
and `targetNumber` for each. This lets you choose a specific box among multiple
matches. You can also use one observation with two selected numbers when its
overlay clearly identifies both endpoints. Visual endpoints are checked against
fresh viewport geometry and pixels before input.

For sample calls for both approaches, see [Drag the DRAFT card](../examples/drag-a-card.md).

Use mixed forms when one endpoint already has a reliable selector or ref.
For example, keep the source a selector and describe the destination visually:

```json
{"tabId":"TAB_ID","from":{"selector":"#draft"},"to":{"prompt":"the blue button labelled DONE"}}
```

## Results and recovery

A fast success includes the resolved points in viewport CSS pixels and
operation metadata. A result excerpt for the fixture selectors is:

```json
{"ok":true,"tabId":"TAB_ID","from":{"x":120,"y":140},"to":{"x":420,"y":140}}
```

If the initial response returns `pending: true`, use
`camofox_operation_status` with the returned `operation.id`. Read a
completed operation's retained `result` when available. Take a fresh
snapshot and inspect the page's drop outcome.

| Code or symptom | Next step |
| --- | --- |
| `ambiguous_target` | Make the selector or prompt more specific, or inspect a numbered locate result and choose one box. |
| `invalid_target` | Check visibility, the selector match or the selected box/number. For an empty prompt result, refine the description or reposition the page. |
| `invalid_coordinates` | Bring both points or element centres inside the same viewport and measure again. |
| `invalid_selector` or `stale_refs` | Correct the CSS or take a fresh snapshot and use its current ref. |
| `stale_observation` | Locate again on this tab and inspect the fresh overlay before proceeding. |
| `locate_failed` | Check MediaTools readiness and the failed operation before submitting another visual drag. |
| Interrupted or unknown outcome | Inspect operation status, session status and the current page before deciding whether further input is needed. |

Optional `idempotencyKey` uses the seven-day
`v1.<Unix milliseconds>.<UUID>` format. Reuse a key only for identical
arguments when reconciling the original submission. Cancellation can leave
partial effects. [Operation status and retry details](../../operations.md)

Discover the active `drag_and_drop` MCP schema under the `camofox` alias.
Hosts that display fully qualified names show `mcp__camofox__drag_and_drop`.
The supervised HTTP contract uses `POST /tabs/{tabId}/drag`. See the
[development guide](../../development/README.md) for source and checks.
