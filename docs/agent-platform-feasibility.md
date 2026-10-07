# Camofox agent platform feasibility

> Historical investigation, recorded before implementation. For the implemented platform, current dependencies and acceptance status, see [the platform guide](agent-platform.md). Statements below about missing features or dependencies describe the investigation date.

Investigated on 6 October 2026. All four requested capabilities are feasible, but the complete system requires changes to Camofox's browser lifecycle, durable state and tool contracts. The repository at `/home/jack/systems/camofox` contains the latest upstream Camofox source, with its Git history. This document proposes implementation; the features have not been implemented or deployed.

## Upstream baseline

| Component | Verified version | Implication |
| --- | --- | --- |
| Camofox server | v1.18.1, commit `39c82094013480b373df6600d44c7f036f58356e` | Latest release and `master` head when checked; cloned with remote `upstream`. |
| Camoufox browser | 156.0.1-beta.36, published 6 October 2026 | Newest published build; GitHub marks it as a prerelease. |
| Official JavaScript launcher | `@camoufox/camoufox@0.5.8-beta.3` | Published package's `browser-pin.json` pairs it with beta.36. |
| Official stable launcher | `@camoufox/camoufox@0.5.7` | Published package pairs it with browser beta.34. |
| Camofox's existing dependency | `camoufox-js@0.11.5` | Different launcher package and API. Updating the browser alone is not a verified upgrade. |

For the requested newest stack, use beta.36 with its paired official launcher, then pin the validated Playwright version. The official launcher declares `playwright-core <1.63` and currently develops against 1.62.0. Its `Camoufox` call signature differs from the old launcher, and Camofox also imports the old launcher's internal `VirtualDisplay` module. Introduce a small launcher adapter and test browser startup, context creation, screenshots, persistent profiles and shutdown before deployment. Neither the new browser bundle nor this launcher migration has been installed in the new repository yet.

Upstream references: [Camofox v1.18.1](https://github.com/jo-inc/camofox-browser/releases/tag/v1.18.1), [Camoufox beta.36](https://github.com/daijro/camoufox/releases/tag/v156.0.1-beta.36), [official launcher source](https://github.com/daijro/camoufox/blob/1569b98c984b6d1aac08d63b1e0ef1456186faaa/typescript/src/sync_api.ts), [browser pairing](https://github.com/daijro/camoufox/blob/1569b98c984b6d1aac08d63b1e0ef1456186faaa/typescript/src/browser-pin.ts).

## Profiles

A profile is a named browser identity, such as `research-personal` or `shop-admin`. Agents should be able to list available profiles and explicitly select one when opening a session. Persist its browser data, fingerprint configuration, viewport policy, default country and engine version. Keep profile data outside the source checkout with restrictive permissions.

Upstream already saves cookies and localStorage by `userId`; IndexedDB capture is optional and disabled by default. It writes storage snapshots on lifecycle events and restores them when creating a new context. This is a useful migration source, but it is not a full Firefox profile or a discoverable profile catalogue. The standard MCP adapter selects `userId` once at startup and defaults to a random identity, so it cannot provide the requested per-call profile selection.

Use the official launcher's `persistent_context` and `user_data_dir` support for durable profile directories. A worker should own each active profile and its browser process. Store a profile lease so two processes cannot open the same directory. The initial version should allow one active session per profile; agents needing parallel isolated identities can create explicit profile copies. Later, multiple task sessions could share one profile worker, with shared login state and routing and per-tab ownership.

Persist the generated fingerprint rather than randomizing it on every resume. A full profile does not guarantee that a website will keep a login valid: token expiry, server-side revocation and reauthentication still apply. Offer an interactive login window or authenticated local viewer using the same profile lease. The current machine lacks Xvfb, so the upstream noVNC path needs its display dependencies if selected.

Relevant source: `plugins/persistence/index.js`, `lib/persistence.js`, `mcp/server.mjs`, and the official launcher's `typescript/src/sync_api.ts`. [Playwright documents persistent profile directories and their single-instance restriction](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context).

## Sessions and resumption

A session is a resumable task using a profile. Give it a stable ID and a durable store containing the profile ID, status, tab IDs and URLs, tab ordering, scroll positions, task notes, routing assignment, owner lease and checkpoint revision. SQLite is suitable for a single-machine service; browser profile files remain separate from database metadata.

Upstream sessions and tab groups are Maps in `server.js`. The default session expiry is ten minutes, and inactivity/memory recovery can also close browser resources. A persistence plugin does not turn these live objects into durable sessions.

Support two explicit resume modes:

- **Live resume:** retain the browser and tabs while the agent detaches. Resumption returns the existing pages. A retention policy and resource budget determine how long they stay alive.
- **Restored resume:** reopen the profile and recreate tabs from the latest committed checkpoint after suspension, service restart or reboot. Return that the session was restored, with any tabs requiring attention.

Arbitrary JavaScript memory, open WebSockets and unsaved in-page state cannot generally be restored after process death. URL, login state and scroll restoration are realistic guarantees. Persist sessionStorage separately where required and feasible; Playwright's normal storage-state export does not include it. Avoid automatically saving password fields or replaying previous side-effecting actions. [Playwright authentication guidance](https://playwright.dev/docs/auth#session-storage) describes the storage-state boundary.

Checkpoint periodically and at durable tab lifecycle changes, with atomic file writes and transactional metadata. Resume must be idempotent, reject conflicting ownership and reacquire the required route before loading a page. Agent reconnection should not create duplicate tabs or a new anonymous profile.

## Proton VPN routing

Proton's current Linux CLI supports country selection, including `protonvpn connect --country GB`. That establishes a machine connection; it does not by itself provide independent country routing for simultaneous browser sessions. [Official CLI documentation](https://protonvpn.com/support/use-linux-cli).

For concurrent country selection, use a route manager with a WireGuard tunnel in a dedicated Linux network namespace, and launch the relevant browser worker inside that namespace. Different profile workers can use different route namespaces. Keep the API and MediaTools on the host and use a controlled local IPC channel for worker control. A browser process belongs to one network namespace; contexts inside the same process cannot independently adopt different namespaces.

The route manager should map an ISO country code to provisioned Proton endpoints, verify tunnel readiness and observed egress, and return the selected country/server and route status. DNS must follow the tunnel, with IPv6 either routed correctly or blocked. Firewall rules should block direct internet fallback if the tunnel goes down. A route failure pauses the session until routing is healthy. Country changes should checkpoint and restart the browser worker; existing connections cannot be assumed to move safely.

Proton supports manual WireGuard configurations and explicitly documents multiple simultaneous tunnels. WireGuard documents per-namespace routing and browser isolation. This architecture is a proposed combination of those supported mechanisms, not a built-in Camofox or Proton session feature. [Proton configurations](https://protonvpn.com/support/wireguard-configurations), [WireGuard network namespaces](https://www.wireguard.com/netns/).

Provisioning requires an appropriate Proton account and server configurations for the supported countries, plus a narrowly scoped privileged helper for namespaces, interfaces and firewall rules. Available countries and simultaneous tunnels must respect the account's limits. An initial version can use a managed configuration pool; automatic provisioning of any arbitrary country needs a separately validated Proton integration.

On this machine, `ip`, `nft` and `/dev/net/tun` are present. `wg`, `wg-quick`, the Proton CLI, Docker and Podman were not found on PATH, and `/etc/wireguard` is absent. No VPN connection or host routing was changed during this investigation.

## LocateAnything and reviewed clicks

The current MediaTools owner is `/home/jack/services/systems/MediaToolsMcp/src/imageOperations/vision.ts`. Its `locate_anything` tool accepts an admitted local image path, a prompt and tasks including `gui_box` and `ground_multi`. It returns bounding boxes, points and source dimensions. It resizes large images to at most 1,600 pixels on the longest edge and 1.92 megapixels for inference, then maps boxes and points back to the original image coordinates. It returns structured data, not a numbered overlay image.

Implement two browser-native operations:

1. `camofox_locate_on_page`: capture the current viewport, call MediaTools, validate and number the boxes, and return the annotated screenshot as typed MCP image content plus structured target IDs, boxes, centers and an observation ID. The result never clicks. Even one match must be shown for review. Zero matches returns an empty target list and a useful reason.
2. `camofox_click_target`: accept the observation ID and the agent-selected target number, validate that the observation still applies, then issue one native pointer click at the box center. Return a fresh screenshot or snapshot so the agent can verify the outcome.

This gives the agent the requested sequence: inspect image, select one target, click its center. Multiple matches have stable numbered labels within that observation; a single match is target 1 and still requires the second call. Keep automatic locate-and-click out of this interaction path.

Store screenshot dimensions, capture geometry, scroll position, page/document identity and a short-lived observation revision. Convert original-image pixel centers into Playwright viewport CSS coordinates using verified capture geometry; do not assume image pixels equal CSS pixels or blindly trust fingerprint-spoofed viewport values. Prefer viewport captures for clicking. Full-page targets must be scrolled into view and captured again before confirmation.

Before dispatch, reject observations invalidated by navigation, scrolling, resizing, session restoration or another tool action. Under the tab lock, recapture or compare the target region and check hit-testing where available. Revision and time checks alone cannot detect every autonomous animation or DOM change. Reject changed/occluded targets for another locate call rather than silently selecting a new box. The click consumes the observation, and retries need an idempotency record to prevent duplicate clicks.

### Verified gaps

- The missing-model prerequisite was resolved on 6 October 2026: official `nvidia/LocateAnything-3B` revision `c32291ca5e996f5a7a485845b4f57a233936bba0` is installed at `/home/jack/models/vision/localization/LocateAnything-3B`. All 37 downloaded files passed Hugging Face checksum verification. Its isolated Transformers 4.57.1 runtime was restored. Two native ComfyUI inferences successfully identified all three buttons in the browser screenshot. Both MediaTools calls still returned `vision_execution_timeout` while the native jobs subsequently completed, so the bridge polling timeout remains a separate integration issue.
- Camofox's `/tabs/:tabId/click` OpenAPI documentation advertises `coordinates`, but the implementation only accepts `ref` or `selector`. A live coordinate request returned HTTP 400, `ref or selector required`; the latest v1.18.1 source has the same gap. The native coordinate-click branch and MCP contract need implementing together.
- Historical MediaTools references to `/v1/locateanything/camofox-page` and an older automatic vision gate describe an earlier Windows deployment. The current adapter owns `locate_anything`; those legacy instructions are not the current integration contract.
- The older CamoFox2 skill describes persistent identities and Proton routing, but states its owning implementation has not been restored. It cannot currently be reused as a running service.

The disposable browser session was removed after screenshot capture. Native detection returned three boxes; the current MediaTools timeout prevents normal delivery to its caller. No successful end-to-end visual click is claimed.

## Proposed agent surface

These are design names, not registered tools or final schemas.

| Operation | Purpose and result |
| --- | --- |
| `camofox_list_profiles` | Return a paginated profile catalogue with availability, labels and login notes. |
| `camofox_create_profile` | Create a profile identity and persisted configuration; does not log in automatically. |
| `camofox_open_session` | Select profile and optional country; allocate route, acquire profile lease, return stable session ID. |
| `camofox_list_sessions` | Return resumable sessions, their profiles, status and checkpoint times. |
| `camofox_resume_session` | Reattach or restore; report resume mode, routing and tab readiness. |
| `camofox_suspend_session` | Commit checkpoint and close worker, returning checkpoint revision and restore limitations. |
| `camofox_list_routes` | Discover configured countries and route health. |
| `camofox_locate_on_page` | Return typed image preview and numbered candidates without clicking. |
| `camofox_click_target` | Consume a reviewed observation and selected target; return refreshed page evidence. |

Public IDs must resolve within the authenticated caller's allowed profiles and sessions. Keep secrets, native profile paths and internal routing details outside tool results. Mutations need explicit ownership, side effects, idempotency and refresh behavior. An expired lease must prevent an old agent from acting after another agent takes over.

Upstream's contract owners are `mcp/lib/tool-contracts.mjs` and route-adjacent JSDoc in `server.js`, with `lib/openapi.js` supplying shared schemas. `npm run generate-openapi` generates `openapi.json`; `tests/unit/openapi.test.js` checks freshness and coverage, and `npm run test:mcp` checks the MCP surface/package. New Workspace2 operations should adopt `@workspace2/api-contracts` for shared Problem Details and metadata, generate both projections from shared operation descriptors, and declare failure/refresh behavior. Preserve the existing surface while introducing explicit profile/session IDs, then migrate callers deliberately.

No API descriptors or generated contracts were changed in this investigation. No error codes, compatibility waivers or ratchet baselines were added. The existing coordinate-click documentation/runtime mismatch is recorded above for implementation and parity testing.

## Implementation order and acceptance

1. **Validate the newest engine pair.** Migrate the launcher behind an adapter and pin exact versions. Test launch, native persistent context, screenshots, shutdown and relaunch in an isolated runtime.
2. **Profiles and session store.** Add named profiles, stable fingerprint configuration, leases, checkpoints and resume tools. Verify two profiles cannot see each other's cookies and that a restart restores the expected authenticated local fixture and tabs. Verify concurrent ownership conflicts and crash recovery.
3. **Reviewed visual clicks.** Resolve the MediaTools polling timeout, add numbered overlays and observation-backed native clicks. Test zero/one/many matches, model failure, image scaling, wrong target IDs, stale pages, overlays and retry deduplication. Use the requesting agent's visual review as the decision step.
4. **Proton route manager.** Provision selected countries and a privileged networking helper. Test two simultaneous country routes, in-browser egress, DNS/IPv6 behavior and loss of the tunnel without direct fallback. Verify other host services keep their routes.
5. **Operational integration.** Add interactive login, worker resource limits, backup/restore, metrics, generated API/MCP validation and the agent skill. Exercise agent reconnect, service restart and reboot before replacing the existing installation.

Profiles and sessions are substantial but conventional engineering. Visual interaction has a working local model and an adapter polling timeout to resolve. Per-session Proton routing is the largest systems integration component. Durable resumption should promise restored browser state with disclosed limitations, while exact continuation depends on retaining the live browser process.
