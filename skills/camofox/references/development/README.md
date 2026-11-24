# Camofox developer guide

Use this guide to find the code that owns a behavior, choose checks for the
change, and update the user guidance that depends on it. For browser tasks,
start with the [usage index](../usage/README.md).

## Prepare a checkout

From the repository root, run `npm run setup:worktree`. The
[setup script](../../../../scripts/setup-worktree.mjs) requires Git, Python 3,
Node 22 or newer, npm, and native build tooling if dependency prebuilds are
unavailable. The tested development baseline is Linux, Node 24.21.0
([.nvmrc](../../../../.nvmrc)) and npm 11.x. The script reports differences from
that baseline and continues if its readiness checks pass.

Setup restores root and MCP dependencies locally from their committed
lockfiles, rejects shared `node_modules` symlinks, checks SQLite and sharp,
and regenerates API contracts to check for drift. If it reports stale
contracts, inspect the generated changes and rerun. Setup skips browser
downloads, needs no private service environment, and starts no services.

For browser acceptance, use a compatible installed Camoufox cache and a
disposable runtime. The [live acceptance guide](../../../../tests/platform/README.md)
describes the expected cache path for each fixture and any viewer, desktop,
Proton or MediaTools prerequisites.

## Find the code that owns a change

| Change | Start here | Check here |
| --- | --- | --- |
| Gateway startup, authentication or dispatch | [agent-server.js](../../../../agent-server.js), [platform routes](../../../../lib/platform/routes.js), [service config](../../../../lib/config.js) and [auth](../../../../lib/auth.js) | [Platform contracts](../../../../tests/platform/contracts.test.js) and [lifecycle audit](../../../../tests/platform/lifecycle-audit.test.js) |
| Profile ownership, tab restoration or worker reset | [Supervisor](../../../../lib/platform/supervisor.js), [SQLite store](../../../../lib/platform/store.js), [worker launcher](../../../../lib/platform/worker-launcher.js) and [worker routes](../../../../lib/platform/worker-routes.js) | [Store tests](../../../../tests/platform/store.test.js), [checkpoint tests](../../../../tests/platform/checkpoint.test.js) and [recovery acceptance](../../../../tests/platform/README.md) |
| Pending results, retry identity, cancellation or typing | [Operation registry](../../../../lib/platform/operations.js), [worker operations](../../../../lib/worker-operations.js), [operation contract](../../../../mcp/lib/operation-contracts.mjs) and [paced typing](../../../../lib/paced-typing.js) | [Operation tests](../../../../tests/platform/operations.test.js), [input safety](../../../../tests/platform/input-safety.test.js) and the [operation guide](../operations.md) |
| Viewer tickets, rendered controls or managed tabs | [Viewer gateway](../../../../lib/platform/viewer.js), [viewer UI](../../../../lib/platform/viewer-ui.js), [tab state](../../../../lib/platform/viewer-tabs.js) and [viewer backend](../../../../lib/platform/viewer-backend.js) | [Viewer tests](../../../../tests/platform/viewer.test.js), [tab tests](../../../../tests/platform/viewer-tabs.test.js) and [tabbed viewer acceptance](../../../../tests/platform/README.md#tabbed-viewer-acceptance) |
| Country routes, helper errors or tunnel recovery | [Proton launcher](../../../../lib/platform/proton-launcher.js), [namespace helper](../../../../scripts/platform/camofox-netns.py) and [Proton provider](../../../../scripts/proton-provider.py) | [VPN lifecycle](../../../../tests/platform/vpn-lifecycle.test.js), [helper tests](../../../../tests/platform/netns-helper.test.js) and [operator setup](../../../../docs/agent-platform.md#proton-and-viewer-setup) |
| Snapshot coverage, ref identity or bounded reads | [Accessibility snapshot](../../../../lib/accessibility-snapshot.js), [frame refs](../../../../lib/frame-refs.js), [bounded read](../../../../lib/bounded-read.js) and [read contract](../../../../mcp/lib/read-contracts.mjs) | [Iframe coverage tests](../../../../tests/platform/iframe-coverage.test.js) and the [frame read guide](../frame-reads.md) |
| Singleton HTTP routes or plugins | [server.js](../../../../server.js), [plugin loader](../../../../lib/plugins.js) and [plugin configuration](../../../../camofox.config.json) | [Upstream development](../../../../docs/upstream-development.md) and [contributor security conventions](../../../../CONTRIBUTING.md) |

`npm run start:agent` starts the gateway under a coordinator lock. It
launches native-profile workers that run browser code from `server.js` and
serve private worker routes. `npm start` runs the singleton server. Keep
session ownership, input locking and worker-generation checks in the existing
dispatch path. Keep service settings in [lib/config.js](../../../../lib/config.js)
and adapter settings in [mcp/lib/config.mjs](../../../../mcp/lib/config.mjs).
Pass each child process only the environment variables it needs, and keep
worker routes internal.

## Change a public contract

1. Edit the shared descriptor in [tool-contracts.mjs](../../../../mcp/lib/tool-contracts.mjs)
   for base tools or [platform-contracts.mjs](../../../../mcp/lib/platform-contracts.mjs)
   for platform tools. The platform descriptors feed MCP and gateway request
   validation. Keep application error codes and their status mappings in
   [problems.mjs](../../../../mcp/lib/problems.mjs). Keep adapter dependencies
   within the standalone `mcp/` package and its declared dependencies.
2. Update the owning handler and its OpenAPI declaration. For routes described
   by a platform descriptor, [the generator](../../../../scripts/generate-platform-contracts.mjs)
   fills the route-adjacent JSON metadata in
   [routes.js](../../../../lib/platform/routes.js). Provide the route block keyed
   by its `operationId` when adding a descriptor and handler. For manually
   documented routes, update the adjacent `@openapi` block in
   [server.js](../../../../server.js) or [viewer.js](../../../../lib/platform/viewer.js).
3. Run `npm run generate-openapi`. Review the changes to
   [openapi.json](../../../../openapi.json),
   [agent-openapi.json](../../../../agent-openapi.json),
   [package.json](../../../../package.json) and
   [openclaw.plugin.json](../../../../openclaw.plugin.json) that apply. The
   [agent-spec transform](../../../../lib/platform/openapi.js) derives the
   gateway's supported routes for `/openapi.json` and `/docs`.
4. Update the affected [usage pages](../usage/README.md), including examples,
   defaults, limits, response fields and recovery. For catalogue changes,
   check the entry points, recovery reference, and the expected tool list in
   [the MCP smoke test](../../../../scripts/test-mcp.mjs) against `TOOL_DEFS`.
   Update the [root README](../../../../README.md) when capabilities, setup
   or material limits change.
   Follow the [repository skill maintenance notes](../../../../AGENTS.md)
   when publishing changes to the shared package.

## Change a visual workflow

### Drag, locate or click

`drag_and_drop` calls `POST /tabs/{tabId}/drag` (`operationId: camofox_drag`).
Both required endpoints, `from` and `to`, accept one form each and may mix
forms. The forms are `{coordinates:{x,y}}`, `{ref}`, `{selector}`,
`{observationId,targetNumber}` and `{prompt}`. Coordinates are in viewport CSS
pixels. The HTTP body includes `userId` and can include `idempotencyKey`.

- [Platform descriptors](../../../../mcp/lib/platform-contracts.mjs) own the
  endpoint shapes. [Drag target preparation](../../../../lib/platform/drag-targets.js)
  resolves both inline prompts against one worker screenshot, requiring one
  match per prompt. It also resolves selected observation numbers against
  the correct tab and session. [MediaTools targeting](../../../../lib/platform/media.js)
  calls LocateAnything and builds numbered images for standalone locate.
- [Worker routes](../../../../lib/platform/worker-routes.js) dispatch input
  with the tab lock. [Drag execution](../../../../lib/platform/drag.js)
  shares the visual-point check with inspected clicks: compare current
  geometry and target pixels, then map the selection to viewport CSS pixels.
  Keep stale or ambiguous targets from reaching mouse-down and preserve
  cancellation cleanup. Standalone `camofox_locate` returns an image for review
  before a separate `camofox_click_target` call.
- Update the [drag operation](../usage/operations/drag_and_drop.md),
  [drag-a-card example](../usage/examples/drag-a-card.md) and
  [visual targeting guide](../usage/capabilities/visual-targeting.md) when the
  applicable fields or targeting steps change. The [contract test](../../../../tests/platform/contracts.test.js)
  checks every pair of endpoint forms. The [local drag fixture](../../../../tests/platform/README.md#drag-and-drop-local-fixture)
  checks actual HTML drops, rejection before mouse-down, cancellation and
  retry identity. Confirm the drop in the page because an input success
  response reports the gesture.

### Analyse or collect images

For image analysis, change input and inference selection in
[analysis-contracts.mjs](../../../../mcp/lib/analysis-contracts.mjs). The
[worker source reader](../../../../lib/platform/image-source.js) retrieves
browser pixels or an authorized original. The gateway's
[capture store](../../../../lib/platform/image-captures.js) retains exact
pixels, and [image analysis](../../../../lib/platform/image-analysis.js)
submits them to MediaTools and manages its staging file. Preserve the original
operation identity when submission is uncertain. Update the
[image analysis guide](../usage/capabilities/image-analysis.md) and
[screenshot example](../usage/examples/analyse-a-screenshot.md) with the
[analysis tests](../../../../tests/platform/image-analysis.test.js).

For capture sequences, the public shape lives in
[capture-contracts.mjs](../../../../mcp/lib/capture-contracts.mjs).
[Sequence execution](../../../../lib/platform/capture-sequence.js) owns the
capture and advance loop. [Capture checkpoints](../../../../lib/platform/capture-checkpoint.js)
own durable manifests and output publication. Preserve the evidence used to
decide whether an advance happened before a retry. Update the
[capture sequence guide](../capture-sequences.md) with the
[sequence tests](../../../../tests/platform/capture-sequence.test.js) and
[capture/advance fixture](../../../../tests/platform/README.md#captureadvance-local-fixture).

## Choose verification for the change

| Scope | Check from the repository root |
| --- | --- |
| Shared schemas, route coverage and OpenClaw catalogue | `node --test tests/platform/contracts.test.js` and `NODE_OPTIONS=--experimental-vm-modules npx jest --runInBand tests/unit/openapi.test.js tests/unit/mcp-contracts.test.js tests/unit/openclawManifest.test.js` |
| In-repository adapter and standalone package | `node scripts/test-mcp.mjs` for a stdio catalogue handshake. `npm run test:mcp` also prepares adapter dependencies and checks an independently installed MCP tarball. |
| Platform behavior | `npm run test:platform` exercises local fixtures and mocks, including temporary state and helper validation. Some viewer tests use local Xvfb/VNC executables when available. |
| Singleton behavior and plugins | `npm run test:unit`, `npm run test:e2e` and `npm run test:plugins`, or `npm test` for all three. See [browser resource settings](../../../../tests/platform/README.md#captureadvance-local-fixture) for browser-dependent tests. |
| Actual browser, desktop, routed sessions or inference | Run the matching [live acceptance fixture](../../../../tests/platform/README.md) with a disposable state directory and separate port. The drag fixture uses a mock LocateAnything service by default and has a separate real-local mode. |
| Documentation and skill examples | Follow links from their actual checkout and installed skill paths. Check example inputs against the shared descriptors or the applicable OpenAPI operation. Record which example outcomes were observed and under what conditions. |

## Apply and verify an installed change

Use the [installation and migration guide](../../../../docs/agent-platform.md#installation-and-migration)
and [rollout and rollback procedure](../../../../docs/agent-platform.md#operation-registry-input-and-rollout).
Check session and operation activity before any service restart, and back up
the matching private database, digest key, profiles and configuration. Native
profiles require the pinned browser version. For a helper change, follow the
[helper update procedure](../../../../docs/agent-platform.md#updating-the-installed-network-helper).
After authorized deployment, check health, the loaded tool catalogue and a
disposable session. Reconnect the MCP client when it needs the updated
catalogue.
