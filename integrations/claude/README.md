# Claude adapter

The existing `.claude-plugin`, `hooks`, `types`, and tests remain the Claude adapter. `hooks/register.tsx` preserves `AbovePrompt`, `/pstatus`, and `mcp__project-status__set_status` while using the shared CLI bridge for SQLite state.

The bridge deliberately uses the documented plugin process API instead of importing Node built-ins into a hook module, which Claude validation rejects.
