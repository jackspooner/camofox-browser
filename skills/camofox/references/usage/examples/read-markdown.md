# Read a document or one region as Markdown

Call `camofox_read_markdown` with the owned tab's `tabId` to read its body. Use `selector` to select exactly one article, section, heading or table. For a child document, supply a `frameSelector` matching exactly one iframe in the main document.

In the disposable trail guide, this call reads only the story heading inside the guide frame. Substitute the tab ID from your session.

```js
camofox_read_markdown({tabId: "TAB_ID", frameSelector: "#child", selector: "#story h1", maxChars: 200})
```

The fixture returns `markdown: "# Trail notes"`, `truncated: false`, and an empty `omissions` array. The `frame` object identifies the child by `main: false`, `name: "guide"` and its loopback origin. Selecting `#story` also returns the paragraphs, list, linked map and pipe table. Relative HTTP(S) links resolve against the selected document.

`maxChars` defaults to 16,000 UTF-16 units and accepts 1–64,000. Inspect `truncated` and `omissions` before quoting a whole section. A prefix can end inside Markdown markup. Narrow the region if traversal, depth or source-text limits are reached. To inspect a nested table, select it directly. Long link destinations are omitted. Controls (including calculated form `<output>` values), editable or hidden subtrees, navigation, scripts and embedded content are excluded by design.

For `invalid_selector`, correct the CSS. For `invalid_target` or `ambiguous_target`, inspect the current frame and choose a unique region. Reinspect after `target_changed` or `read_timeout` and make a fresh read. The supervised HTTP equivalent is `POST /tabs/{tabId}/read-markdown`, with the owner’s `userId` in the body. [Frame reads for individual fields](../../frame-reads.md)
