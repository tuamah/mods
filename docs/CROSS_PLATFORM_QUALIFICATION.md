# Cross-platform automated qualification

Phase 1 adds CI and isolated tests only. Production runtime, installer behavior, and SQLite recovery behavior are unchanged. Windows Internal RC remains the reference baseline.

## CI matrix

The local workflow `.github/workflows/cross-platform-qualification.yml` defines six jobs: Windows, Ubuntu, and macOS, each on exact Node 22.5.1 and Node 24.x. Runtime verification fails with a `BLOCKED` message if setup does not provide the requested minimum version; it does not silently substitute a newer runtime.

Each job has read-only repository permissions, a 20-minute timeout, fail-fast disabled, concurrency cancellation for superseded runs, the complete Node test suite, `git diff --check`, and a final clean-checkout assertion. Every test creates its project and database below the runner's isolated temporary directory rather than inside the checkout.

| Runner | Node 22.5.1 | Node 24.x | Interactive hosts |
|---|---|---|---|
| Windows | Hosted run required; local runtime unavailable | Local 24.19.0 PASS | Previously PASS locally; not part of CI |
| Ubuntu | Hosted run required | Hosted run required | Separate real-host validation required |
| macOS | Hosted run required | Hosted run required | Separate real-host validation required |

## Added automatic coverage

- Unicode and whitespace-containing project/database paths.
- `PRAGMA integrity_check` and `PRAGMA foreign_key_check`.
- Final event state versus the authoritative experiment record.
- Unique idempotency keys and expected history order.
- Git identity across a repository and linked worktree using repository-local test identity only.
- WAL checkpoint and closed connections before byte-for-byte database comparison across install/uninstall.
- Non-destructive corruption of a disposable copy, detection, and validation of a separately restored copy.

The corruption harness is test-only. It does not expose or implement a production recovery command and never corrupts the source database or its verified backup.

## Evidence boundary

Only Windows tests run locally count as executed in this phase. Ubuntu and macOS remain `NOT RUN` until the reviewed workflow is pushed and hosted runners execute it. CI adapter tests do not prove Claude `AbovePrompt`, `/pstatus`, Codex `/mcp`, or interactive tool approval behavior. Real interactive Claude and Codex validation remains required separately on Ubuntu and macOS.

The proposed versioned runtime installer and migration from absolute checkout paths remain deferred and require separate approval.

## Local Windows execution

Executed on 2026-10-09 with Node 24.19.0 and an external writable temporary directory:

```powershell
$env:TEMP='C:\Users\sww\Documents\Codex\2026-10-08\x20\work\mods-cross-platform-full'
$env:TMP=$env:TEMP
node --test tests-v2/*.test.mjs
```

Result: **28 passed, 0 failed**. The four newly added tests also passed independently before the full run. `claude plugin test .` passed **4/4**, and `claude plugin validate .` passed. `git diff --check` passed with existing LF/CRLF notices. Python/PyYAML parsed the workflow and a structural assertion confirmed read-only permissions, the six matrix jobs, `fail-fast: false`, and the 20-minute timeout. GitHub-specific execution has not occurred.

Only Node 24.19.0 is installed on the current Windows machine. Local Node 22.5.1 execution is therefore **BLOCKED**, not passed or substituted. The workflow requests exactly 22.5.1 and verifies the returned runtime before testing.

## Changes requiring separate approval

- Pushing the workflow and triggering GitHub-hosted Windows, Ubuntu, and macOS jobs.
- Any fix for a defect found only by those hosted jobs.
- Real interactive Claude Code and Codex CLI validation on Ubuntu and macOS.
- A versioned/stable Codex runtime installer and migration from the current installer.
- Any production SQLite recovery command or automatic recovery policy.
