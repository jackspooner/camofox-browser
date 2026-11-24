# Locate and review visual targets

Use `camofox_locate` when you can describe a visible control by its label,
shape or position. Prepare the page so the relevant content is visible, then
call with `tabId` and `prompt`. The result includes a numbered overlay as an
MCP image block, `observationId`, `boxes` and image dimensions. Inspect the
image and select the printed number, including on a single-match overlay.
Refine the description or change the view when there are no matches.

Call `camofox_click_target` with that `observationId` and `targetNumber`
to click the selected centre. It maps screenshot pixels to viewport CSS
coordinates. A repeat of the same observation and target does not send a
second click. If a click outcome is uncertain, inspect the page before any
further input. [Locate and click example](../examples/locate-and-click.md)

For drag and drop, use reviewed observation endpoints when you need to choose
between similar matches or inspect exactly where the gesture begins and ends.
An inline prompt endpoint is useful when the description uniquely identifies
one visible target and review is unnecessary. Both endpoints must stay
visible in the same tab. [Drag endpoint choices](../operations/drag_and_drop.md) · [Both drag workflows on a fixture](../examples/drag-a-card.md)

Refresh observations after navigation, scroll, viewport changes or session
restoration. Changed target pixels and expiry can also make an observation
stale. When you need to read or describe an image, use
`camofox_analyse_image` with a question about the content.
[Image analysis sources](image-analysis.md)
