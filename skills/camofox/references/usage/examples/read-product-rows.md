# Read product cards or table rows

Call `camofox_read` on an owned tab with a known row selector. In this fixture
the main page contains a table and the embedded catalogue contains four cards.
Each field reads the first matching descendant of its row. Use `:scope >`
when a field must be a direct child.

```json
{
  "tabId": "<tabId>",
  "frameSelector": "#grid",
  "selector": ".card",
  "projection": {
    "fields": [
      { "name": "name", "selector": ".label", "read": "text", "type": "string" },
      { "name": "price", "selector": ".price", "read": "text", "type": "number" },
      { "name": "inStock", "selector": ".label", "read": "title", "type": "boolean" }
    ]
  }
}
```

The first row contains `name.value` **Thé 🫖**, `price.value` **12.5** and
`inStock.value` **true**, each with `status: "ok"`. The second card has no
price element, so its `price` is `{"status":"missing_element","value":null}`.
The third contains `12,50` and reports `invalid_conversion`. The fourth
exceeds the per-string limit and reports `string_limit`. To read the same
fields from the fixture's main table, omit `frameSelector` and set
`selector` to `tbody tr`.

**Selecting fields.** Supply 1–16 fields with distinct names of up to 32 ASCII
letters, digits or underscores, starting with a letter. Choose `text`, `alt`,
`title` or `ariaLabel` (the `aria-label` attribute). DOM text preserves
whitespace and can include hidden text. Form controls, editable regions,
scripts, styles and templates are excluded. No model or resource fetch is
involved. The echoed `selector` and `fields` identify the sources, `frame`
identifies the document, and the zero-based array position identifies the
matched row in document order for this read.

**Converting values.** Strings preserve the source. Numeric and boolean
conversion trims surrounding whitespace. Numbers accept finite signed or
unsigned ASCII decimals, including `.5`. Currency symbols, grouping, decimal
commas and exponents yield `invalid_conversion`. Booleans accept the exact
literals `true` and `false`. A missing attribute reports `missing_attribute`
and a directly selected excluded element reports `excluded`. Inspect each
cell's status before consuming a null.

**Checking coverage.** Compare `returned`, `matched` and `omittedRows`.
`limit` defaults to 20 rows (maximum 100). `projection.maxBytes` defaults to
16,000 (range 2–64,000) and counts the UTF-8 JSON bytes of the `rows` array,
including names, statuses, values and punctuation. `rowBytes` reports that
count. The reader returns whole rows from the start. `stopReason` identifies
`row_limit` or `byte_limit` when rows were dropped.

The source budget `maxChars` defaults to 16,000 UTF-16 code units (range
1–64,000), with a 2,048-unit cap per value. Fields consume this budget in
declaration order within each row. Values that exceed it return null with
`character_budget` or `string_limit` to prevent conversion of partial input.
`truncated` covers both field and row limits. Narrow the row selector or
field list for a more selective read. See [frame read recovery](../../frame-reads.md#recovery-and-limits)
for invalid selectors, frame changes and timeouts.
