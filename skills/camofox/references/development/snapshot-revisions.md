# Snapshot history and acceptance

The snapshot handler in [server.js](../../../../server.js) obtains the canonical annotated text, structure and coverage through its usual collection path. Revision projection runs after publication of the existing snapshot plugin event. The [comparison module](../../../../lib/snapshot-revisions.js) keeps four independent text baselines per physical page. Each expires five minutes after creation. It holds only complete text windows up to 80,000 UTF-16 code units and a bounded coverage signature. The response preserves coverage, structure, pagination and the requested screenshot.

The comparison computes one splice from the common prefix and suffix in linear time. It compares against the exact supplied revision so another reader can use the tab concurrently. Frame navigation, attachment or detachment, page replacement and viewer control transitions invalidate history. Reads spanning invalidation return a reset without a reusable revision. Worker replacement starts with empty history. Revisions have no entry in the input or locator registries.

[Snapshot options](../../../../mcp/lib/snapshot-options.mjs) define the adapter fields and validate them for both transports. HTTP omits screenshots by default. The shared MCP/OpenClaw adapter requests one by default. Find the public calls and reconstruction rule in [Compare snapshot text](../usage/examples/compare-snapshot-text.md).

Run the following from a prepared worktree. The live fixture starts a temporary gateway, profile, local fixture server and stdio MCP adapter. Supply the directory containing the installed `camoufox/` browser cache.

```bash
node --test tests/platform/snapshot-revisions.test.js
node tests/platform/snapshot-revisions-live.mjs /absolute/path/to/cache
```

The fixture compares every reconstructed edit with a fresh ordinary snapshot through MCP. It also checks default and omitted images, tab/owner isolation, same-URL navigation, read access during handoff, worker restoration, rejection of a revision as a click ref, partial frame coverage and oversized pagination. The unit fixture exercises expiry, eviction, Unicode and invalidation during a read.
