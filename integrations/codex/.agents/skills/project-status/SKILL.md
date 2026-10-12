---
name: project-status
description: Track project progress and durable experiments in the shared tuamah-mods database through the project-status MCP tools or the mods CLI.
---

# Project status

Use the `project-status` MCP server for experiment mutations. Pass `host: "codex"` and an idempotency key for every mutation that may be retried.

- Read status with `get_project_status`.
- Create, start, update, and finish experiments with the corresponding MCP tools.
- Keep lifecycle status separate from outcome. A running experiment has result `pending`.
- Never place credentials, tokens, secrets, or conversation transcripts in metadata.
- If MCP is unavailable, use the read-only command `node packages/cli/bin/mods.mjs status`; do not invent a custom TUI widget.
- Do not change the user's selected model or edit global Codex configuration.
