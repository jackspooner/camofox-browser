# Camofox tool and recovery reference

Use the live MCP schemas for exact argument validation. The maintained catalogue has 27 tools, owned by `mcp/lib/tool-contracts.mjs` and `mcp/lib/platform-contracts.mjs`. Examples below show tool names and JSON arguments; use the host's discovered name under the `camofox` alias.

## Browser tools

All 11 browser tools accept optional `sessionId`. Supply it when creating or listing tabs or importing cookies into a named session. An existing `tabId` identifies its owning session; passing another session ID does not move the tab. Omission for session-level operations selects the adapter's default session. The adapter supplies its configured ownership identity; it is not a tool argument.

| Tool | Arguments and use |
|---|---|
| `camofox_create_tab` | Required `url`; optional `sessionId`. Returns a logical `tabId`. |
| `camofox_snapshot` | Required `tabId`; optional `offset`. Accessibility text, current element refs and an MCP image. If `hasMore` is true, continue with the returned `nextOffset`. |
| `camofox_click` | Required `tabId` and exactly one of `ref`, `selector`, `coordinates: {x,y}`; optional `doubleClick`. Native pointer input; coordinates are viewport CSS pixels. |
| `camofox_type` | Required `tabId`, `text`; supply a current `ref` or unique `selector`. Fills the field, replacing its contents; optional `pressEnter` submits afterward. The MCP schema does not expose keyboard-mode typing. |
| `camofox_navigate` | Required `tabId`; supply `url` or a supported `macro` with `query`. Take a new snapshot afterward. |
| `camofox_scroll` | Required `tabId`, `direction` (`up`, `down`, `left`, `right`); optional pixel `amount` (default 500). Inspect whether the intended content actually moved. |
| `camofox_screenshot` | Required `tabId`. Returns an actual MCP image. Do not print its base64 or estimate CSS coordinates from a scaled chat preview. |
| `camofox_evaluate` | Required `tabId`, `expression`. Executes page JavaScript and returns its result; useful for reading state or extracting data. Page API calls and scripts may mutate the site. |
| `camofox_list_tabs` | Optional `sessionId`. Lists open tabs for the selected session. Resume saved work before interacting with its tabs. |
| `camofox_close_tab` | Required `tabId`. Closes that tab. Closing the final tab leaves one managed blank placeholder; creating another tab removes it. Intentional blanks are preserved. Use session suspension to stop the worker and retain the saved tab set. |
| `camofox_import_cookies` | Required `cookiesPath`; optional `domainSuffix`, `sessionId`. Imports a Netscape cookie file into the selected profile's running session. See cookie constraints below. |

Snapshot pagination uses character offsets, not page numbers. Use the returned offset unchanged and gather enough context before acting. Navigation, session restoration and human handoff require fresh refs. A selector matching several elements requires a more specific selector or a new snapshot/ref.

`camofox_evaluate` is not a substitute for native input when demonstrating or testing real clicks. A script-triggered `.click()` does not test pointer dispatch. If scrolling does not move a lazy-loaded or nested region, inspect the scroll container; targeted JavaScript scrolling is available when appropriate. Locate again after any scroll or layout change.

Supported search macros: `@google_search`, `@youtube_search`, `@amazon_search`, `@reddit_search`, `@wikipedia_search`, `@twitter_search`, `@yelp_search`, `@spotify_search`, `@netflix_search`, `@linkedin_search`, `@instagram_search`, `@tiktok_search`, `@twitch_search`. Discover the current enum rather than inventing a macro.

Example calls (replace IDs and refs with actual results):

```text
camofox_create_tab({"sessionId":"SESSION_ID","url":"https://example.com"})
camofox_snapshot({"tabId":"TAB_ID"})
camofox_snapshot({"tabId":"TAB_ID","offset":12000})  // only if nextOffset was 12000
camofox_navigate({"tabId":"TAB_ID","macro":"@wikipedia_search","query":"Firefox"})
camofox_type({"tabId":"TAB_ID","ref":"e2","text":"browser automation","pressEnter":true})
camofox_click({"tabId":"TAB_ID","coordinates":{"x":240,"y":180},"doubleClick":true})
camofox_evaluate({"tabId":"TAB_ID","expression":"({title: document.title, scrollY: window.scrollY})"})
```

Each example is independent; refresh refs after navigation, and use measured, in-bounds coordinates.

### Cookie constraints

The **adapter process** reads `cookiesPath` beneath its `CAMOFOX_COOKIES_DIR` (default `~/.camofox/cookies`), parses the file, and sends cookie objects over HTTP. It is not a path on a remote REST host. Absolute paths, traversal and symlinks escaping that directory are rejected; the parser limit is 5 MiB, and the HTTP service also applies request-size limits. `domainSuffix` performs a literal domain suffix filter; choose it deliberately and do not treat it as a full domain allowlist validator.

The adapter requires `CAMOFOX_API_KEY` for this tool even when a development REST server allows unauthenticated loopback. Its value must be accepted by the service. Keep cookie values and keys out of chat and logs. For new interactive logins, the human viewer usually avoids needing cookie export files.

## Profiles, sessions and routing

| Tool | Arguments and use |
|---|---|
| `camofox_profile_list` | No arguments. Discover saved profile IDs and names. |
| `camofox_profile_create` | Required `name`. Creates a reusable login identity; does not itself create tabs. |
| `camofox_session_list` | No arguments. Discover saved sessions, state and owners. |
| `camofox_session_create` | Required `profileId`; optional `name`, `country`. Omit country for direct routing; country names and ISO codes are supported. A profile can have only one active session. |
| `camofox_session_status` | Required `sessionId`. Includes ownership, state, tab count, routing, `humanControl` and viewer state. Polling does not extend idle life. |
| `camofox_session_resume` | Required `sessionId`. Claims/resumes available work; inspect `resumption` (`live` or `restored`) and any `restorationLimits`. |
| `camofox_session_release` | Required `sessionId`. Releases ownership for handover and closes the viewer. The next agent must resume/claim using its own identity. |
| `camofox_session_suspend` | Required `sessionId`. Checkpoints tabs and closes the worker/viewer while retaining the profile and saved session. |
| `camofox_session_route` | Required `sessionId`, `country`. Country string selects Proton; explicit `null` selects direct traffic. Checkpoints and restarts the worker; reopen the viewer and refresh refs afterward. |
| `camofox_vpn_status` | No arguments. Returns account readiness without credentials. |
| `camofox_vpn_countries` | No arguments. Returns eligible country codes/names and the account's connection limit. |

Use stable, distinct adapter identities for different agents. Profiles isolate cookies, localStorage and IndexedDB. Restored sessions recover logical tab IDs, URLs/order, active tab, scroll and recoverable sessionStorage. A running handover can retain live pages; suspension or a crash cannot guarantee JavaScript heap or unsaved forms. The 30-minute idle timer excludes status polling and watching; active operations prevent suspension.

For Proton setup the user signs in through `python3 scripts/proton-provider.py setup` from the source checkout. Keep passwords and MFA in that terminal. Country availability depends on the authenticated account. Each routed worker has isolated networking; host routes stay unchanged, and tunnel failure does not fall back to direct traffic. A routed browser's `127.0.0.1` is its namespace loopback, so host-only demo pages are not reachable there. Verify browser egress with a suitable public page when demonstrating VPN routing.

## Viewing and visual targets

| Tool | Arguments and use |
|---|---|
| `camofox_session_control` | Required `sessionId`, `action` (`give` or `request`). Ask through the connected viewer and await its 15-second acceptance outcome. |
| `camofox_session_watch` | Required `sessionId`, boolean `open`. Opens/presents or closes a desktop window; returns `state` (`closed`, `opening`, `connected`) and `mode` (`watch`, `control`). Requires ownership and an active session to open. |
| `camofox_session_viewer` | Required `sessionId`. Returns a one-use login URL and `expiresInSeconds`; reserves human control. Share the link with the user for login/MFA. |
| `camofox_locate` | Required `tabId`, `prompt`. Returns numbered boxes, screenshot geometry, `observationId`, and an actual MCP image. Inspect that image; this tool never clicks. |
| `camofox_click_target` | Required `observationId`, positive integer `targetNumber`. Separately clicks the inspected target's centre with screenshot-to-viewport conversion. |

Agents can offer control or ask for it back with `camofox_session_control({sessionId, action: "give" | "request"})`. Open the watch window first and wait for `viewer.state: "connected"`. The viewer displays an Accept/Decline prompt and a 15-second countdown; the tool waits and returns `outcome: accepted | declined | timed_out | cancelled | already_in_mode` plus viewer state. Declining or timing out leaves control unchanged. Closing or manually changing modes cancels a pending request. Acceptance may take longer than 15 seconds to finish an in-flight action and switch modes; the deadline applies to accepting, not completing the switch. A request does not itself pause agent work or take control from the user. Do not retry merely because the user declined or did not answer. After accepted return to the agent, refresh refs/observations.

There is one viewer per session. Repeated desktop opens preserve the current mode; desktop/link conflicts return `viewer_busy`. Watching permits automation and scales the cropped browser stream proportionally, including upscaling. Resizing the window changes neither browser viewport nor agent coordinates; differing aspect ratios can leave margins. Clipboard exchange is disabled.

Take control blocks new mutations immediately and waits for an ongoing operation before enabling human input. Return to agent stops human input, checkpoints and invalidates old refs/observations. Closing while controlling also returns control. Release, suspension, routing restart, worker failure or service shutdown closes the viewer and revokes its capability; reopening is explicit. Neither watching nor framebuffer polling keeps a session alive. Desktop launching requires the host's graphical session.

A login-link ticket expires after 60 seconds before connection and is single-use. Request a fresh link if it expired; do not reuse or log it. Watch windows handle their own ticket privately.

LocateAnything overlays numbers for both one and multiple matches. Zero matches require a refined prompt or a different view. Inspect and select explicitly:

```text
camofox_locate({"tabId":"TAB_ID","prompt":"the green Reveal button"})
// Inspect the returned image before choosing target 1.
camofox_click_target({"observationId":"OBSERVATION_ID","targetNumber":1})
```

Scrolling, navigation, viewport changes, restoration, expiry or changed target pixels require a new locate. Repeating the same observation/target does not dispatch twice; this protection is not a general guarantee for ordinary click, type or evaluate calls. If a click outcome is unknown, inspect the resulting page before deciding whether another action is needed.

## Recovery

Platform failures expose `problem` with `code`, `detail`, `status` and `retryable`; legacy tab operations can retain upstream error shapes. Read the response rather than assuming every failure is transient.

| Code or symptom | Next step |
|---|---|
| `invalid_request`, `invalid_country`, `invalid_target`, `invalid_click_target`, `invalid_coordinates` | Correct the arguments using the live schema, measured viewport or returned target numbers. |
| `profile_not_found`, `session_not_found`, `tab_not_found` | List current profiles/sessions/tabs and resolve the intended ID. |
| `profile_exists` | Reuse the intended named profile or choose a different name. |
| `profile_busy`, `session_owned` | Inspect the reported owner/session. Arrange release/handover; do not impersonate the owner. |
| `session_busy` | Let the active operation finish and inspect status before retrying the lifecycle action. |
| `session_suspended` | Resume the session, then take a fresh snapshot. |
| `human_control` | Wait for `humanControl: false`; refresh refs/observations before continuing. |
| `viewer_not_connected` | Open the watch window and wait until it is connected before requesting a handoff. |
| `handoff_expired` | The viewer response was late or already answered; leave control unchanged and inspect the agent request outcome. |
| `viewer_busy` | Use or close the existing viewer through its supported controls before opening the other viewer type. |
| `viewer_unauthorized` | Obtain a fresh viewer ticket; check expiry/origin rather than reusing credentials. |
| `desktop_unavailable`, `viewer_failed` | Check the host graphical session and viewer dependencies. Offer the authenticated login-link viewer if appropriate. |
| `stale_observation` | Locate again for visual targets; take a fresh snapshot for invalidated refs. |
| `click_outcome_unknown` | Inspect page state. Do not blindly create a new target and repeat the click. |
| `country_unavailable`, `vpn_connection_limit` | Recheck eligible countries and existing sessions. Suspend only sessions you are authorized to stop, or choose an allowed country. |
| `proton_login_required` | Ask the user to complete interactive setup in their terminal. |
| `proton_timeout`, `proton_unavailable`, `proton_provider_error`, `vpn_handshake_failed` | Inspect account/tunnel status and service diagnostics. Keep routed work stopped; switching to direct is an explicit routing decision. |
| `locate_failed` | Inspect inference diagnostics. Polling timeouts retain the ComfyUI job ID in MediaTools; establish the existing job's outcome before resubmission. |
| `worker_error`, `worker_failed`, `worker_timeout`, `internal_error` | Inspect session status and sanitized service logs; recover the affected session where possible. A timeout does not establish whether a mutation ran. |
| Missing tools or an 11-tool catalogue | Refresh the adapter connection; ensure it runs this checkout's adapter. Hermes supports `/reload-mcp`. Do not restart active work automatically. |

## Surface boundaries

The 27 tools above are the MCP/OpenClaw surface. The supervised REST gateway also exposes tab operations such as wait, select, press, upload, viewport, back/forward/refresh, links/images, extraction, downloads, resource fetch and stats. These do **not** have corresponding MCP tools. Before using REST for a missing capability, consult the deployed `/openapi.json` or `/docs` and the checkout's `agent-openapi.json` for the exact method, arguments and authentication. Preserve ownership and human-control rules; do not call worker-private endpoints.

The upstream singleton specification `openapi.json` includes additional endpoints that the supervised gateway does not expose, such as global browser stopping and destructive session deletion. Do not assume an upstream route is available here. Viewer transport endpoints are for the authenticated viewer client. Proton setup, migration and rollback are local operational commands, not agent tools; see `docs/agent-platform.md` in the source checkout.
