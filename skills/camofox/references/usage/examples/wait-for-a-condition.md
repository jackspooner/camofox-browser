# Wait for a page condition

Pass the current tab ID to `camofox_wait`. On a page that shows a save confirmation, this call waits up to three seconds for the literal message.

```json
{"tabId":"<tabId>","text":"Saved [1].*","timeout":3000}
```

An observed condition returns `{"ok":true,"ready":true}`. Text matches a case-sensitive substring of the main document's rendered text. Punctuation and spaces are literal. The text limit is 512 characters.

To wait for every loading indicator to disappear or become hidden, use a CSS selector. A selector may contain up to 2,048 characters.

```json
{"tabId":"<tabId>","selector":".loading","state":"hidden","timeout":3000}
```

`state` defaults to `visible`. One visible match satisfies a visible selector wait. A visible match has CSS visibility and a nonempty bounding box, which can be outside the viewport. A hidden condition succeeds immediately if the match is already absent. Both conditions inspect only the main document and can run during human control.

The condition timeout defaults to 10,000 ms and accepts integers from 1 to 30,000. `read_timeout` means the deadline expired without a confirmed result. Inspect the page before choosing a new condition. On `target_changed`, take a fresh observation of the current document. Correct malformed CSS on `invalid_selector`.

With only a tab ID, the call uses historical page readiness. Read the `ready` boolean. Only that mode accepts `waitForNetwork` (default true) or `dismissConsent` (default false). Explicitly enabling the latter can click a consent control.
