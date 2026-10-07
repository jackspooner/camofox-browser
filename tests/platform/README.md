# Manual live acceptance

Run against a separate staging service with its own port, runtime state and credentials in a private `service.env`. Verify its unit and paths first: the name `camofox-agent-staging.service` alone does not guarantee isolation. These tests create real profiles, use the authenticated Proton account, and the recovery test restarts/crashes **only that staging service**. Never point recovery testing at production.

Use Node 24 and explicitly set `CAMOFOX_AGENT_STATE_DIR` to the isolated runtime. Several scripts otherwise default to `~/services/runtime/camofox-agent`, which is production on the maintained host. `CAMOFOX_ACCEPTANCE_DIR` defaults to the selected runtime's private `acceptance` directory. Do not run the live scripts with production defaults.

1. `node tests/platform/browser-live.mjs --locate` creates a controlled three-button page, checks persistent storage, coordinates and isolation, and waits with the fixture running. Inspect its saved numbered image before selecting a target through the API.
2. While that fixture runs: `node tests/platform/mcp-live.mjs` checks real stdio MCP images, zero matches and structured errors. `node tests/platform/recovery-live.mjs` verifies service restart, crash recovery and idle suspension with status polling.
3. `node tests/platform/vpn-live.mjs` tests two namespaces, unprivileged DNS/egress, certificate renewal, tunnel failure and IPv6 blocking. `node tests/platform/vpn-browser-live.mjs` checks actual browser egress and country changes.
4. Open a session viewer, verify agent mutation rejection, interact through noVNC, finish, and verify that the agent regains control. Tickets expire in 60 seconds before connection and can be used once.

`npm run test:platform` runs the deterministic storage, click-validation and HTTP/MCP freshness tests without external services.

Watch acceptance: start an isolated service on port 23159 with state directory ending in `camofox-watch-test` and its own `service.env`. Only the pinned browser cache may be shared. Run `CAMOFOX_AGENT_STATE_DIR=.../camofox-watch-test node tests/platform/watch-live.mjs` (add `--hold` for manual viewer testing). Verify the Take control / Return to agent buttons, attempted read-only input, clipboard blocking, active-tab following and native window-manager close. The test never uses production profiles.

Control handoff acceptance: with the isolated watch service running, use `CAMOFOX_AGENT_STATE_DIR=.../camofox-watch-test node tests/platform/control-live.mjs`. Its native accessibility driver exercises the visible 15-second prompt, acceptance in both directions, rejection, timeout and window-close cancellation. `control-consumers-live.mjs` reads the installed Codex/Hermes registrations and checks the new schema and missing-session error without changing browser control.
