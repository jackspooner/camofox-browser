# Profiles, sessions and tab references

- A **profile** is a reusable login identity. It retains supported browser
  storage and can have one active session at a time.
- A **session** is a saved browser workspace with its own tab set, owner and
  routing choice. Tab creation, tab listing and cookie import use the indicated
  session, or the adapter's default session when you omit `sessionId`.
  Existing `tabId` values resolve to their owning sessions.
- A **tab ID** stays with a logical page across restoration. A **ref** such as
  `e4` comes from the current accessibility snapshot. Refresh refs after
  navigation, restoration or human control. Snapshot pagination follows
  `nextOffset` when `hasMore` is true. Inspect `refCoverage` separately for
  document limits and skipped frames. [Iframe refs and coverage](../frame-reads.md)
- A **visual observation** ties numbered LocateAnything boxes to one tab and
  a screenshot. It is short-lived and depends on unchanged viewport geometry
  and target pixels. A screenshot **capture ID** used for image analysis
  instead refers to retained pixels from the capture. [Visual targeting](capabilities/visual-targeting.md) · [Image analysis](capabilities/image-analysis.md)
- An **operation ID** tracks accepted work. When a call returns
  `pending: true`, poll `camofox_operation_status`. Check the retained
  result and the actual page state before deciding what to do after an
  interruption. [Pending work, retries and Stop](../operations.md)

## Continue saved work

Use `camofox_profile_list` to find the login identity. Start a new workspace
with `camofox_session_create` and the explicit `profileId`. To continue an
existing workspace, use `camofox_session_list` and `camofox_session_status`
to check its state and owner, then `camofox_session_resume`.

A `resumption` of `live` retains the existing pages. A `restored` session
reopens saved URLs and recoverable state. Take a fresh snapshot after
restoration. JavaScript memory and unsaved forms may be lost on suspension.
The idle timeout is 30 minutes, and watching or status polling does not extend
it. Use `camofox_session_release` for ownership handoff or
`camofox_session_suspend` to checkpoint and stop the worker. Check session
status if a lifecycle call fails. [Session tools and recovery](../tools.md#profiles-sessions-and-routing)

## Start a named session

Use these as separate MCP calls. For a new login identity, run the first call
and pass its returned `id` as `profileId`. Reuse the existing profile's `id`
when you already have the right identity. Use the new session's returned
`id` as `sessionId`, and then the created tab's `tabId` for the snapshot.

```text
camofox_profile_create({"name":"Research"})
camofox_session_create({"profileId":"PROFILE_ID","name":"Product research"})
camofox_create_tab({"sessionId":"SESSION_ID","url":"https://example.com/"})
camofox_snapshot({"tabId":"TAB_ID"})
```

Follow pending operations before using the values they return. Verify the
page image and demo content as in [the first tab walkthrough](getting-started.md).
To let someone watch, start the [desktop viewer](../tools.md#viewing-and-visual-targets)
with the same session ID.
