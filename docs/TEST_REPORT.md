# Test report

## Real local checks

- Windows host only.
- Claude Code 2.1.295: plugin validation passed with warnings; existing plugin harness tests passed 4/4 outside filesystem sandboxing.
- Codex CLI 0.162.0-alpha.2: executable and MCP command surface inspected; no interactive integration test performed.
- Node 24.19.0: built-in SQLite available.

## Automated core checks

Run `node --test tests-v2/*.test.mjs`.

Coverage includes lifecycle validation, status/result separation, append-only history, rollback on invalid transition, idempotency and conflict detection, progress sharing between host labels, filters, integrity checks, legacy import repeatability, comparison, platform path rules, MCP cross-host state, and rejection of unknown MCP tools.

Linux, macOS, interactive Claude rendering, actual Codex MCP registration, simultaneous multi-process writes, installer rollback, and corrupt-database recovery remain release-blocking test gaps. They must not be described as tested.
