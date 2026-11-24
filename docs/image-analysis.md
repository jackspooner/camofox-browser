# Browser image analysis

Use [`camofox_analyse_image`](../skills/camofox/references/usage/capabilities/image-analysis.md) to ask about a browser viewport, element, region or original image. The supervised gateway captures or retrieves the pixels and calls MediaTools. For a complete call using the pixels from a previous screenshot, see the [retained screenshot example](../skills/camofox/references/usage/examples/analyse-a-screenshot.md).

## Sources

[Choose a source, scope a selector to a frame, or reuse a capture ID.](../skills/camofox/references/usage/capabilities/image-analysis.md#sources)

## Inference selection and output

[Select a model or use the connection default, request structured output and read provenance.](../skills/camofox/references/usage/capabilities/image-analysis.md#inference-selection-and-output)

## Pending work and recovery

[Poll the accepted operation and recover its original identity after a timeout.](../skills/camofox/references/usage/capabilities/image-analysis.md#pending-work-and-recovery)

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
