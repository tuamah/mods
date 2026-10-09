# Test report

Date: 2026-10-09. Workspace: `D:\Projects\mods`. Tested platform: Windows 11 (`win32`).

## Post-fix automated acceptance

| Command | Result |
|---|---|
| `$env:TEMP='C:\Users\sww\Documents\Codex\2026-10-08\x20\work\mods-acceptance-temp'; $env:TMP=$env:TEMP; node --test tests-v2/*.test.mjs` | PASS: 24, FAIL: 0 |
| `claude plugin test .` | PASS: 4, FAIL: 0 |
| `claude plugin validate .` | PASS: validation completed, no errors |
| `git diff --check` | PASS; only Git LF-to-CRLF notices were emitted |
| `$env:MODS_DATABASE_PATH='C:\Users\sww\AppData\Local\Temp\mods-v2-windows-smoke\shared.sqlite3'; node packages/cli/bin/mods.mjs doctor` | PASS: SQLite integrity `ok`, schema version 1 |

The first sandboxed Node run produced 22 passes and two `EPERM` failures while renaming files under the sandbox-projected Temp directory. A second run with Temp inside the repository produced 23 passes and one expected project-identity mismatch because that Temp directory was inside the repository. The final run used a writable Temp directory outside the repository and passed 24/24. These two preliminary runs are environment-blocked evidence, not passes.

## Real interactive cross-host acceptance

Claude Code 2.1.295 was launched with:

```powershell
$env:MODS_DATABASE_PATH = Join-Path $env:TEMP 'mods-v2-windows-smoke\shared.sqlite3'
claude --plugin-dir 'D:\Projects\mods'
```

`AbovePrompt` rendered, `/pstatus exp ClaudeLive initial running` created and started a durable experiment, and `/pstatus` later displayed the Codex-completed result. The record was read independently from SQLite, so the result was not merely Hook-local state.

Codex CLI 0.162.0-alpha.2 was launched in an isolated consumer project with `codex --no-daemon -C 'C:\Users\sww\AppData\Local\Temp\mods-v2-windows-smoke'`. `/mcp` reported `project-status: connected (13 tools)`. Codex read the Claude-created experiment, updated it, completed it successfully, and read its history through MCP.

Shared evidence:

- Experiment ID: `exp_3024fea6-bdae-4f82-8540-4dc7da74feeb`.
- Final state: `completed`; result: `success`.
- Description: `updated by live Codex smoke`.
- Creator: `claude`; last updater: `codex`.
- Persisted history: four events — Claude `create`, Claude `running`, Codex `update`, Codex `completed`.
- Claude subsequently displayed `ClaudeLive` as successful through both `AbovePrompt` and `/pstatus`.

The Codex integration was uninstalled from the isolated consumer project. Its MODS-owned skill and managed config block were removed, while `shared.sqlite3` remained readable with the same completed experiment and four events.

## Confirmed defects and repairs

1. Claude Hook subprocesses could not import the shared CLI through `CLAUDE_PLUGIN_ROOT`, producing `ERR_MODULE_NOT_FOUND`. The Hook now derives a module URL relative to its actual module location, verifies the target in the child process, and calls Node with a fixed program and separately supplied arguments. It does not use shell interpolation, a hardcoded installation path, the current working directory, or inherited `CLAUDE_PLUGIN_ROOT`. Regression tests cover successful resolution with that variable absent and missing-entry failure before invocation.
2. Codex's MCP child did not inherit the parent session's `MODS_DATABASE_PATH`. The installer now records explicitly configured `MODS_DATABASE_PATH` and `MODS_STATE_DIR` values in the managed MCP environment table. The installer regression test covers the generated environment, idempotency, rollback, and removal.

## Scope and limitations

All listed runtime, plugin, installer, concurrency, security, and interactive tests were executed on Windows. Linux and macOS remain **UNVERIFIED**. Codex arbitrary custom TUI rendering remains intentionally unsupported; MCP, repository skill instructions, and the standalone status command are the supported integration. No push, merge, publish, tag, or release was performed.
