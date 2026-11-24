# Find the right Save button

Take a fresh `camofox_snapshot` of the owned tab. Pass its tab ID to
`camofox_search_snapshot`. This example requests buttons whose observed
accessible name or inline text contains “save”.

```json
{"tabId":"TAB_ID","query":"save","role":"button","limit":10}
```

On the local fixture the search returned three different refs. The first two
had `Billing` and `Shipping` form ancestors on the main page. The third
had `frame.main: false` and `frame.name: "editor"`. The Billing button's
accessible name was “Save” and its displayed text was “Commit invoice”.
Selecting the Shipping result's existing ref and clicking it changed the
fixture's status to “shipping saved”.

Both filters are case-insensitive. A role matches exactly. A query matches a
literal substring, including punctuation. Supply either filter to search it
alone. The default result limit is 20 and the maximum is 50. Each item gives
its role, name, inline text, up to two enclosing accessible nodes and frame
provenance. A null ref means that row supplies no action target.

`matched` counts hits in the scanned rows and `omittedMatches` counts hits
beyond the result limit. `clipped` marks returned strings shortened to 512
characters. A partial response can contain zero hits. Check `refCoverage` for
snapshot omissions, `changedFrames` for detached or navigated documents,
`skippedChars` for portions beyond the 65,536-character per-document scan,
and `skippedLines` for unrecognised rows. Frame indexes identify documents
within that observation. A specialized or missing accessibility observation
reports `not_inspected`.

Search reuses the current ref map and its observation. For same-document DOM
changes, navigation or restoration, take a fresh snapshot before choosing a
target. Searching never refreshes or renumbers the refs.
