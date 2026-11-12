# Camofox agent browser

This fork adds persistent browsing and shared human–agent control to
[jo-inc/camofox-browser](https://github.com/jo-inc/camofox-browser). It is for
agents that need to retain website logins, resume work across sessions, and let
a person watch or take over. See the [upstream README](https://github.com/jo-inc/camofox-browser/blob/master/README.md)
for the base browser API, architecture and deployment options.

## What this fork adds

- **Persistent browsing:** named Firefox profiles retain logins and fingerprint
  settings. Saved sessions restore tab URLs, order, logical IDs, active tab,
  scroll and recoverable session storage. Explicit ownership supports handover
  between agents; one active session may use a profile at a time.
- **Supervised sessions:** separate workers, private checkpoints, profile locks
  and idle suspension keep long-running work manageable. Tracked operations
  provide progress, cancellation and retry identities without replaying
  interrupted actions. Paced typing and viewer Stop support supervised input.
- **Human handoffs:** desktop watching follows the working tab without changing
  its viewport. People can take control for login, MFA or other input and return
  it to the agent. Agents can offer or request control through a timed
  Accept/Decline prompt; automation pauses during human control.
- **Per-session routing:** authenticated Proton country selection uses Linux
  network namespaces and WireGuard. Host routing stays unchanged, and failed
  tunnels do not fall back to direct traffic.
- **Visual tools:** inspect numbered LocateAnything targets before clicking,
  use measured viewport coordinates, capture bounded page/slide sequences,
  read selected frames, and analyse screenshots or original images through
  MediaTools. Image analysis supports local models and explicit hosted Auto.
- **Agent interfaces:** MCP and OpenClaw adapters share tool contracts with the
  supervised REST gateway. A repository-owned skill documents usage and recovery.

## Install this fork

Use this repository's `main` branch; the published upstream npm package does
not include these additions. The full platform targets Linux. Use Node 24;
the package requires Node 22 or newer. Native Windows operation is unverified.

```bash
git clone --branch main https://github.com/jackspooner/camofox-browser.git camofox
cd camofox
npm ci
```

Installation fetches the pinned browser. Complete the private environment,
browser-cache and dependency setup in the [platform guide](docs/agent-platform.md#installation-and-migration),
then launch the supervised gateway:

```bash
node --env-file=/absolute/path/to/private/service.env scripts/start-agent.mjs
```

`npm run start:agent` uses the same gateway when the environment is already
supplied. `npm start` runs the retained upstream singleton for compatibility.

Desktop watching requires a graphical session and GTK/WebKitGTK, Xvfb and VNC
dependencies. Proton routing needs an eligible account, OS Secret Service,
WireGuard and the scoped privileged helper. Visual targeting and image analysis
need a separately configured MediaTools service and models. These optional
services, model weights and credentials are not bundled.

## Start a saved session

Connect your MCP host using the [MCP guide](mcp/README.md). These are separate
tool calls; replace each placeholder with the ID returned by the earlier call:

```js
camofox_profile_create({name: "Research"})
camofox_session_create({profileId: "PROFILE_ID", name: "Product research"})
camofox_create_tab({sessionId: "SESSION_ID", url: "https://example.com"})
camofox_snapshot({tabId: "TAB_ID"})
camofox_session_watch({sessionId: "SESSION_ID", open: true})
```

Reuse an existing profile/session when continuing work. Suspend to checkpoint
and close its worker; release ownership for another agent. Set a stable,
distinct `CAMOFOX_USER_ID` for each adapter.

## Limits and documentation

Restoration cannot guarantee arbitrary JavaScript memory or unsaved forms.
Websites may expire saved logins. Refresh refs and visual observations after
restoration or a human handoff. Pending operations are not completed actions;
cancellation can leave partial effects. Follow the recovery guidance before retrying.

The gateway's supported routes are defined by its own `/docs` and
`/openapi.json`; upstream plugins and singleton-only routes are not automatically
available. Source updates do not update running gateways or workers. Preserve
profiles during migration and verify routing on each installation.

- [Platform setup, migration and recovery](docs/agent-platform.md)
- [MCP setup, examples and tool catalogue](mcp/README.md)
- [Agent skill](skills/camofox/SKILL.md), [operations](skills/camofox/references/operations.md)
  and [image collection](skills/camofox/references/image-collection.md)
- [Image analysis](docs/image-analysis.md) and [HTTP contract](agent-openapi.json)
- [Contributor setup](AGENTS.md#linked-worktree-development) and [isolated live acceptance](tests/platform/README.md)

## Credits and license

Upstream Camofox is maintained by [Jo](https://github.com/jo-inc/camofox-browser),
with the initial MCP implementation contributed by @epicsagas.
[Camoufox](https://github.com/camoufox/camoufox) provides the Firefox-based engine.
This fork is licensed under [MIT](LICENSE).
