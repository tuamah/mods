# Experiment schema

Experiments contain the required stable ID, project ID, branch, name, type, lifecycle status, outcome, description, timestamps, creating/updating host, and JSON metadata.

- Types: `initial`, `fix`, `develop`.
- Statuses: `pending`, `running`, `completed`, `cancelled`, `interrupted`.
- Results: `pending`, `success`, `fail`, `inconclusive`.

Allowed lifecycle transitions are:

```text
pending -> running | cancelled
running -> completed | cancelled | interrupted
interrupted -> running | cancelled
```

Completion requires a non-pending result. Every accepted mutation appends one event with its own ID, UTC timestamp, host, operation, prior state, new state, and metadata. Idempotency keys bind to the operation and request hash; reuse with different input is rejected.

SQLite enables foreign keys, WAL, normal synchronous mode, a 5-second busy timeout, indexed filters, and `BEGIN IMMEDIATE` transactions. Schema version is stored in `schema_meta`.
