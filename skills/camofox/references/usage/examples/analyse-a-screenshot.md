# Ask about a retained screenshot

Start with a tab showing the image-analysis fixture's solid red sample.
First capture and inspect the current viewport.
[Image-analysis fixture](../../../../../tests/platform/image-analysis-live.mjs)

```text
camofox_screenshot({"tabId":"TAB_ID"})
```

The MCP response includes an image block and metadata. Pass the
`capture.captureId` from the metadata to analyse the exact same screenshot,
even if the viewport changes after you inspect it. Use `mode: "quick"` for
an explicit local inference choice.

```text
camofox_analyse_image({
  "tabId":"TAB_ID",
  "prompt":"What is the dominant colour? Return JSON with exactly one key colour and a simple English colour name.",
  "source":{"type":"capture","captureId":"CAPTURE_ID"},
  "inference":{"mode":"quick"},
  "output":{
    "type":"json_schema",
    "schema":{"type":"object","properties":{"colour":{"type":"string"}},"required":["colour"],"additionalProperties":false}
  },
  "maxOutputTokens":128
})
```

If pending, poll `camofox_operation_status` with `operation.id`. Check that
`image.sha256` matches the screenshot metadata. The fixture supplies a
deterministic mocked inference result for this source. This excerpt shows the
expected colour field:

```json
{"inference":{"json":{"colour":"red"}}}
```

Real model responses can vary. Compare the answer with the pixels you saw.
Run the isolated fixture to check retained screenshot provenance and
missing-capture handling with deterministic mock inference.

```bash
node tests/platform/image-analysis-live.mjs /path/to/installed/browser-cache
```

[Supported image sources, defaults and recovery](../capabilities/image-analysis.md)
