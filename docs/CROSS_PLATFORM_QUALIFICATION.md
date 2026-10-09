# Cross-platform automated qualification

Phase 1 added CI and isolated tests without production changes. The subsequent defect patch raises the Node minimum to 22.16 and makes SQLite initialization and pre-migration backup concurrency-safe. Installer behavior, experiment lifecycle, event history, and idempotency semantics remain unchanged.

## CI matrix

The local workflow `.github/workflows/cross-platform-qualification.yml` defines six jobs: Windows, Ubuntu, and macOS, each on exact Node 22.16.0 and Node 24.x. Runtime verification fails with a `BLOCKED` message if setup does not provide the requested minimum version; it does not silently substitute a newer runtime.

Each job has read-only repository permissions, a 20-minute timeout, fail-fast disabled, concurrency cancellation for superseded runs, the complete Node test suite, `git diff --check`, and a final clean-checkout assertion. Every test creates its project and database below the runner's isolated temporary directory rather than inside the checkout.

| Runner | Node 22.16.0 | Node 24.x | Interactive hosts |
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

Only Node 24.19.0 is installed on the current Windows machine. Local Node 22.16.0 execution is therefore **BLOCKED**, not passed or substituted. The workflow requests exactly 22.16.0 and verifies the returned runtime before testing.

## Changes requiring separate approval

- Pushing the workflow and triggering GitHub-hosted Windows, Ubuntu, and macOS jobs.
- Any fix for a defect found only by those hosted jobs.
- Real interactive Claude Code and Codex CLI validation on Ubuntu and macOS.
- A versioned/stable Codex runtime installer and migration from the current installer.
- Any production SQLite recovery command or automatic recovery policy.

## Pre-fix hosted CI evidence

Draft PR: `https://github.com/tuamah/mods/pull/1`.

The first hosted run, `https://github.com/tuamah/mods/actions/runs/37896693639`, failed before tests in all six jobs because `actions/setup-node` interpreted `cache: false` as an unsupported cache manager. This is classified **TEST DEFECT**. Removing that single workflow input produced commit `46b29a97be8685741278c1768231f8476f1c2bfd`; no production code changed.

The corrected run is `https://github.com/tuamah/mods/actions/runs/37896862224`:

| Hosted job | Result | Classification |
|---|---|---|
| Ubuntu / Node 24.21.0 | PASS: 28/28 | Automated qualification passed |
| macOS / Node 24.20.0 | FAIL: 27/28 | TEST DEFECT: `/var` resolves to `/private/var`, but the bridge test compared non-canonical path spelling |
| Windows / Node 24.21.0 | FAIL: 26/28 | TEST DEFECT: Windows short-path spelling in the same bridge assertion; PRODUCT DEFECT: concurrent startup can fail while setting WAL with `database is locked` |
| Ubuntu / Node 22.5.1 | FAIL before test bodies | PRODUCT DEFECT: advertised minimum cannot import `node:sqlite` in ordinary execution (`ERR_UNKNOWN_BUILTIN_MODULE`) |
| macOS / Node 22.5.1 | FAIL before test bodies | Same Node 22.5.1 product/runtime contract defect |
| Windows / Node 22.5.1 | FAIL before test bodies | Same Node 22.5.1 product/runtime contract defect |

The earlier Windows 24.19.0 interactive acceptance remains valid historical evidence for that exact environment, but the Windows 24.21.0 concurrency failure invalidates general Windows RC readiness across the advertised runtime range. A new Windows RC is blocked until WAL initialization is retry-safe and the hosted Windows matrix is green.

The declared Node `>=22.5.0` compatibility is also blocked. Node 22.5.1 requires an experimental flag for `node:sqlite`, while the current implementation additionally uses SQLite `backup` and the `DatabaseSync` `timeout` option introduced later. The independently reviewed recommendation is to establish and test Node `>=22.16.0`, unless those dependencies are deliberately removed in a separately approved production change.

Cross-platform public qualification remains blocked. Interactive Claude/Codex validation on Ubuntu and macOS is still unexecuted.

## Current defect-patch evidence

On Windows with Node 24.19.0, the final patch passed the focused WAL migration and failure-injection tests 2/2, the complete Node suite 34/34, and the seven-test concurrency suite 35/35 across five consecutive runs. Claude regression passed 4/4 and plugin validation passed. Node 22.16.0 and non-Windows execution remain pending the hosted matrix; these local results do not establish cross-platform interactive qualification.

Before schema mutation, one initializer holds the bounded SQLite initialization transaction while a separate Node worker uses the SQLite Online Backup API to create a consistent temporary snapshot. The worker consolidates only the temporary snapshot's WAL, never the active source WAL. MODS verifies integrity and the pre-migration schema version, atomically publishes the backup file without overwrite, and then separately publishes its SHA-256 verification marker. It does not replace or trust an unmarked snapshot; a crash between publications therefore fails closed and may require manual inspection and removal of the unmarked artifact. A failed backup aborts migration and removes only its incomplete temporary artifacts. This guarantee applies to cooperating MODS initializers; it is not a general recovery subsystem.
