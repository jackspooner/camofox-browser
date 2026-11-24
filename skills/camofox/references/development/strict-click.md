# Strict click implementation and verification

The opt-in accessibility collector reads Playwright AI-mode AX snapshots. It strips expanded child-frame subtrees before applying Camofox's frame selection and ref limits. The worker pairs a Camofox ref with the native node ref emitted on the same AX row, its frame object and navigation generation. Rows without a recognized native node key receive no strict click binding. Names, text and ordinals never supply a native ID.

The snapshot's ref map owns its five-minute, single-use observation. The worker checks the map, frame and document, resolves exactly one native node, and takes a short-lived element handle. A native trial and real click both use that handle. Replacement or obstruction cannot enter ordinary click recovery. An unconfirmed real click returns `click_outcome_unknown`. The supervisor retains its operation, retry key and human-control checks.

From a prepared repository checkout run the fixture with the parent cache directory containing `camoufox/browsers/official/`.

```sh
node tests/platform/strict-click-live.mjs /absolute/path/to/cache
```

The fixture creates its own loopback gateway, profile, session and local pages. It checks the clicked IDs, retained replay identity, same-URL frame navigation, tab scoping and control handoff. The [agent example](../usage/examples/strict-click.md) shows the two public calls.
