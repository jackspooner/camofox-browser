# Select a shipping option and apply it

On the disposable Shipping form, take a snapshot and use its current Shipping combobox ref. For a native select, pass one string. Labels take precedence over HTML values, with the first matching option in document order. A unique selector also works. A custom menu needs its own click or keyboard interaction.

```text
camofox_select({"tabId":"TAB_ID","ref":"e3","option":"Express"})
camofox_select({"tabId":"TAB_ID","selector":"#shipping","option":"eco"})
```

The first call chooses the first Express label, even though a different option has the HTML value `Express`. The second chooses Economy by its value. Read the page's confirmation. If a ref is stale or the form changed, take a new snapshot and identify the intended control again. Refs with duplicate control names depend on their document order.

Keyboard input acts on the tab's current focus. Selecting an option does not establish keyboard focus. The fixture places the Apply button immediately after the Start field in tab order.

```text
camofox_click({"tabId":"TAB_ID","selector":"#start"})
camofox_press({"tabId":"TAB_ID","key":"Tab"})
camofox_read({"tabId":"TAB_ID","selector":"#state"})
```

The fixture reports `"focus":"apply"`. With that focus confirmed, send the activation key once.

```text
camofox_press({"tabId":"TAB_ID","key":"Enter"})
camofox_read({"tabId":"TAB_ID","selector":"#state"})
```

The Apply count increases by one. `Shift+Tab` moves focus backward. Both mutations support `idempotencyKey` and may return `pending:true`. Follow the returned operation ID and inspect the form before repeating input. [Operation recovery](../../operations.md)
