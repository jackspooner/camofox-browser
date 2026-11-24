# Connect an MCP host to Camofox

The stdio adapter connects an MCP host to the supervised Camofox REST gateway. Each host starts its own adapter and can share an existing gateway. The upstream MCP implementation was contributed by @epicsagas.

Reading this in the standalone adapter package? The [published usage guides](https://github.com/jackspooner/camofox-browser/tree/main/skills/camofox/references/usage) include the references linked below.

## Architecture and existing deployment

On the maintained Linux installation the source is `~/systems/camofox`, the user service is `camofox.service`, and the gateway is at `http://127.0.0.1:23058`. Its private state is in `~/services/runtime/camofox-agent`. Codex and Hermes use the alias `camofox` and distinct stable ownership identities. Reuse this gateway for browser work. A staging gateway needs its own port and private state directory.

The supervised service starts through `npm run start:agent`. The upstream singleton starts through `npm start` (normally port 9377). The fork's standalone `mcp/` package needs the MCP SDK and can run on a different host with access to the gateway. Use the adapter and gateway built from this fork for saved profiles, human control and visual tools. [Platform installation and migration](../docs/agent-platform.md#installation-and-migration)

## Connect an MCP host

For an existing installation, retain its configured command and private environment file. A source-based adapter can be started from any working directory with absolute paths:

```bash
node --env-file=/absolute/path/to/private/service.env /absolute/path/to/camofox/mcp/server.mjs
```

Use the installed compatible Node runtime (Node 24 on the maintained deployment). The adapter's environment must select the existing REST endpoint and a stable agent identity. Credentials belong in the private environment file, not in prompts or a checked-in host configuration. Configure the host's tool timeout to accommodate inference (the maintained Codex/Hermes registrations use 660 seconds).

For a new host, configure its stdio command/arguments using those absolute paths, and set `CAMOFOX_USER_ID` to that agent's stable identity. MCP clients such as Codex, Hermes, Claude Code, Cursor and OpenCode connect to this same adapter. The host's alias determines its visible tool prefix; the maintained alias is `camofox`.

If preparing another machine, follow the platform guide for browser, desktop viewer, Proton helper and model dependencies before starting `npm run start:agent`. Give a staging service its own port and runtime directory. An MCP connection alone does not install those components.

## Verify the connection

List the host's live tools to check the adapter catalogue. It includes `camofox_session_watch`, `camofox_locate`, `camofox_click_target` and [tab diagnostics](../skills/camofox/references/usage/examples/tab-diagnostics.md). Use `camofox_profile_list` or `camofox_session_list` to check gateway access, and `camofox_vpn_status` separately for Proton readiness.

If only 11 tools appear, check the adapter's source path and refresh its connection. Hermes uses `/reload-mcp`; Codex may require reconnecting or opening a new chat. Do not automatically restart active conversations or the browser service.

## Adapter environment

| Variable | Default | Purpose |
|---|---|---|
| `CAMOFOX_BASE_URL` | `http://localhost:<port>` | REST origin; maintained deployment uses `http://127.0.0.1:23058`. |
| `CAMOFOX_PORT` / `PORT` | `9377` | Fallback port when `CAMOFOX_BASE_URL` is absent; `CAMOFOX_PORT` takes precedence. |
| `CAMOFOX_USER_ID` | `mcp-<random UUID>` | Ownership identity. Set a stable distinct value for each agent that must reclaim saved work. |
| `CAMOFOX_SESSION_KEY` | `default` | Selects the legacy/default-session grouping when explicit saved sessions are omitted. |
| `CAMOFOX_ANALYSIS_MODEL` | Unset | RouterText model ID for image analysis when the tool call omits `inference`. Use a route that accepts images. |
| `CAMOFOX_ANALYSIS_PROVIDER` | Unset | Optional RouterText provider for the selected model. Requires `CAMOFOX_ANALYSIS_MODEL`. |
| `CAMOFOX_ACCESS_KEY` | Unset | Bearer credential for ordinary tool requests; must be accepted by the REST service. |
| `CAMOFOX_API_KEY` | Unset | Required by the adapter for cookie import, which sends this bearer credential instead. |
| `CAMOFOX_COOKIES_DIR` | `~/.camofox/cookies` | Cookie-file directory on the **adapter host**. |

Set the analysis variables in the MCP host's connection environment and reconnect
that adapter. Its image-analysis tool description reports the configured selection.
An explicit `inference` object replaces the entire connection selection for that
call. See the [image analysis guide](../skills/camofox/references/usage/capabilities/image-analysis.md).

Cookie files are parsed by the adapter and sent as cookie objects, never remote filesystem paths. `cookiesPath` must be relative within `CAMOFOX_COOKIES_DIR`; absolute paths, traversal and escaping symlinks are rejected. The parser limits input to 5 MiB; HTTP body limits also apply. `domainSuffix` is a literal suffix filter. Do not print cookie values or keys. The adapter requires `CAMOFOX_API_KEY` even if a development server permits unauthenticated loopback.

## Tools

The [usage index](../skills/camofox/references/usage/README.md) groups browser tasks by intent. The [tool and recovery reference](../skills/camofox/references/tools.md) covers the catalogue. The MCP adapter supplies `userId` and resolves existing tabs to their owning sessions. Use the live input schema for the connected adapter.

| Task | Guide |
| --- | --- |
| Open a page and read it | [First session and snapshot](../skills/camofox/references/usage/getting-started.md) |
| Interact with a visible object | [Visual targeting](../skills/camofox/references/usage/capabilities/visual-targeting.md) and [`drag_and_drop`](../skills/camofox/references/usage/operations/drag_and_drop.md) |
| Ask about pixels or an original image | [Image analysis](../skills/camofox/references/usage/capabilities/image-analysis.md) |

## Working with saved sessions

[List profiles, resume work, release ownership and change routes](../skills/camofox/references/tools.md#profiles-sessions-and-routing).

## Watching and manual control

[Watch a session, hand control to a person, or request its return](../skills/camofox/references/tools.md#viewing-and-visual-targets).

## Visual targeting and VPN

Use the [visual targeting guide](../skills/camofox/references/usage/capabilities/visual-targeting.md) for numbered targets. For routed sessions, see [account and helper setup](../docs/agent-platform.md#proton-and-viewer-setup).

## Troubleshooting and surface boundaries

Read the [recovery table](../skills/camofox/references/tools.md#recovery) for errors and possible partial actions. The gateway’s [HTTP contract](../agent-openapi.json) and its live `/docs` describe REST-only commands, including history, wait, viewport and resource fetch.

## Contract ownership and verification

Use the [developer guide](../skills/camofox/references/development/README.md) for contract sources, generated outputs, adapter checks and example maintenance.

## Pending operations and paced input

[Track or cancel an operation, inspect partial typing and recover safely](../skills/camofox/references/operations.md).

## Capture sequences

[Capture a bounded series and inspect or resume its manifest](../skills/camofox/references/capture-sequences.md). For selected frame text or image metadata, see [bounded frame reads](../skills/camofox/references/frame-reads.md).
