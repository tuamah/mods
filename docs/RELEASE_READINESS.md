# MODS cross-host v2 release readiness

Date: 2026-10-09. Workspace: `D:\Projects\mods`. Branch: `feature/cross-host-project-status-v2`. Recoverable shared-core checkpoint: `1de76dfa6857e17d7455bdd3f3b29013d8044677`.

## Implementation boundary

One Node 22.16+ engine owns project identity, SQLite state, lifecycle rules, idempotency, history, migration, comparison, and progress. Claude invokes the shared CLI through its documented process API and preserves `/pstatus`, `set_status`, and `AbovePrompt`. Codex uses documented stdio MCP, repository skill instructions, and the standalone status command. Neither adapter maintains authoritative local experiment state.

The Claude bridge resolves the shared CLI relative to the actual Hook module and does not depend on `CLAUDE_PLUGIN_ROOT`, shell interpolation, hardcoded installation paths, or the process working directory. The Codex installer places explicitly configured MODS storage values in the managed MCP environment, because the live CLI does not automatically propagate `MODS_DATABASE_PATH` to an MCP child.

## Acceptance evidence

| Gate | Evidence | Result |
|---|---|---|
| Node/shared/installer/security | `node --test tests-v2/*.test.mjs` with external writable Temp | PASS: 24/24 |
| Claude regressions | `claude plugin test .` | PASS: 4/4 |
| Claude manifest and hooks | `claude plugin validate .` | PASS |
| Patch hygiene | `git diff --check` | PASS; LF/CRLF notices only |
| Shared database | `node packages/cli/bin/mods.mjs doctor` against the smoke DB | PASS: integrity `ok`, schema 1 |
| Live Claude | `claude --plugin-dir D:\Projects\mods` | PASS: `AbovePrompt`, `/pstatus`, durable create/start |
| Live Codex | `codex --no-daemon -C C:\Users\sww\AppData\Local\Temp\mods-v2-windows-smoke` | PASS: MCP connected with 13 tools; read/update/finish/history |
| Cross-host state | Same SQLite record and event stream | PASS |
| Isolated uninstall | Codex uninstall in temporary consumer project | PASS: MODS-owned files removed; database preserved |

The shared live experiment was `exp_3024fea6-bdae-4f82-8540-4dc7da74feeb`. Claude created and started it; Codex updated and completed it. Its final state is `completed/success`, its description is `updated by live Codex smoke`, and SQLite contains exactly four events: `create`, `running`, `update`, and `completed`. A subsequent Claude session displayed that final success in `AbovePrompt` and `/pstatus`.

## Safety and repository scope

Installer mutation tests used isolated temporary consumer projects. Preview remains the default; `--apply` is required. Installation is atomic and idempotent, rollback is tested, auto detection fails closed when ambiguous, and uninstall removes only matching MODS-owned content while preserving SQLite. The live consumer config was removed after the smoke test. No global Git configuration was changed, and no push, merge, publication, tag, or release occurred.

The current source diff is limited to MODS manifests, documentation, the existing Claude Hook and tests, and the new shared core/CLI/MCP/adapters/integration/tests. The acceptance runs did not add production-workspace source changes. Codex CLI trust/session state is host-managed and is not modified by the MODS installer.

## Remaining issues

- **Medium:** Linux behavior is unverified on a real Linux host.
- **Medium:** macOS behavior is unverified on a real macOS host.
- **Low:** Codex CLI 0.162.0-alpha.2 is an alpha build; version-sensitive configuration remains isolated behind the Codex adapter.
- **Low:** Installed Codex configuration references the absolute runtime checkout. Moving `D:\Projects\mods` requires reinstalling; a public package should use a stable versioned runtime location.
- **Low:** Corrupt-database recovery beyond integrity detection is not covered by a destructive recovery exercise.

There are no known unresolved critical or high-severity findings on the tested Windows path.

## Decisions

**Windows internal release candidate: PASS**, subject to independent final review of this exact diff and report. All post-fix automated gates and the real Claude-to-Codex-to-Claude workflow pass.

**Cross-platform public release: PARTIAL / NOT APPROVED.** Linux and macOS remain unverified, so the Windows result must not be represented as a cross-platform production pass.

## Cross-platform defect patch status

The uncommitted defect patch raises the minimum runtime to Node 22.16, adds bounded WAL/schema initialization, replaces raw pre-migration file copies with verified SQLite Online Backup snapshots, and corrects cross-platform bridge path expectations. On Windows/Node 24.19.0 it passes 34/34 Node tests, 35/35 repeated concurrency tests, Claude regression 4/4, and plugin validation. The earlier Windows RC evidence remains historical; the patched candidate is not approved for release until independent review and all six hosted CI jobs pass. Linux/macOS interactive qualification remains pending regardless of automated CI outcome.
