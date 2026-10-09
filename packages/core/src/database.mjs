import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync, backup } from 'node:sqlite'
import { defaultDatabasePath } from './paths.mjs'
import { ModsError } from './errors.mjs'

export const SCHEMA_VERSION = 1
const MINIMUM_NODE = [22, 16, 0]
const BACKUP_WORKER = `
  import { DatabaseSync, backup } from 'node:sqlite';
  const source = new DatabaseSync(process.argv[1], { readOnly: true, timeout: Number(process.argv[3]) });
  try { await backup(source, process.argv[2]); } finally { source.close(); }
  const snapshot = new DatabaseSync(process.argv[2], { timeout: Number(process.argv[3]) });
  try {
    snapshot.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const mode = snapshot.prepare('PRAGMA journal_mode=DELETE').get();
    if (String(mode?.journal_mode).toLowerCase() !== 'delete') throw new Error('unable to finalize standalone backup');
  } finally { snapshot.close(); }
`

function assertSupportedNode() {
  const actual = process.versions.node.split('.').map(Number)
  const supported = actual[0] > MINIMUM_NODE[0]
    || (actual[0] === MINIMUM_NODE[0] && actual[1] > MINIMUM_NODE[1])
    || (actual[0] === MINIMUM_NODE[0] && actual[1] === MINIMUM_NODE[1] && actual[2] >= MINIMUM_NODE[2])
  if (!supported) throw new ModsError('UNSUPPORTED_NODE', `MODS requires Node >=22.16.0; current runtime is ${process.versions.node}`)
}

function isLockError(error) {
  return error?.code === 'SQLITE_BUSY' || error?.code === 'SQLITE_LOCKED' || /database (?:is )?locked/i.test(error?.message || '')
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  canonical_path TEXT NOT NULL,
  remote_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_aliases (
  alias_path TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_status (
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  progress INTEGER CHECK(progress IS NULL OR (progress >= 0 AND progress <= 100)),
  current_experiment_id TEXT,
  display_experiment_id TEXT,
  updated_at TEXT NOT NULL,
  updated_by_host TEXT NOT NULL,
  PRIMARY KEY(project_id, branch)
);
CREATE TABLE IF NOT EXISTS experiments (
  experiment_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('initial','fix','develop')),
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','cancelled','interrupted')),
  result TEXT NOT NULL CHECK(result IN ('pending','success','fail','inconclusive')),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL,
  created_by_host TEXT NOT NULL,
  last_updated_by_host TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS experiments_project_branch ON experiments(project_id, branch, created_at DESC);
CREATE INDEX IF NOT EXISTS experiments_filters ON experiments(type, status, result, last_updated_by_host, updated_at);
CREATE TABLE IF NOT EXISTS experiment_events (
  event_id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL REFERENCES experiments(experiment_id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  host TEXT NOT NULL,
  operation TEXT NOT NULL,
  previous_state TEXT,
  new_state TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_experiment_time ON experiment_events(experiment_id, timestamp, event_id);
CREATE TABLE IF NOT EXISTS idempotency (
  idempotency_key TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS migrations (
  migration_id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}'
);
`

export class ModsDatabase {
  constructor(options = {}) {
    assertSupportedNode()
    this.path = defaultDatabasePath(options)
    fs.mkdirSync(path.dirname(this.path), { recursive: true })
    const existed = fs.existsSync(this.path)
    const busyTimeout = Math.max(0, Math.trunc(options.busyTimeout ?? 5000))
    const backupRunner = options.backupRunner || ((source, destination) => this.#runBackup(source, destination, busyTimeout))
    this.db = new DatabaseSync(this.path, { timeout: busyTimeout })
    this.transactionDepth = 0
    try {
      this.db.exec(`PRAGMA busy_timeout=${busyTimeout}`)
      this.db.exec('PRAGMA foreign_keys=ON')
      this.#enableWal(busyTimeout)
      this.db.exec('PRAGMA synchronous=NORMAL')
      this.#beginInitialization(busyTimeout)
      try {
        const version = this.#schemaVersion()
        if (version > SCHEMA_VERSION) throw new ModsError('SCHEMA_TOO_NEW', `Database schema ${version} is newer than supported ${SCHEMA_VERSION}`)
        if (existed && version < SCHEMA_VERSION) this.#backupBeforeMigration(version, backupRunner)
        this.db.exec(SCHEMA)
        const columns = this.db.prepare('PRAGMA table_info(project_status)').all()
        if (!columns.some(column => column.name === 'display_experiment_id')) this.db.exec('ALTER TABLE project_status ADD COLUMN display_experiment_id TEXT')
        this.db.prepare('INSERT OR REPLACE INTO schema_meta(key,value) VALUES (?,?)').run('schema_version', String(SCHEMA_VERSION))
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  #enableWal(busyTimeout) {
    const deadline = Date.now() + busyTimeout
    let delay = 10
    while (true) {
      try {
        const result = this.db.prepare('PRAGMA journal_mode=WAL').get()
        if (String(result?.journal_mode).toLowerCase() !== 'wal') throw new ModsError('WAL_UNAVAILABLE', `Unable to enable SQLite WAL mode for ${this.path}`)
        return
      } catch (error) {
        if (!isLockError(error) || Date.now() >= deadline) throw error
        wait(Math.min(delay, Math.max(1, deadline - Date.now())))
        delay = Math.min(delay * 2, 250)
      }
    }
  }

  #beginInitialization(busyTimeout) {
    const deadline = Date.now() + busyTimeout
    let delay = 10
    while (true) {
      try {
        this.db.exec('BEGIN IMMEDIATE')
        return
      } catch (error) {
        if (!isLockError(error) || Date.now() >= deadline) throw error
        wait(Math.min(delay, Math.max(1, deadline - Date.now())))
        delay = Math.min(delay * 2, 250)
      }
    }
  }

  #schemaVersion() {
    try { return Number(this.db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get()?.value || 0) }
    catch { return 0 }
  }

  #runBackup(source, destination, busyTimeout) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', BACKUP_WORKER, source, destination, String(busyTimeout)], {
      encoding: 'utf8',
      timeout: Math.max(1000, busyTimeout + 1000),
      windowsHide: true,
    })
    if (result.status !== 0) {
      const detail = result.error?.message || result.stderr?.trim() || `backup worker exited ${result.status}`
      throw new ModsError('MIGRATION_BACKUP_FAILED', `SQLite pre-migration backup failed: ${detail}`)
    }
  }

  #verifyBackup(candidate, expectedVersion) {
    const verified = new DatabaseSync(candidate, { readOnly: true })
    try {
      const integrity = verified.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0])
      if (integrity.length !== 1 || integrity[0] !== 'ok') throw new Error(`integrity_check returned ${integrity.join(', ')}`)
      let version = 0
      try { version = Number(verified.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get()?.value || 0) } catch {}
      if (version !== expectedVersion) throw new Error(`schema version ${version} does not match expected ${expectedVersion}`)
    } finally {
      verified.close()
    }
  }

  #backupDigest(candidate) {
    return createHash('sha256').update(fs.readFileSync(candidate)).digest('hex')
  }

  #verifyPublishedBackup(backupPath, expectedVersion) {
    const markerPath = `${backupPath}.verified.json`
    if (!fs.existsSync(markerPath)) throw new Error('verification marker is missing')
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    if (marker.schemaVersion !== expectedVersion) throw new Error(`verification marker schema version ${marker.schemaVersion} does not match expected ${expectedVersion}`)
    if (marker.sha256 !== this.#backupDigest(backupPath)) throw new Error('verification marker hash does not match backup')
    this.#verifyBackup(backupPath, expectedVersion)
  }

  #backupBeforeMigration(version, backupRunner) {
    if (version < SCHEMA_VERSION && fs.statSync(this.path).size > 0) {
      const backupPath = `${this.path}.v${version}.backup`
      if (fs.existsSync(backupPath)) {
        try { this.#verifyPublishedBackup(backupPath, version) }
        catch (error) { throw new ModsError('MIGRATION_BACKUP_INVALID', `Existing pre-migration backup is invalid: ${error.message}`) }
        return
      }
      const temporaryPath = `${backupPath}.${process.pid}.${randomUUID()}.tmp`
      const markerPath = `${backupPath}.verified.json`
      const temporaryMarkerPath = `${markerPath}.${process.pid}.${randomUUID()}.tmp`
      try {
        backupRunner(this.path, temporaryPath)
        this.#verifyBackup(temporaryPath, version)
        fs.linkSync(temporaryPath, backupPath)
        fs.writeFileSync(temporaryMarkerPath, `${JSON.stringify({ schemaVersion: version, sha256: this.#backupDigest(temporaryPath) })}\n`, { flag: 'wx' })
        fs.linkSync(temporaryMarkerPath, markerPath)
      } catch (error) {
        if (error?.code === 'EEXIST') {
          try { this.#verifyPublishedBackup(backupPath, version); return }
          catch (verificationError) { throw new ModsError('MIGRATION_BACKUP_INVALID', `Concurrent pre-migration backup is invalid: ${verificationError.message}`) }
        }
        if (error instanceof ModsError) throw error
        throw new ModsError('MIGRATION_BACKUP_FAILED', `SQLite pre-migration backup failed: ${error.message}`)
      } finally {
        for (const artifact of [temporaryPath, `${temporaryPath}-wal`, `${temporaryPath}-shm`, temporaryMarkerPath]) {
          try { fs.rmSync(artifact, { force: true }) } catch {}
        }
      }
    }
  }

  transaction(fn) {
    const depth = this.transactionDepth++
    const savepoint = `mods_nested_${depth}`
    this.db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`)
    try {
      const value = fn()
      this.db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`)
      this.transactionDepth--
      return value
    } catch (error) {
      this.db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
      this.transactionDepth--
      throw error
    }
  }

  integrityCheck() { return this.db.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]) }
  async backup(destination) { await backup(this.db, destination) }
  close() { this.db.close() }
}
