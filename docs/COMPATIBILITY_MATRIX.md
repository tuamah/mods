# Cross-host compatibility matrix

Verified on 2026-10-08.

- `VERIFIED-DOCS`: an official vendor document describes the interface.
- `VERIFIED-LOCAL`: the installed executable exposed or exercised the interface.
- `ENVIRONMENT-BLOCKED`: the check was prevented by the sandbox or checkout projection and was repeated outside that constraint.
- `UNVERIFIED`: no claim of working support is made.
- `UNSUPPORTED`: available official documentation does not expose the requested capability; no integration may depend on it.

## Audit baseline

- Repository: `tuamah/mods`, commit `5be8b9e` on `main`; working branch `feature/cross-host-project-status-v2`.
- History: two commits (`46b9f63`, initial project-status mod; `5be8b9e`, `/status` renamed to `/pstatus`).
- Existing public command: `/pstatus`, with `progress`, `exp`, `result`, `clear`, `hide`, and `show` forms.
- Existing public tool: `mcp__project-status__set_status` (registered by the Claude plugin runtime).
- Existing UI surface: Claude plugin `ui.render` for `AbovePrompt`.
- Existing persistence: Claude plugin store key `tracked:<project-basename>:<branch>`. It stores progress and one experiment, has no stable project or experiment ID, and has no history.
- Existing project identity: final path/remote segment plus branch. This is not stable enough for cross-host identity.
- Existing tests: four Claude plugin tests for labels, duration/bar formatting, `/pstatus`, and hide behavior.
- No package manifest, lockfile, standalone CLI, MCP server, database, migration, installer, or CI configuration existed at audit time.

## Installed toolchain

| Tool | Observed version | Verification | Notes |
|---|---:|---|---|
| Claude Code | 2.1.295 | VERIFIED-LOCAL | `claude.exe --version`; this is the tested baseline. Older versions are unsupported unless separately verified. |
| Codex CLI | 0.162.0-alpha.2 | VERIFIED-LOCAL | `codex.exe --version`; this alpha build is the tested baseline. Older versions are unsupported unless separately verified. It emitted non-fatal access warnings while cleaning stale arg0 aliases. |
| Node.js | 24.19.0 | VERIFIED-LOCAL | Project minimum is Node 22.16 because that is the first release exposing every required `node:sqlite` API, including `backup` and the `DatabaseSync` timeout option; 24.19.0 is the tested local baseline. |
| npm / npx | unavailable on PATH | VERIFIED-LOCAL | Implementation must not assume npm is installed. |
| Git | 2.42.0.windows.2 | VERIFIED-LOCAL | Repository history and branch inspected. |

## Host capabilities

| Capability | Claude Code | Codex CLI | Evidence and constraints |
|---|---|---|---|
| Plugin/package discovery | VERIFIED-DOCS; VERIFIED-LOCAL | VERIFIED-DOCS; VERIFIED-LOCAL | Claude exposes `claude plugin`; see [Plugins](https://code.claude.com/docs/en/plugins). Codex exposes `codex plugin`; see OpenAI [Build plugins](https://developers.openai.com/plugins/build/plugins). Packaging formats are host-specific and must use separate adapters. |
| Lifecycle hooks | VERIFIED-DOCS; existing repository implementation | UNVERIFIED for a Claude-style mod hook API | Claude [hooks reference](https://code.claude.com/docs/en/hooks). No Claude hook names or runtime module API will be invented for Codex. |
| MCP stdio server | VERIFIED-DOCS; VERIFIED-LOCAL | VERIFIED-DOCS; VERIFIED-LOCAL | Claude [MCP documentation](https://code.claude.com/docs/en/mcp); OpenAI [MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). Local help exposes `claude mcp` and `codex mcp`. |
| Skills | VERIFIED-DOCS | VERIFIED-DOCS | Claude plugins may package skills; see [Skills](https://code.claude.com/docs/en/skills). Codex loads repository skills from `.agents/skills`; see OpenAI [Build skills](https://learn.chatgpt.com/docs/build-skills). |
| Arbitrary custom status output | VERIFIED-DOCS | UNSUPPORTED by available documentation | Claude accepts a command-backed `statusLine` and renders its stdout; see [Customize your status line](https://code.claude.com/docs/en/statusline). Codex documents only an ordered list of built-in footer item identifiers in `tui.status_line`; see [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). |
| Existing `AbovePrompt` plugin component | VERIFIED-LOCAL for validation and mocked plugin tests; interactive rendering UNVERIFIED | Not applicable | Outside the filesystem sandbox, `claude plugin validate .` exited 0 with warnings and inventoried all six hooks; `claude plugin test .` exited 0 with 4 pass / 0 fail. These are Claude's plugin test harness, not an interactive real-host UI test. The existing component must be preserved; documented `statusLine` is not treated as equivalent. |
| Native project experiment fields in status line | Existing plugin can render them, but local load is not proven | UNSUPPORTED by available documentation | Codex fallback is shared MCP data plus `mods status`; built-in footer fields may be configured but cannot be extended with fabricated identifiers. |
| Host-selected model preservation | Design constraint | Design constraint | No adapter or installer may write a host model setting. This is verified by source review and tests, not inferred from a host API. |
| Automatic active-host metadata | UNVERIFIED outside explicit installer context | UNVERIFIED outside explicit installer context | `--host auto` may trust an explicit invocation context supplied by an integration, but installed binaries, parent process names, and guessed environment variables are insufficient. Ambiguity must fail closed. |

## Platform matrix

| Area | Windows | Linux | macOS |
|---|---|---|---|
| Local host execution | VERIFIED-LOCAL for CLI discovery/help | UNVERIFIED | UNVERIFIED |
| Default shared-data location | `%LOCALAPPDATA%\\tuamah-mods` design target | `$XDG_STATE_HOME/tuamah-mods` or `~/.local/state/tuamah-mods` design target | `~/Library/Application Support/tuamah-mods` design target |
| SQLite runtime | VERIFIED-LOCAL through Node 24 `node:sqlite` | UNVERIFIED until CI/host test | UNVERIFIED until CI/host test |
| Claude custom status command | VERIFIED-DOCS, including PowerShell examples | VERIFIED-DOCS | VERIFIED-DOCS |
| Codex MCP/config | VERIFIED-DOCS and local CLI help | VERIFIED-DOCS only | VERIFIED-DOCS only |

## Supported implementation boundary

The compatibility gate permits implementation of:

1. A host-independent Node core using one SQLite database and no npm-only runtime dependency.
2. A stable CLI and one stdio MCP server shared by both hosts.
3. A Claude adapter that preserves the existing `/pstatus` contract and can use documented plugin/status-line mechanisms without destructive settings changes.
4. A Codex repository skill and documented MCP configuration, plus a read-only terminal status command.
5. A fail-closed installer that previews changes and only edits integration-owned/project-scoped files when explicitly run.

The gate does **not** permit:

- a custom Codex TUI widget or custom `tui.status_line` identifier;
- undocumented Codex hooks or Claude-style runtime APIs in Codex;
- claims of Linux/macOS or real-host integration success without evidence;
- writing global user configuration during tests;
- automatic selection based only on process names, executable presence, or guessed environment variables.

## Phase 0 verdict

**CONDITIONAL PASS.** The shared core, CLI, storage, MCP server, Claude compatibility adapter, and documented Codex fallback may be implemented. Host-specific work is limited to the verified interfaces above. Interactive Claude UI behavior, Codex arbitrary custom TUI rendering, Linux, and macOS remain explicitly unverified; release claims must retain those qualifications until real tests exist.

## Reproducible evidence log

| Command | Exit | Result |
|---|---:|---|
| `git log --oneline --all -n 40` | 0 | Two commits: `5be8b9e`, `46b9f63`. |
| `claude --version` | 0 | `2.1.295 (Claude Code)`. |
| `codex --version` | 0 | `codex-cli 0.162.0-alpha.2`. |
| `node --version` | 0 | `v24.19.0`. |
| `git --version` | 0 | `2.42.0.windows.2`. |
| `where npm` / `where npx` | 1 | Neither executable found on PATH. |
| `node -e "require('node:sqlite')"` | 0 | Built-in SQLite API loaded. |
| `claude plugin validate .` (sandboxed) | 1 | ENVIRONMENT-BLOCKED: EPERM/path-traversal diagnostics from the sandbox path projection. |
| `claude plugin test .` (sandboxed) | 1 | ENVIRONMENT-BLOCKED: hook path rejected as traversal under the sandbox projection. |
| `claude plugin validate .` (same checkout, outside sandbox) | 0 | Validation passed with warnings; all existing hooks inventoried. |
| `claude plugin test .` (same checkout, outside sandbox) | 0 | 4 pass, 0 fail, 0.37 seconds. |

## Plugin failure diagnosis

Reproduction inside the filesystem sandbox:

```text
claude plugin validate .
claude plugin test .
```

The first run reported `EPERM`, symlink/path traversal warnings, and an unreadable type declaration. The test command reported that the hook module path was traversal. No repository symlink exists in the committed layout. Repeating the exact commands against the exact checkout outside the filesystem sandbox passed validation and all four tests. Therefore the original failure is classified `ENVIRONMENT-BLOCKED`, caused by the sandbox path projection rather than the plugin layout or a demonstrated plugin security violation.

## Build and test strategy without npm

The project uses Node directly and selects no external runtime dependency. Node 22.16+ supplies every `node:sqlite` API used by MODS; Node's built-in test runner executes `node --test tests-v2/*.test.mjs`. The Claude-owned test harness runs through `claude plugin test .`. Missing npm is an environment constraint, not a reason to omit tests.

## Independent reviewer decision

**PASS — all implementation prerequisites verified within the documented integration boundary.**

Supporting evidence:

- The complete two-commit repository and every existing public command, hook, tool, state key, manifest, and test were inspected.
- The sandboxed Claude failure was reproduced, isolated, and cleared by an outside-sandbox run of the same checkout: validation exit 0 and 4/4 tests.
- Claude `AbovePrompt` remains a distinct existing interface and must be preserved; `statusLine` is not considered an equivalent replacement.
- Codex arbitrary custom TUI rendering is `UNSUPPORTED`; MCP plus `mods status` is the authorized fallback.
- Both adapters must call the same core and resolve the same SQLite path. No adapter may own a second authoritative database.
- Node-direct build and tests are reproducible without npm.

Blockers: none for the documented implementation boundary. Remaining limitations are interactive Claude UI testing, real Codex MCP registration, Linux, and macOS; these remain `UNVERIFIED` and block only corresponding release claims.

Authorized next phases: Phases 1–9 for the shared core, SQLite, history, CLI, MCP, legacy-preserving Claude adapter, documented Codex MCP/skill/status-command adapter, reversible installers, documentation, and tests. Host-specific work must remain isolated. No custom Codex TUI, undocumented hooks, global-settings mutation during tests, or model-setting mutation is authorized.
