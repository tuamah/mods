# project-status / cross-host v2

A shared project and experiment tracker for Claude Code and OpenAI Codex CLI. Claude retains its two-row `AbovePrompt` band; Codex uses the documented MCP interface and the standalone `mods status` command. Both hosts use one SQLite database.

The Claude band shows:

- project and git branch
- overall progress (bar + percent)
- current experiment and its status: أولية (initial) · تصحيح لفشل سابق (fix of a failure) · تطوير لتجربة ناجحة (development of a success), with result running / success / fail
- session time, 5-hour and weekly usage with reset countdowns

## Install

Requires Node.js 22.16 or newer. npm is not required.

Preview every change first:

```text
node packages/cli/bin/mods.mjs install --host codex --project .
node packages/cli/bin/mods.mjs install --host claude --project .
```

Apply an explicit host installation:

```text
node packages/cli/bin/mods.mjs install --host codex --project . --apply
node packages/cli/bin/mods.mjs install --host claude --project . --apply
```

`--host auto` fails closed unless the invoking wrapper explicitly sets `MODS_ACTIVE_HOST=claude` or `MODS_ACTIVE_HOST=codex`. Binary presence is never used to guess the active host.

### Claude Code

At the prompt of a terminal Claude Code session:

```
/plugin install project-status --marketplace tuamah/mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

The existing `/pstatus`, `AbovePrompt`, and `mcp__project-status__set_status` contracts are preserved. The adapter invokes the shared CLI through Claude's supported process API because hook modules cannot directly import Node built-ins.

### Codex CLI

The installer creates a repository skill under `.agents/skills/project-status` and a managed project-scoped MCP block under `.codex/config.toml`. It does not edit the selected model or global user configuration. Codex does not expose a documented arbitrary custom status component, so use:

```text
node packages/cli/bin/mods.mjs status
```

Do not add a fabricated `tui.status_line` identifier.

## Use

| Command | Effect |
|---|---|
| `/pstatus progress 40` | set progress |
| `/pstatus exp T5 develop success` | set experiment: name, `initial`/`fix`/`develop`, `running`/`success`/`fail` |
| `/pstatus result fail` | change the current experiment's result |
| `/pstatus clear` | clear progress and experiment |
| `/pstatus hide` / `/pstatus show` | hide or show the band |
| `/pstatus` | print a summary |

Claude can also update the band itself through the `mcp__project-status__set_status` tool. Progress and experiment are saved per project and branch.

## Develop

```
claude plugin validate .
claude plugin test .
node --test tests-v2/*.test.mjs
```

## CLI reference

```text
mods doctor
mods status [--format text|json]
mods progress 55 --host claude|codex
mods experiment create "Battery Aging" --type initial
mods experiment start <id>
mods experiment update <id> --description "..."
mods experiment finish <id> --result success|fail|inconclusive
mods experiment cancel <id>
mods experiment resume <id>
mods experiment show <id>
mods experiment compare <left-id> <right-id>
mods history --project current --limit 20 --format json|csv
mods export --format json|csv
mods install --host auto|claude|codex
mods uninstall --host claude|codex
```

## Shared database

Defaults follow platform conventions: `%LOCALAPPDATA%\\tuamah-mods` on Windows, `$XDG_STATE_HOME/tuamah-mods` (or `~/.local/state`) on Linux, and `~/Library/Application Support/tuamah-mods` on macOS. Override with `MODS_STATE_DIR` or `MODS_DATABASE_PATH`. Uninstall never deletes the database.

The engine uses WAL, foreign keys, transactions, busy timeouts, schema versioning, pre-migration backups, idempotency keys, and append-only experiment events. Do not store secrets, credentials, or conversation transcripts in metadata.

## MCP reference

The shared stdio server exposes status, progress, create/start/update/finish/cancel/resume, current experiment, list, history, inspect, and export tools. Start it with:

```text
node packages/cli/bin/mods.mjs mcp
```

See `docs/EXPERIMENT_SCHEMA.md`, `docs/MIGRATION.md`, `docs/SECURITY.md`, and `docs/COMPATIBILITY_MATRIX.md` for lifecycle, upgrade, security, and verified-host details.

## Uninstall

Preview, then apply:

```text
node packages/cli/bin/mods.mjs uninstall --host codex --project .
node packages/cli/bin/mods.mjs uninstall --host codex --project . --apply
```

Only integration-owned files and managed config blocks are removed. Backups and the shared database are preserved.
