# Accessibility search implementation and verification

[The collector](../../../../lib/accessibility-snapshot.js) records the character
range and frame generation of each included document alongside the existing
ref map and annotated YAML. The [reader](../../../../lib/search-snapshot.js)
checks the frame identity, reads complete lines from each bounded range, and
verifies annotated refs against the map's role, decoded name, ordinal and
document. The per-document scan cap reserves space for child frames even
when the main document is large. Snapshot replacement, worker restoration
and handoff invalidation use the existing ref-map lifecycle.

The [descriptor](../../../../mcp/lib/accessibility-search.mjs) owns the input
and output shapes. The supervised gateway classifies
`POST /tabs/{tabId}/search-snapshot` as a read. The worker searches the
observation synchronously without focusing the tab, inserting a locator or
recollecting the tree. See the [caller example](../usage/examples/search-snapshot.md).

Run from a prepared checkout with an installed compatible Camoufox cache.
The live test starts a disposable supervisor, two local fixture origins and
the MCP request adapter, then closes its worker and removes its profile.

```sh
node --test tests/platform/search-snapshot.test.js tests/platform/iframe-coverage.test.js tests/platform/contracts.test.js
node tests/platform/search-snapshot-live.mjs /absolute/path/to/cache
```

The cache root contains `camoufox/browsers/official/`. The fixture checks
duplicate names, different accessible and visible labels, context, literal
matching and counts, ref preservation, owner isolation, human control and
stale-frame suppression.
