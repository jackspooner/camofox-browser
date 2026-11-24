# Open your first Camofox tab

You need a running Camofox supervised gateway and a connected `camofox` MCP
adapter. Confirm the connection offers `camofox_create_tab`,
`camofox_snapshot` and `camofox_operation_status`. If the host still shows
only the original 11 tools, reconnect the adapter. In Hermes, use
`/reload-mcp`.

This example opens a public demo page in the adapter's default session. When
working in a named session, pass its active `sessionId` to the create call.

```text
camofox_create_tab({"url":"https://example.com/"})
```

Use the returned `tabId`. If the call returns `pending: true`, wait for
`camofox_operation_status({"operationId":"OPERATION_ID"})` to report the
settled outcome and read the `tabId` from its retained `result`.

```text
camofox_snapshot({"tabId":"TAB_ID"})
```

Expect an accessibility snapshot and a screenshot of the demo page. Look
for its explanation about documentation examples and the **Learn more**
link. The wording may change, so also check the tab's URL and visible
content. If the snapshot shows a network error or another page, report
what you see before proceeding.

Use fresh element refs to [click or type](../tools.md#browser-tools), or
[locate a control by its appearance](capabilities/visual-targeting.md). Read
[profiles and sessions](concepts.md) before using a saved login.
