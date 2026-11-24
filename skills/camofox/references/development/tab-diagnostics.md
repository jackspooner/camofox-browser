# Tab diagnostics ownership and acceptance

The [shared descriptor](../../../../mcp/lib/diagnostics-contracts.mjs) defines the MCP and supervised REST shapes. `POST /tabs/{tabId}/diagnostics` uses the session owner's serial dispatch and active-worker, pause and human-control checks. Starting or stopping a window changes ephemeral instrumentation only. Polls skip activity renewal, checkpointing and operation-result retention.

The [worker collector](../../../../lib/platform/tab-diagnostics.js) attaches listeners on explicit start. It copies severity and bounded summaries into a per-tab queue. To avoid copying object previews, console strings pass a remote primitive type/length check followed by a local vocabulary check. At most eight summaries can be in flight across a worker. Overload or an early read leaves the summary null and retains event order. Each cursor binds a window identity and sequence. The viewer-mode handler clears all windows before human input, and the supervisor clears them before releasing ownership.

From a prepared worktree, run the following:

```bash
node --test tests/platform/tab-diagnostics.test.js tests/platform/contracts.test.js
node tests/platform/tab-diagnostics-live.mjs /path/to/installed/browser-cache
```

The browser fixture needs the supported Linux browser cache with a `camoufox/` subdirectory and the usual local viewer dependencies, including Xvfb and x11vnc. It creates a disposable gateway, owner, profile, worker and two pages on loopback. It exercises the adapter, HTTP validation, navigation, overflow, synthetic secrets, real viewer handoff, restored tabs and owner changes. It checks the disposable worker log and checkpoint for the private marker. The test suite also covers listener cleanup, deadline, active-window limits and late summaries.

[Agent procedure and observed sample](../usage/examples/tab-diagnostics.md)
