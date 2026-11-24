# Capture a page or an element

Use `camofox_screenshot` on an owned tab. Replace `TAB_ID` with the ID from
tab creation or listing. The default returns the current viewport.

```json
{"tabId":"TAB_ID"}
```

To inspect a single control, supply its unique main-document CSS selector.
You can also pass a current snapshot `ref` in place of `selector`. Refs use
the snapshot's role, name and ordinal. Take a new snapshot after navigation,
restoration or human control and whenever similar controls have reordered.

```json
{"tabId":"TAB_ID","mode":"element","selector":"#card"}
```

On the local fixture, this call returns the green 123 × 67 pixel card below
the fold and leaves the scroll position in place. The PNG shows whatever
Firefox paints over the element's rectangle, including overlays. A target
inside an iframe must fit within its frame.

```json
{"tabId":"TAB_ID","mode":"fullPage"}
```

On the same page, this call captures the 3,200-pixel-tall document,
including the green card. Element and full-page modes use CSS pixels,
with an 8,192-pixel maximum on either side, 16 million pixels total and
a 25 MB encoded limit. For an oversized page, select a smaller element.
For `ambiguous_target`, narrow the selector. For `target_changed`, inspect
the current page before capturing again.

The supervised response has a PNG image block and a text block containing
`capture`, including its ID, dimensions, byte count, SHA-256 and expiry.
Use the ID on the same tab and session to analyse those exact bytes. The
store retains them for up to five minutes, subject to earlier eviction.
[Analyse a retained screenshot](analyse-a-screenshot.md)
