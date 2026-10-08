# Architecture

The v2 design has one authoritative core and thin host adapters.

```text
Claude adapter ─┐
                ├─ CLI / MCP ─ ExperimentEngine ─ SQLite
Codex adapter ──┘
```

`packages/core` owns project identity, state transitions, history, storage paths, transactions, and migrations. `packages/cli` is the human and script entry point. `packages/mcp-server` maps validated tool names to the same engine; it has no independent state.

The runtime requires Node 22.5 or newer because it uses the built-in `node:sqlite` module. No npm runtime package is required. Database overrides are `MODS_DATABASE_PATH` and `MODS_STATE_DIR`.

Host adapters must pass `host: "claude"` or `host: "codex"`, never choose or modify an AI model, and never copy the database. Codex uses MCP plus the terminal status command because the official status-line API does not document arbitrary custom fields.

Project identity prefers a normalized Git origin URL, so worktrees, branch changes, and directory renames share an ID. Git repositories without an origin use the Git common directory. Non-Git projects use a canonical absolute path and therefore require an explicit future identity transfer when renamed.
