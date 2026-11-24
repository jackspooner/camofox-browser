# Scroll a container

On the warehouse fixture, the bins panel is a scrollable element with the ID
`bins`. Use the current tab ID and the CSS selector of the scrolling element
itself. A selector can contain up to 2048 characters and must match exactly
one element in the main document.

```text
camofox_scroll({"tabId":"TAB_ID","selector":"#bins","direction":"down","amount":100})
```

Starting at the top left, the completed fixture call returns `ok: true`
and the following `movement`, in CSS pixels. Positive x points right and
positive y points down. For horizontal travel, use `left` or `right`.

```json
{"before":{"x":0,"y":0},"after":{"x":0,"y":100},"delta":{"x":0,"y":100},"moved":true}
```

At an edge, or when the selected element has no scrollable content on that
axis, the browser can return `moved: false`. The action stops there. A page
may also snap or clamp travel, so use the reported offsets to decide whether
to continue. Take a fresh snapshot to inspect content revealed by the move.

A malformed selector returns `invalid_selector`, no match returns
`invalid_target`, and multiple matches return `ambiguous_target`. Inspect
the current page before refining the selector. Each call resolves its selector
against the current document. A later call can therefore select a replacement
element with the same ID.

Omit `selector` for the usual wheel gesture at the current pointer. This
returns `ok` on completion. With either form, follow a pending operation by
its ID. [Operation status and recovery](../../operations.md)
