# Drag the DRAFT card onto DONE

This example uses the local drag fixture. Its red, draggable **DRAFT** button
is beside a blue **DONE** drop zone. It records accepted drops in
`document.body.dataset.drops`. Open the fixture in a direct session, take a
snapshot to check that both endpoints are visible, and replace `TAB_ID` with
the tab ID. Each approach starts from that same layout.
[Drag fixture](../../../../../tests/platform/drag-live.mjs)

## Let the descriptions select both endpoints

These descriptions identify one button each. This is one drag call with no
separate selection step.

```text
drag_and_drop({
  "tabId":"TAB_ID",
  "from":{"prompt":"the red button labelled DRAFT"},
  "to":{"prompt":"the blue button labelled DONE"}
})
```

If a description matches several controls, narrow it or use reviewed
observations. The fixture expects the accepted-drop counter to go from 0 to 1.

## Inspect the source and destination before dragging

Call `camofox_locate` for each endpoint without changing the view between calls.

```text
camofox_locate({"tabId":"TAB_ID","prompt":"the red button labelled DRAFT"})
camofox_locate({"tabId":"TAB_ID","prompt":"the blue button labelled DONE"})
```

Inspect both numbered image overlays. If each shows the intended button as
target 1, use that number and each corresponding observation ID.

```text
drag_and_drop({
  "tabId":"TAB_ID",
  "from":{"observationId":"DRAFT_OBSERVATION_ID","targetNumber":1},
  "to":{"observationId":"DONE_OBSERVATION_ID","targetNumber":1}
})
```

Use the printed number if either observation has multiple matches. After
running both workflows in order, the fixture expects 2 accepted drops.

## Check that the page accepted the drop

If the drag is pending, poll `camofox_operation_status` using its operation
ID. On an ordinary board, take a fresh snapshot and check the card is in the
intended destination. The fixture uses a read-only page expression because
its counter is stored in the DOM:

```text
camofox_evaluate({"tabId":"TAB_ID","expression":"Number(document.body.dataset.drops)"})
```

The isolated test starts and cleans up the fixture itself.

```bash
node tests/platform/drag-live.mjs /path/to/installed/browser-cache
```

The default check uses deterministic LocateAnything boxes and asserts that
the real browser delivers accepted HTML drops. The optional `--real-local`
mode runs both visual flows against configured local MediaTools.
[Test prerequisites](../../../../../tests/platform/README.md) · [All five endpoint forms](../operations/drag_and_drop.md)
