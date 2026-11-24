---
name: camofox
description: Use the Camofox MCP alias to browse and interact with pages, drag and drop by coordinates, refs, selectors or LocateAnything, review numbered visual targets, analyse screenshots, collect images, resume login profiles and sessions, route by Proton country, or let a user watch, take control, log in or complete MFA. Applies to this fork's supervised gateway.
---

# Camofox agent browser

Use the `camofox` MCP alias for this fork, often displayed with
`mcp__camofox__` prefixes. Workspace2 CamoFox2 and the Hermes native browser
have separate interfaces. Use the connected adapter's schemas. [Open your first tab](references/usage/getting-started.md)

| Task | Where to start |
| --- | --- |
| Drag a card, control or handle | [`drag_and_drop`](references/usage/operations/drag_and_drop.md#endpoint-forms) |
| Find and click a visual target | [Locate, inspect and click](references/usage/capabilities/visual-targeting.md) |
| Read a chart, screenshot or selected image | [Analyse a browser image](references/usage/capabilities/image-analysis.md) |
| Read named fields from cards or table rows | [Project and verify typed rows](references/usage/examples/read-product-rows.md) |
| Resume saved work, route a session, watch or hand over control | [Profiles, sessions and tab references](references/usage/concepts.md) · [Viewer and human handoff](references/tools.md#viewing-and-visual-targets) |
| Click, type, read an iframe, collect images or capture a sequence | [Task guide](references/usage/README.md) |

For a visual drag, put unique descriptions inline in `from` and `to` when
the targets are unambiguous. To review first, call `camofox_locate` for both
endpoints, inspect the numbered images, then pass the chosen observation
IDs and target numbers to `drag_and_drop`. Keep both endpoints in view on
the same tab. Either endpoint can instead use coordinates, a snapshot ref
or a unique CSS selector. [Worked drag example](references/usage/examples/drag-a-card.md)

Use current snapshot refs. Refresh them after navigation, session restoration
or human control. If a call returns `pending: true`, follow its operation ID.
After cancelled or uncertain input, inspect the operation, session and page
before sending more input. [Operation status and recovery](references/operations.md)

For exact arguments and recovery by error code, see the
[tool reference](references/tools.md). For source, tests and maintenance,
see the [development guide](references/development/README.md).
