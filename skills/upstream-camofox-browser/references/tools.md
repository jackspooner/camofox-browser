# Camofox tool and recovery reference

Use the live MCP schemas for exact argument validation. The maintained catalogue has 27 tools, owned by `mcp/lib/tool-contracts.mjs` and `mcp/lib/platform-contracts.mjs`. Examples below show tool names and JSON arguments; use the host's discovered name under the `camofox` alias.

## Browser tools

All 11 browser tools accept optional `sessionId`. Supply it when creating or listing tabs or importing cookies into a named session. An existing `tabId` identifies its owning session; passing another session ID does not move the tab. Omission for session-level operations selects the adapter's default session. The adapter supplies its configured ownership identity; it is not a tool argument.

| Tool | Arguments and use | When to use it (example) |
|---|---|---|
| `camofox_create_tab` | Required `url`; optional `sessionId`. Returns a logical `tabId`. | Open a second source while keeping the current research page. |
| `camofox_snapshot` | Required `tabId`; optional `offset`. Brings the tab forward while watching; returns accessibility text, current element refs and an MCP image. If `hasMore` is true, continue with the returned `nextOffset`. | Find the current input/button refs before filling a form. |
| `camofox_click` | Required `tabId` and exactly one of `ref`, `selector`, `coordinates: {x,y}`; optional `doubleClick`. Native pointer input; coordinates are viewport CSS pixels. | Activate the exact button identified in the latest snapshot. |
| `camofox_type` | Required `tabId`, `text`; supply a current `ref` or unique `selector`. Fills the field, replacing its contents; optional `pressEnter` submits afterward. The MCP schema does not expose keyboard-mode typing. | Replace a search field with the user's query and submit it. |
| `camofox_navigate` | Required `tabId`; supply `url` or a supported `macro` with `query`. Take a new snapshot afterward. | Reuse a research tab for a new URL or a supported search. |
| `camofox_scroll` | Required `tabId`, `direction` (`up`, `down`, `left`, `right`); optional pixel `amount` (default 500). Inspect whether the intended content actually moved. | Reveal content below the current viewport before inspecting it. |
| `camofox_screenshot` | Required `tabId`. Brings the tab forward while watching and returns an actual MCP image. Do not print its base64 or estimate CSS coordinates from a scaled chat preview. | Check a visual result, layout or error banner. |
| `camofox_evaluate` | Required `tabId`, `expression`. Executes page JavaScript and returns its result; useful for reading state or extracting data. Page API calls and scripts may mutate the site. | Read structured page data or inspect a nested scroll container. |
| `camofox_list_tabs` | Optional `sessionId`. Lists open tabs for the selected session. Resume saved work before interacting with its tabs. | Recover the correct tab ID after resuming saved work. |
| `camofox_close_tab` | Required `tabId`. Closes that tab; use session suspension instead when you want to retain the saved tab set. | Discard a temporary comparison tab while retaining other work. |
| `camofox_import_cookies` | Required `cookiesPath`; optional `domainSuffix`, `sessionId`. Imports a Netscape cookie file into the selected profile's running session. See cookie constraints below. | Use an existing authorized cookie export instead of logging in again. |

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
camofox_scroll({"tabId":"TAB_ID","direction":"down","amount":500})
camofox_screenshot({"tabId":"TAB_ID"})
camofox_list_tabs({"sessionId":"SESSION_ID"})
camofox_close_tab({"tabId":"TEMPORARY_TAB_ID"})
camofox_import_cookies({"sessionId":"SESSION_ID","cookiesPath":"example.com.txt","domainSuffix":"example.com"})
```

Each example is independent; refresh refs after navigation, and use measured, in-bounds coordinates.

### Cookie constraints

The **adapter process** reads `cookiesPath` beneath its `CAMOFOX_COOKIES_DIR` (default `~/.camofox/cookies`), parses the file, and sends cookie objects over HTTP. It is not a path on a remote REST host. Absolute paths, traversal and symlinks escaping that directory are rejected; the parser limit is 5 MiB, and the HTTP service also applies request-size limits. `domainSuffix` performs a literal domain suffix filter; choose it deliberately and do not treat it as a full domain allowlist validator.

The adapter requires `CAMOFOX_API_KEY` for this tool even when a development REST server allows unauthenticated loopback. Its value must be accepted by the service. Keep cookie values and keys out of chat and logs. For new interactive logins, the human viewer usually avoids needing cookie export files.

## Profiles, sessions and routing

| Tool | Arguments and use | When to use it (example) |
|---|---|---|
| `camofox_profile_list` | No arguments. Discover saved profile IDs and names. | Find the saved login identity before creating a duplicate. |
| `camofox_profile_create` | Required `name`. Creates a reusable login identity; does not itself create tabs. | Separate work-site logins from personal/research logins. |
| `camofox_session_list` | No arguments. Discover saved sessions, state and owners. | Find yesterday's suspended research task and its owner. |
| `camofox_session_create` | Required `profileId`; optional `name`, `country`. Omit country for direct routing; country names and ISO codes are supported. A profile can have only one active session. | Start a new task using an existing profile's logins. |
| `camofox_session_status` | Required `sessionId`. Includes ownership, state, tab count, routing, `humanControl` and viewer state. Polling does not extend idle life. | Check whether the viewer is connected or the user still has control. |
| `camofox_session_resume` | Required `sessionId`. Claims/resumes available work; inspect `resumption` (`live` or `restored`) and any `restorationLimits`. | Continue a suspended task or claim work another agent released. |
| `camofox_session_release` | Required `sessionId`. Releases ownership for handover and closes the viewer. The next agent must resume/claim using its own identity. | Hand a running task to another agent without discarding its pages. |
| `camofox_session_suspend` | Required `sessionId`. Checkpoints tabs and closes the worker/viewer while retaining the profile and saved session. | Stop browser work now and reopen the saved tabs later. |
| `camofox_session_route` | Required `sessionId`, `country`. Country string selects Proton; explicit `null` selects direct traffic. Checkpoints and restarts the worker; reopen the viewer and refresh refs afterward. | Change country for a regional browsing task after discovering eligible routes. |
| `camofox_vpn_status` | No arguments. Returns account readiness without credentials. | Check whether interactive account setup is needed before routing. |
| `camofox_vpn_countries` | No arguments. Returns eligible country codes/names and the account's connection limit. | Choose a country the account permits before requesting a route. |

Use stable, distinct adapter identities for different agents. Profiles isolate cookies, localStorage and IndexedDB. Restored sessions recover logical tab IDs, URLs/order, active tab, scroll and recoverable sessionStorage. A running handover can retain live pages; suspension or a crash cannot guarantee JavaScript heap or unsaved forms. The 30-minute idle timer excludes status polling and watching; active operations prevent suspension.

Example calls for saved work (choose the applicable action; this is not an unconditional sequence):

```text
camofox_profile_list({})
camofox_profile_create({"name":"Work research"})
camofox_session_list({})
camofox_session_create({"profileId":"PROFILE_ID","name":"Supplier comparison"})
camofox_session_status({"sessionId":"SESSION_ID"})
camofox_session_resume({"sessionId":"SESSION_ID"})
camofox_session_release({"sessionId":"SESSION_ID"})
camofox_session_suspend({"sessionId":"SESSION_ID"})
camofox_vpn_status({})
camofox_vpn_countries({})
camofox_session_route({"sessionId":"SESSION_ID","country":"NL"})
```

Reuse IDs from discovery/creation results. Resume only available work. Release for another owner or suspend to stop the worker; these are different decisions. Route to `NL` only if the returned country catalogue includes it and the task calls for that route.

For Proton setup the user signs in through `python3 scripts/proton-provider.py setup` from the source checkout. Keep passwords and MFA in that terminal. Country availability depends on the authenticated account. Each routed worker has isolated networking; host routes stay unchanged, and tunnel failure does not fall back to direct traffic. A routed browser's `127.0.0.1` is its namespace loopback, so host-only demo pages are not reachable there. Verify browser egress with a suitable public page when demonstrating VPN routing.

## Viewing and visual targets

| Tool | Arguments and use | When to use it (example) |
|---|---|---|
| `camofox_session_control` | Required `sessionId`, `action` (`give` or `request`). Ask through the connected viewer and await its 15-second acceptance outcome. | Offer manual form entry, or ask the user to return control afterward. |
| `camofox_session_watch` | Required `sessionId`, boolean `open`. Opens/presents or closes a desktop window; returns `state` (`closed`, `opening`, `connected`) and `mode` (`watch`, `control`). Requires ownership and an active session to open. | Let the user watch a live demo while automation continues. |
| `camofox_session_viewer` | Required `sessionId`. Returns a one-use login URL and `expiresInSeconds`; reserves human control. Share the link with the user for login/MFA. | Give the user a browser link for login/MFA when a desktop watch window is unsuitable. |
| `camofox_locate` | Required `tabId`, `prompt`. Returns numbered boxes, screenshot geometry, `observationId`, and an actual MCP image. Inspect that image; this tool never clicks. | Find a visually described button when a usable element ref is unavailable. |
| `camofox_click_target` | Required `observationId`, positive integer `targetNumber`. Separately clicks the inspected target's centre with screenshot-to-viewport conversion. | After inspecting the overlay, click the chosen one of several matching areas. |

Agents can offer control or ask for it back with `camofox_session_control({sessionId, action: "give" | "request"})`. Open the watch window first and wait for `viewer.state: "connected"`. The viewer displays an Accept/Decline prompt and a 15-second countdown; the tool waits and returns `outcome: accepted | declined | timed_out | cancelled | already_in_mode` plus viewer state. Declining or timing out leaves control unchanged. Closing or manually changing modes cancels a pending request. Acceptance may take longer than 15 seconds to finish an in-flight action and switch modes; the deadline applies to accepting, not completing the switch. A request does not itself pause agent work or take control from the user. Do not retry merely because the user declined or did not answer. After accepted return to the agent, refresh refs/observations.

Example calls for a live demonstration and human assistance:

```text
camofox_session_watch({"sessionId":"SESSION_ID","open":true})
camofox_session_status({"sessionId":"SESSION_ID"})
// Wait for viewer.state to be connected before offering control.
camofox_session_control({"sessionId":"SESSION_ID","action":"give"})
// When it is appropriate to continue, ask the user to return control.
camofox_session_control({"sessionId":"SESSION_ID","action":"request"})
camofox_session_watch({"sessionId":"SESSION_ID","open":false})
// Alternative login-link workflow: use when no other viewer is open.
camofox_session_viewer({"sessionId":"SESSION_ID"})
```

Inspect each control request's outcome. An unanswered or declined offer is not permission to assume control changed; a successful return requires a fresh snapshot before acting.

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
| `operation_cancelled` | Input stopped at its deadline. Read a fresh snapshot and inspect the existing field/page state; partial effects remain. This is not an instruction to replay the text or click. |
| `operation_outcome_unknown` | Input cleanup could not be confirmed. The worker blocks new input while closing its browser. Read session status; recover/resume only after it stops, then inspect restored state before another action. Unsaved state may be lost. |
| Missing tools or an 11-tool catalogue | Refresh the adapter connection; ensure it runs this checkout's adapter. Hermes supports `/reload-mcp`. Do not restart active work automatically. |

## Version-specific tab lifecycle

Builds before the blank-tab fix in commit `66dd974` can accumulate `about:blank`/`about:newtab` pages during restore or close. Avoid repeatedly closing replacements; suspend saved work when finished and report the affected build. Do not delete all blank URLs: some are intentional or human-created.

On builds containing that fix, closing the final tab through the agent API retains one managed blank placeholder. Creating another tab removes only that placeholder; ordinary blanks are preserved. Use session suspension to stop the worker. The fix is integrated in the maintained source; confirm the deployed version before assuming that behavior. Running gateways and workers need a safe restart to load source changes.

## Surface boundaries

The 27 tools above are the MCP/OpenClaw surface. The supervised REST gateway also exposes tab operations such as wait, select, press, upload, viewport, back/forward/refresh, links/images, extraction, downloads, resource fetch and stats. These do **not** have corresponding MCP tools. Before using REST for a missing capability, consult the deployed `/openapi.json` or `/docs` and the checkout's `agent-openapi.json` for the exact method, arguments and authentication. Preserve ownership and human-control rules; do not call worker-private endpoints.

For captured downloads, `GET /tabs/TAB_ID/downloads?userId=OWNER` lists without deletion. Use `DELETE /tabs/TAB_ID/downloads?userId=OWNER` when deliberately clearing that tab's captured files and metadata; it returns `{ok:true,tabId:"TAB_ID"}`. Legacy `GET .../downloads?userId=OWNER&consume=true` also deletes and is blocked during human control. Listing/exporting does not require consumption. Download durability/retention is unchanged.

For example, after `camofox_click({"tabId":"TAB_ID","ref":"e5"})` reports `stale_refs` because an iframe changed, call `camofox_snapshot({"tabId":"TAB_ID"})` and choose a fresh ref. Do not reuse the same number for a similarly named main-page control. Snapshot annotations distinguish matching names in separate frames.

After a typing deadline, call `camofox_snapshot({"tabId":"TAB_ID"})`; if necessary use `camofox_evaluate({"tabId":"TAB_ID","expression":"document.querySelector('#message').value.length"})` on a known fixture field to inspect partial progress without echoing its contents. Decide whether replacement is appropriate before a new `camofox_type` call. The MCP default remains fill; REST keyboard mode retains its constant delay and now stops at the action deadline. The proposed 150-WPM default is not implemented by this fix.

The upstream singleton specification `openapi.json` includes additional endpoints that the supervised gateway does not expose, such as global browser stopping and destructive session deletion. Do not assume an upstream route is available here. Viewer transport endpoints are for the authenticated viewer client. Proton setup, migration and rollback are local operational commands, not agent tools; see `docs/agent-platform.md` in the source checkout.


Snapshots (including pagination) and screenshots follow the requested tab in the watch window. During human control they preserve the user's chosen tab. For example, use `camofox_snapshot({"tabId":"TAB_ID"})` to inspect that tab while the user watches; use `camofox_screenshot({"tabId":"TAB_ID"})` to show its current appearance.

A worker transport failure does not prove that a mutation was rolled back: inspect session status, then refresh the tab snapshot before deciding whether to repeat a click or submission. Large recoverable sessionStorage is supported during resume without putting checkpoint contents in the process environment. If LocateAnything fails before inference because MediaTools credentials cannot be loaded, have the operator repair the service configuration; temporary captures are removed and no click is performed.

For REST collection operations, `POST /tabs/open` accepts `sessionId` in its JSON body alongside `userId` and `url`; `DELETE /tabs/group/{listItemId}` accepts `sessionId` and `userId` in the query. Omitting `sessionId` uses the caller's default session. Example: `DELETE /tabs/group/research?userId=OWNER&sessionId=SESSION_ID` closes that group only, subject to ownership checks and the final-placeholder policy.


### Resume/suspend failures

If `camofox_session_resume({"sessionId":"SESSION_ID"})` fails during startup preparation, inspect `camofox_session_status({"sessionId":"SESSION_ID"})`: the active profile reservation is released and the session is suspended. Have the operator repair unreadable/malformed checkpoint or filesystem problems, then retry resume. Saved data is not automatically discarded.

If `camofox_session_suspend({"sessionId":"SESSION_ID"})` reports network cleanup failure after stopping the worker, status still reports `suspended` and old visual observations are invalid. The namespace cleanup error needs operator attention before retrying routed work; a suspended browser does not prove the network namespace was deleted. These recovery steps also apply when a route change stops the worker but cannot complete cleanup. Valid REST path casing or a trailing slash never relaxes argument validation.

A resume failure while saving the private worker recovery record terminates the newly spawned worker instead of leaving it unmanaged. Have the operator repair the filesystem problem, then check `camofox_session_status({"sessionId":"SESSION_ID"})` and retry `camofox_session_resume({"sessionId":"SESSION_ID"})`. Allow shutdown to finish before retrying; do not remove profile locks or recovery records to force access.

If the Proton provider is terminated by a signal, `camofox_vpn_status({})` returns `authenticated: false`, `setupRequired: true`, and `code: "proton_unavailable"`. This does not prove the saved login expired: ask the operator to check the provider, then retry this read-only status call before creating or routing a session. A terminated networking helper fails the operation instead of reporting successful cleanup. Gateway startup retains the recovery record and stops when old-tunnel cleanup fails. Have the operator repair the helper and restart; never delete recovery records to bypass cleanup. Reused PIDs are left alone while their recorded old namespace is cleaned up.

The updated networking helper checks command exit statuses and verifies that blocking leaves WireGuard down and deletion removes the namespace. A verified already-absent resource is an idempotent success; an inspection failure is an error. Source updates require installing the new root-owned helper, as well as restarting the gateway/workers.
