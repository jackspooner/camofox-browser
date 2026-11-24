# Compare snapshot text

Start a comparison on an open tab. With `includeScreenshot:false`, MCP returns a text block containing JSON. Omit `delta` for an ordinary text-only snapshot. Omitting `includeScreenshot` keeps the default screenshot.

```text
camofox_snapshot({"tabId":"TAB_ID","includeScreenshot":false,"delta":true})
```

Save the returned `snapshot` string and `changes.revision` together. Substitute that revision and the same tab ID in the next call.

```text
camofox_snapshot({"tabId":"TAB_ID","includeScreenshot":false,"delta":true,"baseRevision":"text-00000000-0000-4000-8000-000000000001"})
```

On the basket fixture, this second call returns `changes.kind="unchanged"` until the page changes. After an item is inserted, `changes.kind="delta"` supplies one edit. Check that `changes.baseRevision` matches the saved revision before applying either result. Keep the returned revision alongside the updated text. In JavaScript the edit applies as follows.

```js
const { start, deleteCount, insert } = changes.edit;
const nextText = savedText.slice(0, start) + insert + savedText.slice(start + deleteCount);
```

A `reset` supplies replacement text in `snapshot`. The browser retains up to four revisions per tab for five minutes each. Navigation, frame changes, handoff, restoration, eviction or a change in coverage can require a reset. When a read crosses a document change, its revision is null. Start again for a current baseline.

Above 80,000 UTF-16 code units, the reset returns the ordinary first window and a null revision. Read additional windows with `offset:nextOffset` and `delta` omitted. Check current `refCoverage` and `truncated` even on an unchanged result. Only accessible text is compared. Structure, coverage and any requested screenshot describe the current read. A text revision can be used only as a comparison baseline. Use current element refs for input.
