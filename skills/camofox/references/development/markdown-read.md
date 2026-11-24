# Bounded Markdown reader

The [descriptor](../../../../mcp/lib/markdown-contracts.mjs) reuses the flat reader’s frame schema, selectors and character ceiling. The supervised gateway maps the read-only POST through the session owner to the [worker route](../../../../lib/platform/worker-routes.js). The worker holds the tab lock while the [bounded reader](../../../../lib/bounded-read.js) resolves the frame, observes its generation, runs the converter and checks the same identity again. Its five-second deadline covers frame selection and evaluation.

The [converter](../../../../lib/markdown-read.js) traverses the selected light DOM in document order. It prunes excluded ancestors and subtrees before reading text. It emits ATX headings, paragraphs, lists, absolute HTTP(S) links, simple pipe tables with the first row as header, and indented preformatted text. Links with credentials or unsupported schemes retain only the label. It reads neither control values nor resource bytes. Shadow roots, embedded frames and CSS-generated content are outside traversal. Page navigation may itself load resources before a read.

The renderer caps traversal at 10,000 nodes, depth at 64, text examined at 256,000 UTF-16 units and link destinations at 2,048 units. Nested tables and each reached limit produce a distinct omission reason. Policy exclusions are silent. Conversion is intended for ordinary prose and simple tables. Complex spans and layout styling are outside the format.

After worktree setup, run the fixture with a compatible browser cache containing `camoufox/browsers/official`. It starts loopback fixture origins, a disposable supervisor and a real native-profile worker. It compares REST and adapter output and checks private content, cutoffs, resource requests and ownership.

```bash
env -i HOME="$HOME" PATH="$PATH" LANG=C.UTF-8 node tests/platform/markdown-read-live.mjs /absolute/path/to/cache
node --test tests/platform/iframe-coverage.test.js tests/platform/markdown-read.test.js tests/platform/contracts.test.js
```

[Agent procedure and worked example](../usage/examples/read-markdown.md)
