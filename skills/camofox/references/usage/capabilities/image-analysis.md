# Analyse a browser image

`camofox_analyse_image` captures or retrieves one image, attaches it privately
to MediaTools `text_infer` and returns text or structured JSON. Use it to
read a chart, describe a visible image or inspect an error message. The
supervised gateway needs a configured MediaTools connection.

```json
{"tabId":"TAB_ID","prompt":"Read the visible error message and explain it."}
```

That call analyses the current viewport. To send exactly the pixels you
previously inspected, use a retained screenshot capture. [Worked screenshot example](../examples/analyse-a-screenshot.md)

## Sources

Choose the source according to the pixels you need. These are `source` fragments
to include alongside `tabId` and `prompt`.

| Source object | Uses |
| --- | --- |
| `{"type":"viewport"}` | The current viewport, also the default if you omit `source`. |
| `{"type":"element","ref":"e12"}` | A visible element identified by a current snapshot ref. |
| `{"type":"element","selector":"#chart","frameSelector":"iframe#report"}` | A visible element matched by unique CSS, optionally within one iframe, including cross-origin frames. |
| `{"type":"region","clip":{"x":20,"y":40,"width":600,"height":300}}` | A known rectangle in viewport CSS pixels. |
| `{"type":"capture","captureId":"ID_FROM_SCREENSHOT"}` | Pixels retained by `camofox_screenshot` on this session and tab. |
| `{"type":"original","selector":"img#product"}` | The selected image element's current underlying image. |

Element and region crops must fit entirely inside the viewport. Camofox maps
CSS to raster pixels and rejects a moving page. For element or original
sources, supply one current ref or one unique selector. Use `frameSelector`
only with CSS, since refs already identify their document.

Original retrieval uses the selected element's `currentSrc` or `src`,
including supported `blob:` and image `data:` sources. An optional `url`
must match that source exactly. HTTP requests run in the session worker's
network namespace and apply session cookies separately at each redirect.
Some protected originals require page-script headers or a browser TLS
fingerprint the retrieval path does not inherit. Use
`{"type":"original","selector":"canvas#chart","screenshotFallback":true}`
to allow an explicit, reported fallback to a screenshot of the element
when the original is unavailable.

Retained screenshots are immutable, scoped to the session/tab and expire
after five minutes. The cache holds up to 32 captures and 128 MiB, so an ID may
be evicted sooner. A gateway restart discards retained captures. Active
analysis pins its input. An expired or missing ID returns
`capture_not_found` without taking a new capture. Images must decode as PNG,
JPEG, WebP or GIF and fit within 25 MB and 64 megapixels.

## Inference selection and output

Omit `inference` to use the default advertised by the connected adapter.
Without an adapter selection, MediaTools quick local vision is the default.
In a stdio MCP host, configure `CAMOFOX_ANALYSIS_MODEL` to an installed,
image-capable RouterText model ID and optionally set
`CAMOFOX_ANALYSIS_PROVIDER`. Reconnect the adapter and inspect its tool
description. REST callers pass their selection in the request.

An explicit `inference` object replaces the connection default for that
call. Use `{"mode":"quick"}` to request quick local vision explicitly, or
pass a compatible `{"model":"MODEL","provider":"PROVIDER"}`. Select Hosted
Auto with a canonical model and `providerSelection: "auto"`. Its optional
`routing` object can set an estimated-cost ceiling, as in this example.

```json
{
  "tabId":"TAB_ID",
  "prompt":"Describe the chart.",
  "source":{"type":"element","selector":"#chart"},
  "inference":{"model":"gpt-5.4","providerSelection":"auto","routing":{"maxEstimatedCostUsd":0.05}},
  "maxOutputTokens":256,
  "output":{"type":"json_object"}
}
```

Hosted Auto compares providers for the selected model. Local failures do not
fall back to hosted inference. MediaTools and RouterText own model capability,
provider policy, cost estimates and output validation.

`output` supports `text`, `json_object` and `json_schema`. The last
requires `schema` and accepts `name` and `strict`. Optional
`maxOutputTokens` is passed to the inference owner. Give reasoning models
enough budget to produce their final output. Check the returned content
against the pixels even when JSON validation succeeds.

The result contains `image` provenance, including source kind, fallback,
dimensions, digest, byte size and capture/expiry times. It also returns the
MediaTools `inference` result, including the selected model or route,
generated text or JSON and available accounting. Ordinary results keep
browser credentials, source URLs, encoded images and private staging paths
out of the prompt and output.

## Pending work and recovery

Calls lasting over two seconds return `pending: true` with an operation ID.
Poll `camofox_operation_status` for capture, retrieval and inference
progress and the settled result. Reuse the original `idempotencyKey` only
with identical arguments when reconciling a lost reply.
[Pending work and retries](../../operations.md)

Cancellation before model dispatch prevents inference. If transport is lost
or cancellation leaves the outcome unknown after dispatch, retain the original
operation and upstream IDs to inspect it. An uncertain inference does not
quarantine the browser. Settled requests remove private staging. Unknown
requests retain the input and an operation-named `.analysis.json` receipt
under the configured screenshots directory for operator recovery. Inspect
the original work before cleanup or another request.

Discover the live `camofox_analyse_image` schema under the `camofox` alias.
The supervised REST operation is `POST /tabs/{tabId}/analyse-image`.
[Source and validation](../../development/README.md)
