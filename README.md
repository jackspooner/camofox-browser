# Camofox agent browser

Camofox lets an agent open a website, work from a snapshot, and save the session so a person or another agent can pick it up later. This fork of [Jo’s Camofox browser](https://github.com/jo-inc/camofox-browser) adds a supervised Linux gateway, persistent Firefox profiles and shared human–agent control. The [upstream README](https://github.com/jo-inc/camofox-browser/blob/master/README.md) covers the base browser, singleton API, plugins and deployment options.

**Already connected?** Call `camofox_profile_list({})`. A successful response lists the saved profiles, which can be empty on a fresh installation. To open a page and read its text and links in a browser snapshot, follow the [first-tab walkthrough](skills/camofox/references/usage/getting-started.md).

## What this fork adds

| What you want to do | Where to start |
| --- | --- |
| Find a control by its accessible role or name across observed frames | [Search the accessibility snapshot](skills/camofox/references/usage/examples/search-snapshot.md) |
| Keep logins, resume saved tabs or hand work to another agent | [Profiles, session ownership and routing](skills/camofox/references/tools.md#profiles-sessions-and-routing) |
| Watch the working tab or take over for login and MFA | [Viewer and human control](skills/camofox/references/tools.md#viewing-and-visual-targets) |
| Click a numbered visual target or drag between two visible objects | [Choose a targeting method](skills/camofox/references/usage/capabilities/visual-targeting.md) or look up [`drag_and_drop`](skills/camofox/references/usage/operations/drag_and_drop.md) |
| Read a frame, analyse an image or save a series of pages | [Browse task guides and examples](skills/camofox/references/usage/README.md) |
| Follow a long action, stop typing or check what happened after cancellation | [Operations, partial input and recovery](skills/camofox/references/operations.md) |
| Route one session through an eligible Proton country | [Account, helper and viewer setup](docs/agent-platform.md#proton-and-viewer-setup) |

## Install this fork

Use this repository’s `main` branch for the supervised gateway. The full platform targets Linux with Node 24 (package minimum 22). Native Windows operation remains unverified.

```bash
git clone --branch main https://github.com/jackspooner/camofox-browser.git camofox
cd camofox
npm ci
```

Installation can fetch the pinned Camoufox browser. Configure the [private environment, browser cache and state directory](docs/agent-platform.md#installation-and-migration), then start the gateway with that environment.

```bash
node --env-file=/absolute/path/to/private/service.env scripts/start-agent.mjs
```

Use `npm run start:agent` if the environment is already loaded. `npm start` launches the upstream singleton. [Connect your MCP host](mcp/README.md#connect-an-mcp-host) to the supervised gateway for this fork’s tools.

Desktop watching needs a graphical session and GTK/WebKitGTK, Xvfb and VNC dependencies. Proton routing needs an eligible account, OS Secret Service, WireGuard and the installed scoped helper. Visual targeting and image inference need a separately configured MediaTools service and compatible models. For existing routed installations, see the [privileged helper update](docs/agent-platform.md#updating-the-installed-network-helper).

## Start a saved session

Follow [Start a named session](skills/camofox/references/usage/concepts.md#start-a-named-session) for the profile, session and tab ID handoffs. Each profile can have one active session. Suspend it to checkpoint its tabs or release ownership for handover. Use a distinct stable `CAMOFOX_USER_ID` per adapter.

## Limits and documentation

Restoring a session reopens saved tabs and recovers available storage. Websites can expire logins, and unsaved forms and JavaScript state may be lost. Take a new snapshot after restoration or human control. A pending operation can still change the page. Check its outcome before sending another action.

- **Use the browser** through the [agent skill](skills/camofox/SKILL.md) and [tool reference](skills/camofox/references/tools.md).
- **Operate the gateway** with the [platform runbook](docs/agent-platform.md). Its live `/docs` and `/openapi.json` describe the routes it serves. The [supervised HTTP contract](agent-openapi.json) is also in this checkout.
- **Develop the fork** with the [developer guide](skills/camofox/references/development/README.md), [repository instructions](AGENTS.md) and [isolated acceptance fixtures](tests/platform/README.md).

## Credits and license

Jo maintains upstream Camofox. @epicsagas contributed the initial MCP implementation. [Camoufox](https://github.com/daijro/camoufox) provides the Firefox-based engine. This fork retains the [MIT license](LICENSE).
