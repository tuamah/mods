# Migration

Before a schema upgrade, initialization is serialized with a bounded SQLite write transaction and the schema version is checked while that coordination is held. A separate Node worker uses the SQLite Online Backup API to create a consistent sibling `*.vN.backup` snapshot, including committed pages still in the source WAL. Only the temporary snapshot is checkpointed and converted to a standalone file; the active source WAL is not forced through a checkpoint.

The snapshot is opened independently for `integrity_check` and schema-version verification before the backup file is atomically published without overwrite; a separate SHA-256 verification marker is then published the same way. Existing unmarked, mismatched, or corrupt backups are never overwritten or trusted automatically. A crash between those two publications can leave a valid but unmarked backup, in which case migration fails closed until that artifact is inspected and removed manually. Backup failure rolls back initialization, removes temporary backup artifacts, and leaves the source schema unchanged. This is a pre-migration safety guarantee for cooperating MODS initializers, not a general-purpose recovery subsystem. A database newer than the runtime is rejected.

The legacy Claude plugin stores `{ progress, experiment }` under `tracked:<project>:<branch>` in its private plugin store. The host-neutral core exposes `importLegacySnapshot` so the future Claude adapter can pass that value without teaching the core about private host storage.

Legacy import:

- preserves progress and the current experiment;
- maps legacy `kind` to the v2 type;
- maps `running` to a running lifecycle with pending result;
- maps `success` or `fail` to a completed lifecycle and matching result;
- adds `metadata.imported=true` and an explicit import description;
- never fabricates pre-import history;
- uses a deterministic migration ID and idempotency keys;
- never deletes or edits the original plugin-store value.

Automatic extraction from the Claude plugin store is deferred until the host adapter gate passes.
