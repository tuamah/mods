import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync, backup } from 'node:sqlite'
import { defaultDatabasePath } from './paths.mjs'
import { ModsError } from './errors.mjs'

export const SCHEMA_VERSION = 1

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
    this.path = defaultDatabasePath(options)
    fs.mkdirSync(path.dirname(this.path), { recursive: true })
    const existed = fs.existsSync(this.path)
    if (existed) this.#backupBeforeMigration()
    this.db = new DatabaseSync(this.path, { timeout: options.busyTimeout ?? 5000 })
    this.transactionDepth = 0
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;')
    this.db.exec(SCHEMA)
    const columns = this.db.prepare('PRAGMA table_info(project_status)').all()
    if (!columns.some(column => column.name === 'display_experiment_id')) this.db.exec('ALTER TABLE project_status ADD COLUMN display_experiment_id TEXT')
    this.db.prepare('INSERT OR REPLACE INTO schema_meta(key,value) VALUES (?,?)').run('schema_version', String(SCHEMA_VERSION))
  }

  #backupBeforeMigration() {
    const probe = new DatabaseSync(this.path, { readOnly: true })
    let version = 0
    try { version = Number(probe.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get()?.value || 0) } catch {}
    finally { probe.close() }
    if (version > SCHEMA_VERSION) throw new ModsError('SCHEMA_TOO_NEW', `Database schema ${version} is newer than supported ${SCHEMA_VERSION}`)
    if (version < SCHEMA_VERSION && fs.statSync(this.path).size > 0) {
      const backupPath = `${this.path}.v${version}.backup`
      if (!fs.existsSync(backupPath)) fs.copyFileSync(this.path, backupPath)
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
