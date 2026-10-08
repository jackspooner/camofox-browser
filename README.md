<div align="center">
  <img src="fox.png" alt="Camofox" width="160" />
  <h1>Camofox agent browser</h1>
  <p><strong>Persistent browser work, live watching, and human–agent control handoffs.</strong></p>
  <p>A fork of <a href="https://github.com/jo-inc/camofox-browser">jo-inc/camofox-browser</a>, powered by Camoufox.</p>
</div>

## Upstream project

**[Read the upstream README](https://github.com/jo-inc/camofox-browser/blob/master/README.md)** for the original project, its architecture, deployment options and browser API.

Upstream Camofox wraps the Firefox-based Camoufox browser in an agent-oriented REST API, with MCP and OpenClaw adapters. It provides accessibility snapshots with element references, screenshots, navigation, typing, clicking, scrolling, search macros and JavaScript evaluation. Its broader REST surface includes file uploads, downloads, structured extraction and image/link discovery, alongside cookie import, proxy support and optional plugins such as YouTube transcripts and VNC login.

This fork builds on that browser foundation to support **long-lived agent workflows and a shared browser that a person can watch and control**. It extends upstream Camofox **1.18.1**. The supervised gateway exposes its supported routes through its own OpenAPI specification; upstream plugins and singleton-only endpoints are not automatically available through that gateway.

## What this fork adds

| Capability | What it does |
|---|---|
| **Named persistent profiles** | Reuse site logins in native Firefox profiles, preserving cookies, localStorage, IndexedDB and fingerprint configuration. One active session may use a profile at a time. |
| **Resumable sessions** | Save and restore tab URLs, order, logical IDs, active tab, scroll positions and recoverable sessionStorage. Explicit ownership supports release and handover between agents. |
| **Supervised browser workers** | Separate workers, SQLite checkpoints, cross-process profile locks and automatic suspension after 30 minutes idle. Runtime data stays outside Git. |
| **Proton country routing** | Choose a country per session using an authenticated Proton account. Linux network namespaces and WireGuard isolate routing and DNS, leave host routing unchanged and block direct-network fallback on tunnel failure. |
| **Live desktop watching** | Agents can open and close a dedicated GTK/WebKitGTK window showing their current session. It follows the working tab and scales proportionally without changing the agent's browser viewport or coordinates. |
| **Human control and login** | Take control for manual interaction, login or MFA, then return control to the agent. Automation pauses while the user controls the browser. A single-use authenticated login-link viewer is also available. |
| **Timed control handoffs** | Agents can offer control or request it back. The viewer shows Accept/Decline and a 15-second countdown, and the agent receives the outcome. |
| **Inspected visual targeting** | LocateAnything returns numbered bounding boxes and an actual MCP image. The agent inspects the image, then makes a separate call to click a selected target. |
| **Native coordinate input** | Click or double-click using validated viewport CSS coordinates, alongside element refs and selectors. |
| **Tracked browser operations** | Persistent action IDs, progress, separate cancellation, bounded queues and seven-day retry identities. Calls return pending after two seconds; interrupted actions are never replayed. Retry identities survive ownership handover. |
| **Paced typing** | Supervised input defaults to about 150 WPM, with grapheme-aware pacing, exact-content checks, append support, instant fill and legacy keyboard modes. |
| **Viewer Stop** | Stop current and queued work and persist an automation pause. Explicit Resume automation or Return to agent permits new actions. |
| **Shared agent contracts** | 30 tools exposed through MCP and OpenClaw, matching REST operations, generated OpenAPI and structured platform errors. Includes a maintained agent skill. |

The browser pairing is pinned to **`@camoufox/camoufox` 0.5.8-beta.3** and **Firefox 156.0.1-beta.36**. Native profile version checks prevent accidentally opening a profile with an incompatible browser.

## Start here

- **Agents:** read the [Camofox skill](skills/upstream-camofox-browser/SKILL.md) and [tool and recovery reference](skills/upstream-camofox-browser/references/tools.md).
- **Connect Codex, Hermes or another MCP host:** follow the [MCP setup and tool catalogue](mcp/README.md).
- **Install or operate the platform:** read the [platform guide](docs/agent-platform.md), including dependencies, Proton setup, migration and rollback.
- **HTTP clients:** use the gateway's `/docs` and `/openapi.json`, or the checked-in [agent OpenAPI specification](agent-openapi.json).

The maintained implementation is on this fork's **`main`** branch. Use this checkout or a package built from it; installing the published upstream npm package does not install these additions.

```bash
git clone --branch main https://github.com/jackspooner/camofox-browser.git camofox
cd camofox
npm ci
```

Use Node 24 for the maintained Linux deployment. Installation fetches the pinned browser. Complete the environment and dependency setup in the platform guide before starting the gateway:

```bash
node --env-file=/absolute/path/to/private/service.env scripts/start-agent.mjs
```

`npm run start:agent` launches the same gateway when its environment is already supplied. `npm start` runs the retained upstream singleton for compatibility and regression testing.

The full platform targets Linux. Desktop watching requires a graphical session, Python GI, GTK3, WebKitGTK, Xvfb, x11vnc, noVNC and x11-utils. Proton routing additionally requires the official Proton components, OS Secret Service, WireGuard/iproute2 and the scoped privileged helper. LocateAnything uses an existing MediaTools service and its installed model; those services and model weights are not bundled in this repository.

On the maintained host, the user service is `camofox.service`, the endpoint is `http://127.0.0.1:23058`, and runtime state lives in `~/services/runtime/camofox-agent`. The [systemd unit](deploy/camofox-agent.service) reflects that host's layout; adapt its source and Node paths for another installation. Keep service credentials and native profile data private and outside the checkout.

## Choose a workflow

| Task | Capabilities to use |
|---|---|
| Continue work with saved website logins | Find the profile/session, resume it, list its tabs and take a fresh snapshot. |
| Let a person watch and help | Open the watch window; offer control for their input and request it back through the timed UI prompt. |
| Work with a target identified by appearance | Locate it, inspect the numbered image, then explicitly select the target to click. |
| Browse from an account-supported country | Check Proton readiness and country availability, then create or reroute the session. |
| Stop now or hand work to another agent | Suspend to save and stop the worker; release to make ownership available for handover. |

The [skill's tool reference](skills/upstream-camofox-browser/references/tools.md) explains what each of the 30 MCP tools does, its inputs and results, when to use it, example calls and recovery steps.

## Long actions and typing

Browser mutations return their usual result plus operation metadata when they finish quickly. After two seconds, unfinished calls return `pending:true` and an operation ID. Use `camofox_operation_status`, `camofox_operation_list` and `camofox_operation_cancel`; pending never means completion. Cancellation may leave partial effects. Ordinary results expire from memory after 15 minutes or earlier eviction; persistent receipts never authorize replay.

Typing defaults to paced replacement at 150 WPM in the supervised platform. Explicit `mode:"fill"` is instant; `mode:"keyboard"` retains legacy append/delay behavior. The watch toolbar shows progress and **Stop / Resume automation**. Stop survives viewer closure, restoration, ownership handover and service restart.

Read the [operation and typing guide](skills/upstream-camofox-browser/references/operations.md) for limits, retry keys, examples, Unicode behavior and recovery.

## A typical agent workflow

1. List or create a named profile, then create a session with its explicit `profileId`.
2. Create a tab with the returned `sessionId` and navigate to the task's page.
3. Take a snapshot, interact using current refs or measured coordinates, and inspect the result.
4. Open the watch window when the user wants to follow along. Offer control when their input is needed.
5. Suspend the session to save work and close its worker, or release ownership for another agent to resume it.

For example, these are separate tool calls using IDs returned by earlier calls:

```js
camofox_profile_create({name: "Research"})
camofox_session_create({profileId: "PROFILE_ID", name: "Product research"})
camofox_create_tab({sessionId: "SESSION_ID", url: "https://example.com"})
camofox_snapshot({tabId: "TAB_ID"})
camofox_session_watch({sessionId: "SESSION_ID", open: true})
```

Use a stable, distinct `CAMOFOX_USER_ID` for each agent adapter. The original browser tools also support a default session when an explicit session is omitted. An existing tab ID resolves to its owning session.

### Watch and exchange control

On Linux, the viewer backend and display inspection run in the browser worker's network namespace, including Proton-routed sessions. The visible GTK window stays on the host desktop. Supervised virtual displays use namespace-local abstract X sockets; equal display numbers in different namespaces cannot select the host desktop or delete its filesystem socket during cleanup. Install the updated namespace helper and restart the gateway and workers at an idle point to load this fix; see the [viewer deployment and recovery guide](docs/agent-platform.md#routed-viewer-backend).

The watch window starts read-only. Repeated opens present the same window; closing it leaves browser work running. The user can select **Take control** and **Return to agent** directly.

Agents can initiate a handoff through the same UI:

```js
camofox_session_control({sessionId: "SESSION_ID", action: "give"})
camofox_session_control({sessionId: "SESSION_ID", action: "request"})
```

The viewer must be connected. Each request displays a **15-second Accept/Decline countdown**. The tool waits and reports `accepted`, `declined`, `timed_out`, `cancelled`, or `already_in_mode`. Declining or timing out leaves control unchanged. Acceptance can take longer to stop in-flight input safely and switch modes; the deadline applies to the user's answer.

Returning control checkpoints the session and invalidates old element refs and visual observations. Take a new snapshot before continuing. Watching and viewer polling do not reset the idle timer. Session suspension, release, routing restart or worker failure closes the viewer; reopening is explicit.

### Locate, inspect, then click

```js
camofox_locate({tabId: "TAB_ID", prompt: "the green Continue button"})
// Inspect the returned image and choose its numbered target.
camofox_click_target({observationId: "OBSERVATION_ID", targetNumber: 1})
```

Both single and multiple matches receive numbered overlays. LocateAnything never clicks automatically. Navigation, scrolling, viewport changes, restoration, expiry or changed target pixels require a fresh observation. Repeating the same observation/target does not dispatch the click twice.

For measured coordinates, use native input directly:

```js
camofox_click({tabId: "TAB_ID", coordinates: {x: 240, y: 180}, doubleClick: true})
```

Coordinates are viewport CSS pixels. Do not infer them from a resized chat preview.

### Route a session through Proton

The user signs in locally, including MFA, through:

```bash
python3 scripts/proton-provider.py setup
```

Agents can inspect account readiness and available countries, then select a route:

```js
camofox_vpn_status({})
camofox_vpn_countries({})
camofox_session_route({sessionId: "SESSION_ID", country: "NL"})
```

Country names or ISO codes are supported, subject to account availability and connection limits. Route changes checkpoint and restart the worker. Explicit `country: null` switches to direct traffic. Disconnect cancels pending VPN renewal and waits for authentication agents to stop before namespace reuse; stale cleanup cannot affect a replacement route. Failed cleanup retains the route reservation for operator repair. Each routed worker has its own loopback, so a host-only localhost page is not reachable inside its VPN namespace.

## Persistence and operational limits

A live session handover can retain running pages. Resuming after suspension or a service restart reopens saved tabs and restores recoverable state; arbitrary JavaScript memory and unsaved form contents cannot be guaranteed. Logical tab IDs survive restoration, but element refs and visual observations do not.

The source now prevents replacement blank tabs during restore/close: closing the final agent tab keeps one managed placeholder, and creating new work removes only that placeholder. Intentional blank tabs remain intact. Worker checkpoints use private files so larger saved sessions can resume without process environment limits. Overlapping checkpoint requests share a single capture and atomic file write; interrupted worker responses fail rather than holding the session queue indefinitely. Snapshots and screenshots bring their target tab forward while watching. Collection routes (`POST /tabs/open`, `DELETE /tabs/group/{listItemId}`) accept an explicit saved session, and failed LocateAnything setup cleans up temporary screenshots.

These audit corrections require a gateway restart to load into the maintained service; existing live workers must also be suspended and resumed. Do that at a safe idle point. Editing the checkout does not update already-running processes.

Profiles may still need reauthentication when a website expires or revokes a login. Proton requires an authenticated account with access to the requested countries. Live VPN acceptance must be repeated for a new installation before treating its routing as verified.

The [platform guide](docs/agent-platform.md) records the implementation's verification and migration procedures. Preserve original profiles when migrating and keep backups for rollback. Do not open migrated beta.36 profiles with the retained older browser.

## Development and verification

Keep this README current with implemented functionality, the upstream summary and links, and the additions made by this fork. For every added, changed or removed MCP tool capability, update the repository-owned [agent skill](skills/upstream-camofox-browser/SKILL.md) and its [tool reference](skills/upstream-camofox-browser/references/tools.md) in the same change. Cover purpose/results, how to use the tool, and concrete examples of when to use it. Distinguish branch-only work from deployed behavior.

The canonical tool definitions live in [`mcp/lib/tool-contracts.mjs`](mcp/lib/tool-contracts.mjs) and [`mcp/lib/platform-contracts.mjs`](mcp/lib/platform-contracts.mjs). Route metadata generates both the combined upstream specification and the supervised gateway specification.

```bash
npm run generate-openapi  # Regenerate API specs and the OpenClaw catalogue
npm run test:platform     # Storage, input, viewer/handoff and contract checks
npm test                  # Upstream unit, end-to-end and plugin suites
npm run test:mcp          # Adapter and independently packaged MCP checks
```

Use the installed browser cache and a compatible Node runtime for browser tests. [Live acceptance instructions](tests/platform/README.md) cover persistence, recovery, VPN, LocateAnything and desktop control. Run those tests against separate runtime state and a separate port.

## Credits and license

The upstream browser server is maintained by [Jo](https://github.com/jo-inc/camofox-browser); its initial MCP implementation was contributed by @epicsagas. [Camoufox](https://github.com/camoufox/camoufox) provides the Firefox-based browser engine. This fork adds the persistent agent platform and shared-control workflows described above.

Licensed under [MIT](LICENSE). See the [upstream README](https://github.com/jo-inc/camofox-browser/blob/master/README.md) for upstream-specific deployment, plugin and operational documentation.


The audit corrections were loaded on the maintained host on 7 October 2026 after isolated regression checks and an idle service restart. Runtime state and configuration were backed up first. Existing accumulated blank tabs are not automatically removed because they may be intentional.


Failure recovery also releases active profile reservations when resume preparation fails or a stopped worker's VPN cleanup reports an error. Check session status after an error; network cleanup failures remain visible and may require operator repair. REST platform routes validate arguments consistently for canonical, trailing-slash and mixed-case paths.

Worker startup also cleans up a newly spawned process if its recovery record cannot be saved. Recovery records are replaced atomically so failed writes do not leave partial JSON.

Signal-terminated Proton processes report failure. Startup recovery cleans old tunnels even when a worker PID has been reused, without signaling the unrelated process; failed tunnel cleanup retains its recovery record for a later startup retry.

Input deadlines now stop cooperative keyboard typing before releasing the tab lock. Unconfirmed input cleanup quarantines the worker and closes its browser; inspect partial effects before retrying. Iframe refs reject removed, replaced or navigated frames instead of targeting the main page. Download deletion is available as `DELETE /tabs/{tabId}/downloads`; legacy `consume=true` remains a mutation and is blocked during human control. The networking helper checks command failures and verifies cleanup postconditions. These changes require updated gateway/workers and installation of the updated root-owned helper; operation tracking, paced typing and viewer Stop are documented in the operation guide.

## Linked worktree development

Use a task branch based on committed `main`, then run **`npm run setup:worktree`** from that linked checkout. Verified environment: Linux, Node 24.21.0 (`.nvmrc`), npm 11.x, Git, Python 3 and native build tools if dependency prebuilds are unavailable. The command installs root and MCP dependencies from committed lockfiles into the worktree, skips browser downloads, verifies native modules, regenerates contracts and checks contract freshness. It is safe to rerun and starts no services. Shared `node_modules` symlinks are rejected. No private environment file is needed for setup.

Configure a supported installed browser cache separately with `XDG_CACHE_HOME` for browser tests; use a disposable `CAMOFOX_AGENT_STATE_DIR` and separate port for platform acceptance. Never use production profiles for tests. Useful checks: `npm run test:platform`, `npm run test:unit`, `node scripts/test-mcp.mjs`, `node scripts/test-mcp-package.mjs`, and `npm run generate-openapi`. Browser installation, viewer libraries and Proton authentication are documented in `docs/agent-platform.md`. Setup reports version differences and proceeds when readiness checks pass. Node >=22 is required; other platforms need explicit live-platform validation.

After dependency setup, agents index the exact checkout with the managed GitNexus service using `index_analyze` with `embeddings: false`, then verify graph and full-text-search freshness. Each worktree has its own index. The service installs local workflow skills; this separate indexing step is described in [AGENTS.md](AGENTS.md#repository-graph) and is not part of dependency setup.

## Development preparation and repository ownership

Run `npm run setup:worktree` in a fresh Git CLI linked worktree before development. Setup checks prerequisites and prepares only checkout-local dependencies/output; it does not advance pins, configure credentials, download models, start services or alter shared environments. Validation is separate: `npm test`.

Node 24/npm 11 expected. Setup disables browser downloads, restores both committed lockfiles, checks native modules and read-only contracts. Browser/VPN acceptance needs separate operator configuration.

Maintain reusable operating guidance under root `skills/<name>/`. After integrating into the stable canonical checkout, use the SharedAgentSkills owner commands: `skills register <canonical-repository>/skills --provenance "Repository-owned guidance"`, `skills reconcile`, and `skills doctor`. Preserve existing exclusions and disabled packages. Machine registries and discovery symlinks stay outside Git. After setup, prepare and verify the exact checkout with the managed GitNexus service and `embeddings:false`; read its local workflow skill before graph use. Native Windows checks were not run during this Linux repair.
