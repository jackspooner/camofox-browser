# Working on Camofox

For a browser task, start with the [Camofox skill](skills/camofox/SKILL.md). For a source change, start with the [developer guide](skills/camofox/references/development/README.md). The supervised gateway runs through `npm run start:agent`. The upstream singleton runs through `npm start`.

## Linked worktree development

Run `npm run setup:worktree` in a fresh checkout. It restores the root and MCP lockfiles, skips browser downloads, checks native modules and contract freshness, and leaves services stopped. Use Linux with Node 24 (see `.nvmrc`), npm 11, Git and Python 3. Native build tools may be needed when prebuilds are unavailable. Use a supported browser cache, a separate port and disposable state for browser tests. See the [developer guide](skills/camofox/references/development/README.md) and [isolated acceptance procedures](tests/platform/README.md).

## Source and contract ownership

- Keep child-process environments explicitly scoped. Follow the [contributor conventions](CONTRIBUTING.md) and [upstream singleton and plugin development notes](docs/upstream-development.md).
- Update the shared tool descriptors for MCP and OpenClaw together. For singleton routes, maintain the route-adjacent `@openapi` blocks in `server.js`. Run `npm run generate-openapi` for contract changes and the freshness and parity checks in the [developer guide](skills/camofox/references/development/README.md).
- Keep usage guidance and examples alongside the repository-owned [skill](skills/camofox/). Point public entry pages at the maintained example when a tool's arguments, defaults, outputs or recovery change.

## Shared skill discovery

Use `skills show camofox` to identify the registered source. For a new installation, run `skills register "$PWD/skills" --provenance 'Camofox agent browser'` from the stable checkout. After integrating skill changes there, run `skills reconcile`, `skills doctor` and `skills show camofox`. Check a nested reference through the installed skill. The shared `shared-agent-skills` skill documents registration and refresh across clients.
