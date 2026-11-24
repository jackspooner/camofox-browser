# Locate and click a visible button

Start on a page you can interact with that displays a green **Reveal** button.
In this example the page shows a message after the button is clicked. The
texts, IDs and target number depend on your page and actual result.

```text
camofox_locate({"tabId":"TAB_ID","prompt":"the green button labelled Reveal"})
```

Inspect the numbered overlay returned as an image. If the intended button is
labelled **1**, use that number with the returned observation ID.

```text
camofox_click_target({"observationId":"OBSERVATION_ID","targetNumber":1})
camofox_snapshot({"tabId":"TAB_ID"})
```

If the click is pending, check its operation before taking the final snapshot.
On this example page, the expected result is that the message is visible. If
the button has moved or the observation expired, locate again and inspect the
new overlay. [Visual targeting and recovery](../capabilities/visual-targeting.md)
