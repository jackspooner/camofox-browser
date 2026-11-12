# Browser image analysis

`camofox_analyse_image` captures or retrieves one selected image, attaches it to
MediaTools `text_infer`, and returns text or JSON. The agent needs no image folder,
download step or separate inference call. It is part of the supervised agent
platform; the upstream singleton server does not implement this operation.

```json
{"tabId":"TAB","prompt":"Read and explain this error message."}
```

## Sources

Omitting `source` captures the viewport. Other source objects are:

```json
{"type":"element","selector":"#chart","frameSelector":"iframe#report"}
{"type":"element","ref":"e12"}
{"type":"region","clip":{"x":20,"y":40,"width":600,"height":300}}
{"type":"capture","captureId":"ID_FROM_SCREENSHOT"}
{"type":"original","selector":"img#product"}
{"type":"original","selector":"canvas#chart","screenshotFallback":true}
```

Use current refs or a CSS selector for exactly one target. Frame selectors scope
CSS targets to one iframe, including cross-origin frames; refs already identify
their document. Regions use viewport CSS pixels. Element/region screenshots must
fit entirely inside the visible viewport. Camofox maps these to actual raster pixels
and rejects a moving page rather than reporting a mismatched crop.

Original retrieval reads the selected image's actual `currentSrc`/`src`, including
browser-owned blob and image data URLs. An optional `url` must match that source
exactly; it is not a general download URL. HTTP retrieval runs in the session's
worker/network namespace and applies session cookies separately on each redirect.
It does not inherit arbitrary page-script authorization headers or guarantee the
browser's TLS fingerprint; protected originals can remain unavailable. Screenshot
fallback is explicit, reported, and does not improve the source resolution.

`camofox_screenshot` retains its image block and adds capture metadata. Retained
pixels are immutable and scoped to the session/tab, expire after five minutes, and
may be evicted earlier under the 32-capture/128-MiB cache limits. Active analysis
pins its input. Expired/missing IDs return `capture_not_found` without recapturing.
Gateway restart loses these temporary captures. Images must decode as PNG, JPEG,
WebP or GIF, at most 25 MB and 64 megapixels. No Download Manager is involved.

## Inference selection and output

Default selection uses MediaTools quick local vision. Supply a compatible explicit
model/provider with `inference:{"model":"MODEL","provider":"PROVIDER"}`.
Hosted Auto requires a canonical model:

```json
{"tabId":"TAB","prompt":"Describe the chart.","source":{"type":"element","selector":"#chart"},"inference":{"model":"gpt-5.4","providerSelection":"auto","routing":{"maxEstimatedCostUsd":0.05}},"maxOutputTokens":256,"output":{"type":"json_object"}}
```

`output` also accepts `text` or `json_schema` with `schema` and optional `name` and
`strict`. Output budget is optional and passed through to the owner. Models that
think can consume this budget before emitting JSON; very small budgets can fail
validation. Valid JSON does not establish factual accuracy. Model capabilities, provider policy, native
versus validated JSON and quote coverage remain MediaTools/RouterText-owned.
Hosted use is explicit; local failure never causes hosted fallback. Hosted Auto
compares providers for the selected model, not different models. Quote ceilings
are estimates, not invoice caps. See RouterText's reviewed Vision Auto coverage.

Results contain `image` provenance (capture ID, dimensions, digest, byte size,
capture/expiry times, source kind and fallback flag) and `inference`, preserving
selection, text/JSON, structured-output evidence, routing and accounting. Source
URLs, browser credentials, encoded images and private staging paths are not sent
as prompt text or returned in ordinary analysis JSON.

## Pending work and recovery

Calls lasting over two seconds return `pending:true` with an operation ID. Use
the existing operation status/list/cancel tools. Retry the same arguments with
the same `idempotencyKey`; do not submit a replacement after a lost response.
Progress modes identify capture, retrieval and inference.

Cancellation before model dispatch prevents inference. After dispatch, cancellation
or lost transport may return `operation_outcome_unknown`; that is not confirmation
that the model stopped. Original operation and upstream error identities remain
the recovery evidence. An uncertain inference does not quarantine the browser as
if it had delivered uncertain input.

Settled requests remove private staging. Unknown requests retain the input and a
private operation-named `.analysis.json` continuity receipt under the configured
screenshots directory. Inspect original work before manual cleanup; these files
are not a replay queue and have no automatic retry or expiry cleanup.

## Verification

Run `node --test tests/platform/image-analysis.test.js`, the full platform suite,
MCP smoke/package checks and generated OpenAPI freshness checks.
`node tests/platform/image-analysis-live.mjs /path/to/browser-cache` uses disposable
browser state and mocked MediaTools. Add `--real-local` with the existing private
`CAMOFOX_MEDIA_TOKEN_FILE` for two synthetic local quick-inference checks. Real
checks create their temporary state under the current checkout by default; use
`--state-root /admitted/shared/directory` when needed. Avoid OS-private `/tmp`
namespaces when sharing attachments with a resident service. It never
selects a hosted provider. Source, deployment and live acceptance are separate.
