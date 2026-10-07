# Persistent agent platform

This checkout extends upstream Camofox 1.18.1. Run `npm run start:agent` for the supervised gateway. `npm start` retains the upstream singleton server for regression testing. The agent service pins `@camoufox/camoufox` 0.5.8-beta.3 and official Firefox 156.0.1-beta.36. Native profile opening verifies the browser version; changing it requires an explicit migration of a copy.

Runtime state defaults to `~/services/runtime/camofox-agent`, outside Git, with owner-only permissions. `sessions.sqlite` holds profile names, sessions, ownership, routing and tab checkpoints. Native Firefox storage and retained fingerprint configuration live in private profile directories. Each worker takes an OS `flock`; a coordinator lock prevents two supervisors modifying the store. SQLite also enforces one active session per profile.

Workers checkpoint every 15 seconds and after actions, before suspension and shutdown. They restore cookies (including session cookies), native localStorage/IndexedDB, tab URLs/order, logical IDs, active tab, scroll and recoverable sessionStorage. Process restart reports `restored`; ownership handover of running pages reports `live`. Page heap and unsaved form contents cannot be guaranteed after shutdown. Observations and element refs are invalidated. Idle suspension is 30 minutes; status polling and noVNC framebuffer polling are not activity. Active operations hold the session until completion.

## Agent workflow

1. `camofox_profile_list` / `camofox_profile_create({name})`.
2. `camofox_session_create({profileId, name?, country?})`, then `camofox_create_tab({sessionId,url})`.
3. Use snapshots and refs, native viewport coordinates, or `camofox_locate({tabId,prompt})`.
4. Inspect the numbered MCP image before `camofox_click_target({observationId,targetNumber})`. Single and multiple results both require the separate call. Zero matches also return an image. Observations expire after five minutes and are invalidated by movement/navigation/restoration or changed target pixels. Retries do not dispatch twice.
5. `camofox_session_viewer({sessionId})` returns a one-time local noVNC URL for human login/MFA. Agent mutations pause while it controls the session. Finish or close the viewer to checkpoint and return control.
6. `camofox_session_release({sessionId})` permits another agent to claim it. `camofox_session_suspend` closes it; `camofox_session_resume` restores it. Give each adapter a stable distinct `CAMOFOX_USER_ID` for ownership across reconnects.

The original eleven tab tools retain default-session behavior. All saved-session tools share descriptors in `mcp/lib/platform-contracts.mjs`; `mcp/lib/problems.mjs` owns new application error codes. Runtime HTTP request validation uses those same descriptors. `scripts/generate-platform-contracts.mjs` generates route-adjacent OpenAPI metadata, then `npm run generate-openapi` emits both upstream/combined `openapi.json` and the gateway's `agent-openapi.json`. The gateway serves only implemented routes in `/openapi.json`; `/docs` uses it. New errors preserve the legacy `{error,code}` envelope while adding `problem`, also delivered as MCP structured errors.

## Watching agents work

Call `camofox_session_watch({sessionId, open: true})` (REST: `POST /agent-sessions/{sessionId}/watch` with `userId` and boolean `open`) to open a dedicated desktop window. Repeat to present it; use `open: false` to close it without closing the browser session. The result and session status expose viewer `state` (`closed`, `opening`, `connected`) and `mode` (`watch`, `control`). Closed viewers report mode `watch` as the next-open default.

The window follows the agent's target tab. The VNC stream is cropped to the browser windows (using `xwininfo` from `x11-utils`) and noVNC scales it proportionally to fit the available space, including upscaling. Window resizing never requests a browser/remote-display resize, so page layout, screenshots and agent coordinates remain unchanged. Different aspect ratios leave centred margins. If browser-bound discovery fails, the full virtual desktop is displayed. **Take control** reserves human control immediately, waits for the current operation, and enables input. **Return to agent** checkpoints and invalidates refs/observations before permitting mutations again. Closing the window also returns control. The existing `camofox_session_viewer` login-link API remains available; only one link or desktop viewer may be open per session (`viewer_busy` on conflict).

Watch mode uses server-side x11vnc `-viewonly` and client-side noVNC read-only input; clipboard exchange is disabled in both modes. The ephemeral GTK/WebKitGTK shell receives its one-time ticket over private stdin. Connected clients use a revocable viewer-only capability for mode changes. No account/API keys are passed to the shell. Viewer processes are supervised and cleaned up on session release, suspension, routing restart, service shutdown and disconnect. Merely watching does not extend the 30-minute idle timeout.

Desktop dependencies: `python3-gi`, `gir1.2-gtk-3.0`, `gir1.2-webkit2-4.1`, `x11vnc`, `novnc`, `x11-utils`. The user service must inherit the graphical session's DISPLAY or WAYLAND_DISPLAY and XDG_RUNTIME_DIR; `desktop_unavailable` reports missing desktop access. Restart the service after logging into the desktop if its inherited environment is stale. No profile migration is required. Codex and Hermes discover the additional MCP tool after reconnect/reload.

Agents can offer control or ask for it back with `camofox_session_control({sessionId, action: "give" | "request"})`. Open the watch window first and wait for `viewer.state: "connected"`. The viewer displays an Accept/Decline prompt and a 15-second countdown; the tool waits and returns `outcome: accepted | declined | timed_out | cancelled | already_in_mode` plus viewer state. Declining or timing out leaves control unchanged. Closing or manually changing modes cancels a pending request. Acceptance may take longer than 15 seconds to finish an in-flight action and switch modes; the deadline applies to accepting, not completing the switch. A request does not itself pause agent work or take control from the user. Do not retry merely because the user declined or did not answer. After accepted return to the agent, refresh refs/observations.

REST parity: `POST /agent-sessions/{sessionId}/control` takes `userId` and `action`. The connected viewer polls `/viewer/handoff` using only its session-scoped capability and answers with the request ID. The server enforces the deadline, rejects late/reused responses, and never counts passive polling as activity. Pending handoffs are transient and cancelled by viewer teardown.

## Proton and viewer setup

Install official Proton Linux CLI/API-core/local-agent components, WireGuard/iproute2, Xvfb, x11vnc and noVNC. Run `python3 scripts/proton-provider.py setup` interactively for account sign-in/MFA. Reusable account credentials and tunnel signing keys use the desktop OS Secret Service, without plaintext fallback. The supervisor must run in the signed-in user's desktop/keyring session.

Run `sudo python3 scripts/install-agent-helper.py` to install the fixed root-owned helper and configuration. It permits only the configured UID, fixed namespace names, validated public endpoints and fixed worker/local-agent launch commands. Root is dropped before user-owned Python/Node code runs. This host already permits the helper through sudo; on another host, configure only the required helper invocation in sudoers rather than allowing arbitrary privileged commands.

Each routed worker has a separate namespace containing only loopback and WireGuard. Its encrypted UDP socket is created in the host namespace before moving the interface. DNS uses 10.2.0.1 through the tunnel; IPv6 is disabled inside the namespace. The host routes are unchanged. Tunnel/auth failure disables the interface. Certificate renewal uses the existing endpoint and identity; connection creation is serialized against the account limit. Country selection filters the official account catalogue. `country: null` is the only route-change input that selects direct traffic.

Viewer tickets are random, one-time and expire in 60 seconds before connection. They travel in a URL fragment, are removed from browser history on load, and are exchanged over a same-origin WebSocket. x11vnc uses a private Unix socket and explicitly selects X11 on Wayland desktops. The service binds loopback; remote viewers require an authenticated local forwarding arrangement.

## Installation and migration

Use Node 24 and `npm ci`. Set `XDG_CACHE_HOME` to the private runtime cache before `npm run fetch-bin`. The helper installer records the configured Node and checkout paths. The sample user unit is `deploy/camofox-agent.service`.

Private `service.env` needs `CAMOFOX_PORT`, `CAMOFOX_BIND_HOST=127.0.0.1`, nonempty `CAMOFOX_ACCESS_KEY` and `CAMOFOX_API_KEY`, `CAMOFOX_AGENT_STATE_DIR`, and `CAMOFOX_MEDIA_TOKEN_FILE` pointing to the existing MediaTools token. `CAMOFOX_MEDIA_URL` defaults to local port 23018 `/mcp`. Do not copy these values into agent responses. The existing LocateAnything model and MediaTools adapter own inference; screenshots are temporary private inputs and are deleted afterward.

Before cutover, stop the old service to flush its storage and back up its unit, environment, profile/cookie/upload/trace directories and agent registrations. Keep its checkout and browser installation. With the new supervisor stopped, run `node scripts/migrate-agent-profiles.mjs OLD_PROFILE_DIRECTORY`. It copies each saved storage file to an `imported-...` profile exactly once, retaining the original. The first resume imports it into Firefox and marks the import completed. Start the new service on the old port with compatible keys, and point adapters at this checkout's `mcp/server.mjs`.

Rollback: stop the new service; restore the backed-up service unit/environment and adapter registrations; restore the old skill registration; reload systemd and start the old service. Use only the original old profiles and browser during rollback. **Never open the migrated native profiles with the older browser.** New native state remains available for a later forward migration.

## Verification

`npm test` covers upstream unit/e2e/plugin regressions. `npm run test:platform` checks persistence/ownership constraints, input validation, coordinate dispatch and contract freshness/parity. `npm run test:mcp` verifies live catalog and packed adapter installation. Live fixtures and recovery/VPN procedures are in `tests/platform/README.md`.

The companion ComfyUI change retries transient status request timeouts within the job's overall deadline without resubmission, retains the job ID in timeout errors, and distinguishes polling transport errors from model execution errors. MediaTools retains that job ID in its adapter error. Live account tests are required before claiming VPN readiness; this host passed simultaneous GB/NL egress, unprivileged DNS, failure blocking, IPv6 blocking, certificate renewal and browser country switching on 2026-10-06.
