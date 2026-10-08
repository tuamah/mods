# Migration

Before a schema upgrade, the storage layer detects the existing schema version and creates one sibling `*.vN.backup` copy. A database newer than the runtime is rejected.

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
