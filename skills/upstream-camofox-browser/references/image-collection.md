# Visually verified image collection

Use this workflow for product galleries, book covers and reader previews when the deliverable needs the images belonging to a particular item. A screenshot establishes visible context; LocateAnything grounds a region or control; source inspection can recover an accessible image asset. None of these alone proves complete coverage.

## Prerequisites and outputs

Use a session/tab you own and current live MCP schemas. The parent skill covers ownership, human control and pending operations. Camofox's locate tool requires its configured MediaTools inference service and can take time; use a fresh snapshot/ref directly when it already identifies the intended control. Do not repeatedly invoke inference for an unchanged, already verified target.

Keep a small manifest with the item identity, page URL, gallery/reader state, capture order, source URL if available, saved artifact path, dimensions, and whether the artifact is a source download or screenshot crop. Record observed coverage and any inaccessible states. Keep authentication tokens and private session URLs out of shared manifests.

## Workflow

1. **Establish relevance visually.** Take a snapshot or screenshot and identify the product title, main image and gallery/reader region. Exclude recommendations, advertisements and other editions unless requested. A matching CDN domain, filename pattern or position in a page-wide image list is insufficient evidence. When the task is structured text extraction rather than visual collection, prefer snapshot/DOM text; this workflow does not require vision for every browser action.
2. **Ground the precise target when needed.** Ask LocateAnything for the visible product image, thumbnail control or the page itself. Inspect the numbered overlay. A box around the whole reader, its toolbar, or another product is not a valid page crop. Refine the prompt, reveal a clearer view or use inspected DOM geometry if available. An uncertain box remains uncertain even when it is the only result.
3. **Inspect the source of that target when available.** Use bounded, read-only `camofox_evaluate` queries scoped to a region/element established from the current page. Inspect `currentSrc`, `src`, `srcset`, `naturalWidth`/`naturalHeight`, and relevant picture/source or gallery metadata. These are candidate assets, not automatic proof of membership or original resolution. Prefer a verified larger source for the same view when needed. Do not guess selectors across sites or manufacture high-resolution URLs by stripping filename tokens. Multiple sizes of one cover count as one view.
4. **Traverse visible gallery or reader controls.** Click a current snapshot ref, or separately click an inspected locate target. Wait for pending operations to resolve, then inspect the resulting state and image before saving or advancing. Re-locate after layout/scroll/navigation changes. Record distinct views in order and deduplicate repeats. Lazy loading, carousels and previews may reveal additional content only after interaction. Empty thumbnail selectors mean that query found nothing; they do not prove that a gallery is absent. Do not use a fixed sleep or a successful click as proof that the page advanced.
5. **Save and verify.** For accessible source URLs, use the Download Manager 2 workflow (discover its `download-manager-2` skill and live tools), with an explicit destination. Inspect the saved image against the visible product/view and confirm its dimensions. A successful download alone does not establish relevance. For an unavailable source, follow the crop fallback below. If download authentication fails, use supported authenticated retrieval or the visible crop; do not export credentials into ad hoc scripts.
6. **Report evidenced coverage.** Record an observed end marker, disabled next control, counter, or verified traversal of the available controls. A repeated image alone may be a stalled click or loading failure; inspect before declaring the end. Distinguish “all observed gallery views” or “all available preview pages” from all images/pages in the product. State inaccessible or unverified states explicitly. Inspect the final board/document too, checking that its embedded images match the manifest.

## Source inspection limits

There is no dedicated visual-target-to-image-source or universal gallery-extraction tool in this workflow. The existing evaluate tool permits small page-context JavaScript queries; this remains scripting, even though it needs no separate Python/shell program. If avoiding JavaScript, use the visual/crop route and disclose its limits.

A viewport point can be inspected with DOM hit testing only after verifying its coordinate mapping and that the page has not changed. Overlays may receive the hit instead of the image; inspect the result, not an arbitrary nearby image. Parent-page JavaScript cannot read a cross-origin frame's DOM. Canvas rendering, CSS backgrounds, blob URLs and authenticated assets may not provide a separately downloadable image. Do not treat these cases as permission to collect unrelated page images or as evidence of a general iframe-tool failure.

## Screenshot crop fallback

Capture a clean, unannotated screenshot at the same viewport/state as the inspected region. The locate overlay is evidence for checking the box, not the deliverable: cropping it would retain boxes/numbers. Camofox's screenshot tool returns an MCP image; its current schema does not accept crop or output-file arguments. Save the returned image through the host's supported artifact handling, or report that persistence is unavailable. Do not print base64 or claim an unsaved path exists.

Use an available image-crop tool, discovering its current schema and image/path requirements (for example through the `media-tools-mcp` skill). Pass the clean image, verified pixel rectangle and explicit destination where supported. Inspect the resulting artifact for clipped edges, wrong content, controls and unintended margins. A crop tool or artifact-saving limitation is a separate capability gap; do not invent Camofox parameters to hide it.

Locate boxes use the returned screenshot's `width`/`height` pixel space. Crop only a matching original-resolution image. If it was resized, full-page captured, scrolled, zoomed or otherwise changed, establish the new mapping or locate again. Native `camofox_click` coordinates and DOM hit testing use viewport CSS pixels. For the same unaltered viewport screenshot only, map `xCss = xImage * viewportWidth / imageWidth` and likewise for y, using measured dimensions; never use the scaled chat preview. Prefer `camofox_click_target` for clicks because it owns conversion and stale-observation checks. Cropping must verify its own image/state alignment.

Cropping removes surrounding pixels; it cannot improve source detail. Enlarging a small crop does not make it a high-resolution original. Use the site's available zoom/larger view when appropriate, then take fresh evidence and recheck bounds. Do not reuse fixed reader coordinates across pages without checking that the content still fits.

## Valid call examples

Replace IDs/refs with actual results. Each action needs the observations described above; these calls are not an unattended sequence.

```text
camofox_snapshot({"tabId":"TAB_ID"})
camofox_locate({"tabId":"TAB_ID","prompt":"The main product cover beside the product title, excluding recommendations and thumbnail controls"})
camofox_locate({"tabId":"TAB_ID","prompt":"Only the visible white book page inside the preview reader, excluding toolbar, arrows and surrounding background"})
camofox_locate({"tabId":"TAB_ID","prompt":"The next-page arrow in the currently open book preview"})
camofox_click_target({"observationId":"OBSERVATION_ID","targetNumber":1})
camofox_screenshot({"tabId":"TAB_ID"})
```

Inspect each numbered result before choosing its actual target number; do not assume 1 is correct. Do not click a crop region just because it was located. Read [operation recovery](operations.md) for pending, cancelled or uncertain clicks and [tool recovery](tools.md) for stale observations and inference failures. A timeout can leave inference or input in flight; establish its outcome before submitting again.
