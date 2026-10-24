# Iframe refs and bounded reads

Use `camofox_snapshot` to discover reader controls and click their current refs. Each main/child document gets up to 500 refs; at most eight qualifying child frames are included, for 4,500 refs maximum. Existing frame skip policies remain, including blank/srcdoc, tracking and bot-detection frames. Layout movement alone does not invalidate a frame ref; navigation, replacement, removal or session restoration requires a fresh snapshot. Missing refs fail without rebuilding and dispatching the same ref number. Never replay an uncertain click.

Inspect `refCoverage`, independently of `truncated`/`hasMore`/`nextOffset`. Coverage has `status`, `limits`, `assigned`, bounded `documents`, `documentsOmitted`, and `reasons`. Each document reports main/child identity, a simple name of at most 256 characters (complex advertising/URL names are replaced with an omission marker), origin without path/query, assigned refs, eligible controls (null when unmeasured) and reasons. Reasons distinguish `ref_limit`, `frame_limit`, `skipped_frame`, `no_interactive_content`, `timeout`, `inaccessible`, `frame_changed` and `not_inspected` (specialized Google snapshot). Document summaries are capped at 64. Offset pages preserve coverage from the cached snapshot; they do not allocate more refs. Partial coverage does not mean every displayed control is unusable.

## Read text or image metadata

`camofox_read` is available in the 33-tool adapter/service. Discover the live schema before use. Inputs: required `tabId` and CSS `selector`; optional `sessionId`, `frameSelector`, `fields`, `limit`, `maxChars`. Without a frame selector, read the main document. A frame selector must identify exactly one iframe in the main document, including cross-origin frames. Nested frame paths and internal Playwright selector syntax are unsupported. Querying a same-origin or cross-origin iframe uses the same API; parent-page `contentDocument` access is unnecessary.

First establish the intended frame from the snapshot/page context. These examples use a reader iframe and a status element whose selectors were inspected:

```json
{"tabId":"<tabId>","frameSelector":"iframe#reader","selector":"[role='status']","fields":["text"],"limit":1,"maxChars":256}
```

Read only the visually grounded image or region, not every storefront image:

```json
{"tabId":"<tabId>","frameSelector":"iframe#reader","selector":"#page img","fields":["src","currentSrc","alt","naturalWidth","naturalHeight","complete"],"limit":4,"maxChars":8000}
```

Supported fields: `text`, `src`, `currentSrc`, `srcset`, `alt`, `title`, `width`, `height`, `naturalWidth`, `naturalHeight`, `complete`, `role`, `ariaLabel`. Defaults: `fields:["text"]`, `limit:20` (1–100), `maxChars:16000` (1–64000 across item string values). Each string is additionally limited to 2,048 characters. Numbers/booleans retain their type; missing/inapplicable fields are null. `text` is bounded text content, excluding input/textarea/select/option, editable text, scripts and styles; it is not a complete accessibility tree or a guarantee of visibility. Caller scripts and arbitrary attributes, including form values, are not accepted.

Results contain `frame` provenance, `items`, `returned`, `matched`, `omittedItems`, `truncated` and `omissions`. Items follow document order. Each omission identifies the item index/field and `item_limit`, `string_limit`, `character_budget` or `data_url`; a collection-level omission uses null index/field. Data URLs in image-source fields become null with `data_url`, never inline image bytes. Narrow selectors/fields if output is truncated; there is no offset pagination for mutable read results. A zero-match read returns an empty list, not an error.

Reads do not click, scroll, download images or execute caller code. They use the existing session owner and serialize with browser input. They are permitted during human control without changing user focus. The read deadline is five seconds. Results are observations, not persistent element handles, and each call reselects the current frame.

## Recovery and limits

- `invalid_request` / `invalid_selector`: correct fields, bounds or CSS syntax.
- `invalid_target`: inspect the parent page and select an attached iframe. `ambiguous_target`: make the frame selector unique.
- `target_changed`: the document navigated/detached/replaced during reading; its result was discarded. Inspect a fresh snapshot and read the intended frame again. No parent fallback occurs.
- `read_timeout`: narrow the read or wait for the reader to finish loading, then explicitly retry the read. A timeout never authorizes replaying a click.
- `stale_refs`: obtain a fresh snapshot and choose a current ref. The REST/MCP error and retained operation code preserve this distinction from internal failures.

Reader “Location 2 of 17” may represent sample positions, not printed book page numbers. Metadata alone does not prove gallery membership, page completeness or image fidelity. Follow [visually verified collection](image-collection.md), and route resulting downloads through Download Manager 2. For repeated authorized capture/advance operations, use the existing [capture sequence](capture-sequences.md) workflow; standalone reads do not change its checkpoints.
