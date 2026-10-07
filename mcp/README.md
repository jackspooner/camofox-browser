# Camofox agent platform MCP server

This checkout exposes **30 tools** through MCP and OpenClaw: 11 browser tools plus 19 operation, profile, session, viewer, VPN and visual-target tools. Both adapters consume the same canonical contracts and request/response shaping. The local platform includes persistent native Firefox profiles, resumable sessions, Proton country routing, a desktop watch window, human login/MFA and inspected LocateAnything clicks.

For agent instructions, use [upstream-camofox-browser](../skills/upstream-camofox-browser/SKILL.md) and its [complete tool and recovery reference](../skills/upstream-camofox-browser/references/tools.md). For installation prerequisites, migration and rollback, see [the platform guide](../docs/agent-platform.md).

The initial upstream MCP implementation was contributed by @epicsagas.

## Architecture and existing deployment

- **Supervised REST gateway:** `agent-server.js`, launched through `scripts/start-agent.mjs` (`npm run start:agent`). Owns profiles, sessions and isolated browser workers.
- **MCP adapter:** `mcp/server.mjs`, a thin stdio client over HTTP. Each host starts an adapter process; it does not need its own REST service.
- **Shared contracts:** `mcp/lib/tool-contracts.mjs` and `mcp/lib/platform-contracts.mjs`. Both MCP and OpenClaw use them; platform error codes are in `mcp/lib/problems.mjs`.
- **Standalone adapter package:** `mcp/` depends on `@modelcontextprotocol/sdk`, not the browser or core server dependencies. A package built from this checkout includes the custom contracts.

On the maintained Linux installation, the source is `~/systems/camofox`, the user service is `camofox.service`, the REST endpoint is `http://127.0.0.1:23058`, and runtime state is `~/services/runtime/camofox-agent`. Codex and Hermes use the `camofox` alias and distinct stable ownership identities. Reuse that deployment for browser work; do not start another supervisor on the same runtime directory.

`npm start` runs the retained upstream singleton on its configured port (normally 9377). It does not provide the full platform. Installing the published upstream package or cloning upstream alone also does not establish that the local additions are present. For this platform, use the adapter and gateway from this maintained checkout or a verified package built from it.

## Connect an MCP host

For an existing installation, retain its configured command and private environment file. A source-based adapter can be started from any working directory with absolute paths:

```bash
node --env-file=/absolute/path/to/private/service.env /absolute/path/to/camofox/mcp/server.mjs
```

Use the installed compatible Node runtime (Node 24 on the maintained deployment). The adapter's environment must select the existing REST endpoint and a stable agent identity. Credentials belong in the private environment file, not in prompts or a checked-in host configuration. Configure the host's tool timeout to accommodate inference (the maintained Codex/Hermes registrations use 660 seconds).

For a new host, configure its stdio command/arguments using those absolute paths, and set `CAMOFOX_USER_ID` to that agent's stable identity. MCP clients such as Codex, Hermes, Claude Code, Cursor and OpenCode connect to this same adapter. The host's alias determines its visible tool prefix; the maintained alias is `camofox`.

If preparing another machine, follow the platform guide for browser, desktop viewer, Proton helper and model dependencies before starting `npm run start:agent`. Give a staging service its own port and runtime directory. An MCP connection alone does not install those components.

## Verify the connection

List the host's live tools: this adapter advertises **30**, including `camofox_session_watch`, `camofox_locate` and `camofox_click_target`. Listing tools verifies the adapter catalogue, not browser/VPN/model readiness. Use `camofox_profile_list` or `camofox_session_list` to check gateway access, and `camofox_vpn_status` separately for Proton readiness.

If only 11 tools appear, check the adapter's source path and refresh its connection. Hermes uses `/reload-mcp`; Codex may require reconnecting or opening a new chat. Do not automatically restart active conversations or the browser service.

## Tools

The 11 browser tools accept optional `sessionId`. Set it for creation, listing and cookie import into named work. Existing `tabId` values resolve to their owning session; they cannot be reassigned by passing another session ID. The adapter supplies `userId` automatically.

| Tool | Purpose |
|---|---|
| `camofox_create_tab` | Open `url` in a selected/default session; return `tabId`. |
| `camofox_snapshot` | Accessibility text, refs and an MCP image; continue truncated text using `hasMore` and `nextOffset` as `offset`. |
| `camofox_click` | Native click using exactly one of `ref`, `selector`, or viewport CSS `coordinates: {x,y}`; optional `doubleClick`. |
| `camofox_type` | Fill a ref/selector with `text`; optional `pressEnter`. |
| `camofox_navigate` | Navigate to `url` or use a supported search `macro` with `query`. |
| `camofox_scroll` | Scroll `up`, `down`, `left` or `right` by optional pixel `amount` (default 500). |
| `camofox_screenshot` | Return a standalone MCP image. |
| `camofox_evaluate` | Execute an `expression` in page JavaScript and return its result. |
| `camofox_list_tabs` | List open tabs in the selected/default session. |
| `camofox_close_tab` | Close one tab. |
| `camofox_import_cookies` | Import a Netscape cookie file using `cookiesPath`; optional `domainSuffix` and `sessionId`. |
| `camofox_profile_list` | List saved login profiles. |
| `camofox_profile_create` | Create a profile with `name`. |
| `camofox_session_list` | List saved sessions and ownership. |
| `camofox_session_create` | Start work with explicit `profileId`; optional `name` and Proton `country`. |
| `camofox_session_status` | Read state, ownership, routing, human control and viewer status without extending idle life. |
| `camofox_session_resume` | Claim/resume saved work; report `live` or `restored`. |
| `camofox_session_release` | Release ownership for another agent to resume. |
| `camofox_session_suspend` | Checkpoint and close a worker while retaining profile and tabs. |
| `camofox_session_route` | Checkpoint/restart through a country; explicit `country: null` selects direct traffic. |
| `camofox_session_viewer` | Issue a short-lived, single-use human login link; reserve human control. |
| `camofox_session_control` | Offer control (`action: "give"`) or request its return (`"request"`); wait for a 15-second UI acceptance outcome. |
| `camofox_session_watch` | Open/present or close a desktop viewer using boolean `open`. |
| `camofox_vpn_status` | Read account readiness without credentials. |
| `camofox_vpn_countries` | List account-eligible countries and connection limit. |
| `camofox_locate` | Locate `prompt` in a tab screenshot; return numbered image, boxes and `observationId`. |
| `camofox_click_target` | Separately click the inspected `targetNumber` for an observation. |

The [tool reference](../skills/upstream-camofox-browser/references/tools.md) contains arguments, all current search macros, examples, cookie constraints and recovery guidance. Live schemas are authoritative; do not invent parameters that only exist in REST.

## Working with saved sessions

1. List or create a profile, then create a session with its `profileId`; for existing work, inspect ownership and resume its session.
2. Create a tab with `sessionId` and `url`, then snapshot it.
3. Use current refs for click/type, or measured viewport CSS coordinates for a native click. Inspect the resulting state.
4. Suspend to retain work and close its worker; release when handing ownership to another agent. Close individual tabs only when they should leave the saved tab set.

Only one active session may use a profile. Native profile cookies, localStorage and IndexedDB persist. Restored sessions recover logical tab IDs, URLs/order, active tab, scroll and recoverable sessionStorage. `resumption: live` retains running pages; `restored` reopens them. Old refs and visual observations become invalid after restoration. JavaScript heap and unsaved form contents are not guaranteed after suspension or a crash.

Sessions suspend after 30 minutes without agent actions or actual human input. Status polling and passive watching do not extend this; active operations prevent suspension. Preserve the configured stable `CAMOFOX_USER_ID` to resume ownership across adapter restarts.

## Watching and manual control

`camofox_session_watch({sessionId, open: true})` opens a local desktop window in read-only watch mode. Repeating it presents the same window without changing its current mode. `open: false` closes only the viewer; browser work continues. The response contains `state` (`closed`, `opening`, `connected`) and `mode` (`watch`, `control`), also available under session status's `viewer`.

The view follows the agent's target tab and scales proportionally to available space without changing browser viewport, zoom or coordinates. Differing aspect ratios can leave margins. Watching is enforced read-only by both client and VNC server; clipboard exchange is disabled in both modes.

**Take control** blocks new agent mutations, cancels outstanding operations, confirms cleanup and enables human input. **Return to agent**, or closing while controlling, stops human input, checkpoints and invalidates refs/observations before releasing the block. Wait for `humanControl: false` and take a fresh snapshot/locate before resuming. Release, suspension, routing restart, failure and shutdown close the viewer; reopen explicitly.

Agents can offer control or ask for it back with `camofox_session_control({sessionId, action: "give" | "request"})`. Open the watch window first and wait for `viewer.state: "connected"`. The viewer displays an Accept/Decline prompt and a 15-second countdown; the tool waits and returns `outcome: accepted | declined | timed_out | cancelled | already_in_mode` plus viewer state. Declining or timing out leaves control unchanged. Closing or manually changing modes cancels a pending request. Acceptance may take longer than 15 seconds to stop in-flight input safely and switch modes; the deadline applies to accepting, not completing the switch. A request does not itself pause agent work or take control from the user. Do not retry merely because the user declined or did not answer. After accepted return to the agent, refresh refs/observations.

`camofox_session_viewer` preserves the manual-login link workflow. Its ticket is single-use and expires after 60 seconds before connection. The link reserves human control. One viewer is allowed per session; conflicting desktop/link opens return `viewer_busy`. Desktop launching requires the host graphical session; the link viewer needs browser access to the local service. Credentials and MFA stay with the user.

## Visual targeting and VPN

`camofox_locate({tabId, prompt})` returns an actual MCP image with numbered overlays for one or multiple matches. Inspect it, then separately call `camofox_click_target({observationId, targetNumber})`. Zero matches require a better prompt or another view. Navigation, scroll, viewport changes, restoration, expiry or changed target pixels require another locate. Same-observation/target retries do not dispatch twice; ordinary mutations do not have this blanket guarantee.

For routing, check `camofox_vpn_status` and `camofox_vpn_countries`. Session creation accepts a country name or ISO code; omit it for direct traffic. Changing a session's route requires a country string or explicit `null`. Routed workers have separate network namespaces; host routing stays unchanged and a failed tunnel never falls back to direct traffic. Their loopback is not the host's loopback, so use a public page for VPN demos. Interactive Proton account setup is a local operator command documented in the platform guide, not an MCP tool.

## Adapter environment

| Variable | Default | Purpose |
|---|---|---|
| `CAMOFOX_BASE_URL` | `http://localhost:<port>` | REST origin; maintained deployment uses `http://127.0.0.1:23058`. |
| `CAMOFOX_PORT` / `PORT` | `9377` | Fallback port when `CAMOFOX_BASE_URL` is absent; `CAMOFOX_PORT` takes precedence. |
| `CAMOFOX_USER_ID` | `mcp-<random UUID>` | Ownership identity. Set a stable distinct value for each agent that must reclaim saved work. |
| `CAMOFOX_SESSION_KEY` | `default` | Selects the legacy/default-session grouping when explicit saved sessions are omitted. |
| `CAMOFOX_ACCESS_KEY` | Unset | Bearer credential for ordinary tool requests; must be accepted by the REST service. |
| `CAMOFOX_API_KEY` | Unset | Required by the adapter for cookie import, which sends this bearer credential instead. |
| `CAMOFOX_COOKIES_DIR` | `~/.camofox/cookies` | Cookie-file directory on the **adapter host**. |

Cookie files are parsed by the adapter and sent as cookie objects, never remote filesystem paths. `cookiesPath` must be relative within `CAMOFOX_COOKIES_DIR`; absolute paths, traversal and escaping symlinks are rejected. The parser limits input to 5 MiB; HTTP body limits also apply. `domainSuffix` is a literal suffix filter. Do not print cookie values or keys. The adapter requires `CAMOFOX_API_KEY` even if a development server permits unauthenticated loopback.

## Troubleshooting and surface boundaries

Platform application failures return a structured `problem`; legacy tab routes may use upstream error shapes. The [recovery table](../skills/upstream-camofox-browser/references/tools.md#recovery) covers every current platform error code. In particular:

- Ownership/profile conflicts require a legitimate handover, not a changed identity.
- `human_control` requires waiting for the human to return control and then refreshing refs.
- `stale_observation` requires fresh visual targeting or a fresh snapshot for invalidated refs.
- `click_outcome_unknown` and mutation timeouts require checking page state before retrying.
- `locate_failed` can involve an inference job still running; MediaTools retains ComfyUI job IDs in timeout diagnostics. Do not blindly resubmit.
- Browser worker failure calls for inspecting/recovering the affected session, not immediately restarting the shared service.
- A successful scroll response does not prove the intended region moved. Inspect the page/container; `camofox_evaluate` can perform targeted scrolling when appropriate.
- Authentication failures require checking private adapter/service configuration without exposing credentials.

The REST gateway additionally supports tab wait/select/press/upload/viewport, history navigation, links/images, extraction, downloads, resource fetch and stats. They are not extra MCP tools. Consult the deployed `/openapi.json` or `/docs`, or this checkout's `agent-openapi.json`, for precise supported routes and schemas. Preserve ownership/control checks and keep worker-private endpoints internal. The upstream singleton `openapi.json` also contains routes excluded from the supervised gateway; it is not the platform's complete availability contract.

## Contract ownership and verification

Descriptions/schemas and REST request builders live in `mcp/lib/tool-contracts.mjs` and `mcp/lib/platform-contracts.mjs`. Platform HTTP metadata is generated into route-adjacent comments in `lib/platform/routes.js`; upstream tab metadata lives in `server.js`, and viewer transport metadata in `lib/platform/viewer.js`. These sources generate the specs and OpenClaw catalogue.

For contract changes, run `npm run generate-openapi`, then the relevant freshness/parity tests. Documentation-only edits do not require changing schemas or generated artifacts.

```bash
# Platform OpenAPI freshness and REST/MCP parity; no browser service required.
node --test tests/platform/contracts.test.js

# HTTP request, authentication, cookie and image adapter contracts.
NODE_OPTIONS='--experimental-vm-modules' npx jest tests/unit/mcp-contracts.test.js --runInBand

# In-repository and independently packed adapter handshakes (installs MCP deps).
npm run test:mcp
```

The packed adapter check catches imports that reach outside `mcp/`. Match both documentation tool tables to `TOOL_DEFS` when changing the catalogue, and update the skill's linked reference. This repository uses its own contract/freshness tests; it is not a Workspace2 API-validator project.

## Pending operations and paced input

Mutations lasting more than two seconds return `pending:true` plus operation metadata. Use the new `camofox_operation_list`, `camofox_operation_status`, and `camofox_operation_cancel` tools. Adapters generate timestamped retry keys before submission and never automatically retry mutations. Retained results can expire; metadata remains and actions never replay for result recovery.

Supervised `camofox_type` defaults to paced replacement at 150 WPM; `mode:"fill"` stays instant, `mode:"keyboard"` retains legacy append/delay behavior. The viewer adds persistent Stop and explicit Resume automation. Read [the detailed operation guide](../skills/upstream-camofox-browser/references/operations.md) for schemas, examples and partial-effect recovery.
