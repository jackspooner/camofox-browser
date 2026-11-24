# Check a rendering failure on an owned tab

Start a diagnostic window before reproducing the problem. The supervised gateway listens for new console warnings, console errors and uncaught page errors on this page. Each popup or other tab needs its own opt-in.

```text
camofox_tab_diagnostics({"tabId":"TAB_ID","action":"start"})
```

Save the returned `nextCursor`. A repeated start returns the same starting cursor during the five-minute window. An initial read has no historical events. In the [local fixture](../../../../../tests/platform/tab-diagnostics-live.mjs), click **Sample** to trigger a rendering warning and an uncaught exception.

```text
camofox_click({"tabId":"TAB_ID","selector":"#sample"})
```

Read the first two events. Substitute your tab ID and the cursor from the start response.

```text
camofox_tab_diagnostics({"tabId":"TAB_ID","action":"read","cursor":"00000000-0000-4000-8000-000000000001.0","limit":2})
```

The fixture returns a `console` warning with summary `Component failed to render`, then a `console` error with a null summary for a structured argument. Both share a `documentId`. Use each response's `nextCursor` to continue. Later in the same sequence the uncaught exception has kind `pageerror`, severity `error` and summary `TypeError`.

- Reads return up to 32 events in arrival order. Omitting the cursor starts at the oldest retained event. Each tab retains 64 events. `evicted` counts all evictions in the window. `missed` counts events lost since your cursor, or since the start when you omit it. `hasMore` means the next batch is already available.
- `tabId` identifies the page. `documentId` groups events by the top-level navigation observed during this window, including events reported from its frames. Top-level navigation rotates the ID. Worker console and individual frame attribution are outside this tool's coverage.
- A console summary contains at most 160 characters from one short string of recognized diagnostic words. A null summary preserves the event when its text is sensitive, unrecognized, structured, mixed with other arguments, or unavailable in time. Page errors expose their standard error class. No URLs, headers, cookies, stacks or argument objects are included.
- Reading does not renew the session's idle timer. A window ends on expiry, tab closure or crash, human takeover, viewer Stop, ownership release or worker replacement. When `active` is false, start again before reproducing the issue. For `stale_observation`, check the tab ID and read without the old cursor. Up to eight tabs per session can collect simultaneously.

Stop collection and discard this tab's buffered events when finished.

```text
camofox_tab_diagnostics({"tabId":"TAB_ID","action":"stop"})
```
