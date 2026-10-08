# Security

- MCP exposes a fixed allowlist of data operations. It has no shell tool, arbitrary filesystem tool, or command parameter.
- Inputs are parameter-bound SQLite values; callers cannot inject SQL identifiers or statements.
- Metadata must be a JSON object. Callers must not place secrets, tokens, credentials, or conversation transcripts in it.
- The database is outside repositories by default and can be relocated only through documented environment overrides.
- Conflicting idempotency-key reuse is rejected. Writes use transactions, foreign keys, WAL, and a busy timeout.
- Installers must preview changes, preserve unrelated configuration, use atomic replacement, and remove only integration-owned entries. No global configuration is changed by the current implementation.
- Host selection is explicit. Auto-detection must fail closed when trustworthy host context is absent.

Threats not claimed as solved: malicious local users with access to the same OS account, database encryption at rest, and untested behavior on Linux/macOS.
