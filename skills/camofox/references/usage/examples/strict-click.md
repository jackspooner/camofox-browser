# Click the observed Save button

When several buttons share a name, identify the intended one from its surrounding content. Request a strict snapshot of your tab.

```js
camofox_snapshot({tabId: "TAB_ID", strictRefs: true})
```

For example, two Save buttons appear as `[e1]` and `[e2]`. To click the first observed button, copy its ref and the returned `strictObservationId` from the same response. A `text-…` revision is only for comparing snapshot text.

```js
camofox_click({tabId: "TAB_ID", ref: "e1", strictObservationId: "STRICT_ID_FROM_SNAPSHOT"})
```

If the buttons change order, the click follows the original node. Replacement, document navigation, a newer snapshot or human handoff can invalidate the target. A covered or disabled node fails its actionability check. Inspect the current page and take a fresh strict snapshot before deciding on further input. Plain ref clicks keep their existing role, name and ordinal behavior.

The observation expires after five minutes and allows one attempt. Use `strictRefs: true` on cached pagination requests to obtain the same active ID. Use only refs annotated in the accessibility text. The normal snapshot limits apply. A strict click accepts one ref and a single click. For a pending, disconnected or uncertain click, inspect the original operation and check the page before sending more input. [Operation recovery](../../operations.md)
