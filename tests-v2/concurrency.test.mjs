import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { ExperimentEngine, ModsDatabase } from '../packages/core/src/index.mjs'

const moduleUrl = new URL('../packages/core/src/index.mjs', import.meta.url).href
const worker = `
  import { ExperimentEngine } from ${JSON.stringify(moduleUrl)};
  const engine = new ExperimentEngine({databasePath:process.argv[1]});
  if (process.argv[4] !== 'open-only') engine.createExperiment({cwd:process.argv[2],name:process.argv[3],type:'initial',host:process.argv[4],idempotencyKey:process.argv[5] || undefined});
  engine.close();
`

function runWorkers(databasePath, project, count, options = {}) {
  return Promise.all(Array.from({ length: count }, (_, index) => new Promise((resolve, reject) => {
    const name = options.sameRequest ? 'Shared request' : `Experiment ${index}`
    const host = options.openOnly ? 'open-only' : options.sameRequest ? 'concurrency' : `host-${index}`
    const key = options.sameRequest ? 'shared-idempotency-key' : ''
    const child = spawn(process.execPath, ['--input-type=module', '-e', worker, databasePath, project, name, host, key], { stdio: 'pipe' })
    let error = ''
    child.stderr.on('data', chunk => { error += chunk })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(error || `exit ${code}`)))
  })))
}

function assertDatabaseState(engine, expectedExperiments) {
  assert.equal(engine.database.db.prepare('SELECT COUNT(*) count FROM experiments').get().count, expectedExperiments)
  assert.equal(engine.database.db.prepare('SELECT COUNT(*) count FROM experiment_events').get().count, expectedExperiments)
  assert.deepEqual(engine.database.integrityCheck(), ['ok'])
  assert.deepEqual(engine.database.db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(engine.database.db.prepare('SELECT COUNT(*) count FROM experiment_events event LEFT JOIN experiments experiment ON experiment.experiment_id=event.experiment_id WHERE experiment.experiment_id IS NULL').get().count, 0)
}

for (const count of [8, 16, 32]) {
  test(`concurrent initialization with ${count} processes preserves history and integrity`, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tuamah-mods-concurrency-${count}-`))
    const project = path.join(dir, 'project with ünicode')
    const databasePath = path.join(dir, 'shared.sqlite3')
    fs.mkdirSync(project)
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    await runWorkers(databasePath, project, count)
    const engine = new ExperimentEngine({ databasePath })
    assertDatabaseState(engine, count)
    engine.close()
  })
}

test('concurrent initialization of a pre-existing WAL database is safe and idempotent', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuamah-mods-existing-wal-'))
  const project = path.join(dir, 'project')
  const databasePath = path.join(dir, 'shared.sqlite3')
  fs.mkdirSync(project)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  new ModsDatabase({ databasePath }).close()
  await runWorkers(databasePath, project, 16, { sameRequest: true })
  const engine = new ExperimentEngine({ databasePath })
  assertDatabaseState(engine, 1)
  assert.equal(engine.database.db.prepare('SELECT COUNT(*) count FROM idempotency').get().count, 1)
  engine.close()
})

test('initialization lock wait is bounded', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuamah-mods-bounded-lock-'))
  const databasePath = path.join(dir, 'locked.sqlite3')
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const blocker = new DatabaseSync(databasePath)
  blocker.exec('CREATE TABLE held(value TEXT); BEGIN EXCLUSIVE')
  const started = Date.now()
  try {
    assert.throws(() => new ModsDatabase({ databasePath, busyTimeout: 100 }), /locked|busy/i)
    assert.ok(Date.now() - started < 2000, 'bounded initialization exceeded two seconds')
  } finally {
    blocker.exec('ROLLBACK')
    blocker.close()
  }
})

test('concurrent legacy schema initialization applies one recoverable migration', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuamah-mods-migration-race-'))
  const project = path.join(dir, 'project')
  const databasePath = path.join(dir, 'legacy.sqlite3')
  fs.mkdirSync(project)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const legacy = new DatabaseSync(databasePath)
  legacy.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO schema_meta VALUES ('schema_version','0');
    CREATE TABLE project_status (
      project_id TEXT NOT NULL,
      branch TEXT NOT NULL,
      progress INTEGER,
      current_experiment_id TEXT,
      updated_at TEXT NOT NULL,
      updated_by_host TEXT NOT NULL,
      PRIMARY KEY(project_id, branch)
    );
    INSERT INTO project_status VALUES ('legacy-project','main',73,'legacy-experiment','2026-10-09T00:00:00.000Z','claude');
  `)
  const pinnedReader = new DatabaseSync(databasePath, { readOnly: true })
  pinnedReader.exec('BEGIN')
  pinnedReader.prepare('SELECT COUNT(*) count FROM project_status').get()
  legacy.prepare('UPDATE project_status SET progress=91 WHERE project_id=?').run('legacy-project')
  legacy.close()
  assert.ok(fs.existsSync(`${databasePath}-wal`))
  const sourceProbe = new DatabaseSync(databasePath, { readOnly: true })
  assert.equal(sourceProbe.prepare('SELECT progress FROM project_status WHERE project_id=?').get('legacy-project').progress, 91)
  sourceProbe.close()
  await runWorkers(databasePath, project, 16, { openOnly: true })
  const engine = new ExperimentEngine({ databasePath })
  const columns = engine.database.db.prepare('PRAGMA table_info(project_status)').all().map(column => column.name)
  assert.ok(columns.includes('display_experiment_id'))
  assert.equal(engine.database.db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get().value, '1')
  assert.deepEqual(engine.database.integrityCheck(), ['ok'])
  assert.deepEqual(engine.database.db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(engine.database.db.prepare('SELECT progress FROM project_status WHERE project_id=?').get('legacy-project').progress, 91)
  const backupPath = `${databasePath}.v0.backup`
  assert.ok(fs.existsSync(backupPath))
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.backup')), ['legacy.sqlite3.v0.backup'])
  assert.ok(fs.existsSync(`${backupPath}.verified.json`))
  const verifiedBackup = new DatabaseSync(backupPath, { readOnly: true })
  assert.deepEqual(verifiedBackup.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]), ['ok'])
  assert.equal(verifiedBackup.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get().value, '0')
  assert.equal(verifiedBackup.prepare('SELECT progress FROM project_status WHERE project_id=?').get('legacy-project').progress, 91)
  assert.ok(!verifiedBackup.prepare('PRAGMA table_info(project_status)').all().some(column => column.name === 'display_experiment_id'))
  verifiedBackup.close()
  engine.close()
  pinnedReader.exec('COMMIT')
  pinnedReader.close()
})

test('failed online backup aborts migration and a clean retry succeeds', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuamah-mods-backup-failure-'))
  const databasePath = path.join(dir, 'legacy.sqlite3')
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const legacy = new DatabaseSync(databasePath)
  legacy.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO schema_meta VALUES ('schema_version','0');
    CREATE TABLE project_status (
      project_id TEXT NOT NULL,
      branch TEXT NOT NULL,
      progress INTEGER,
      current_experiment_id TEXT,
      updated_at TEXT NOT NULL,
      updated_by_host TEXT NOT NULL,
      PRIMARY KEY(project_id, branch)
    );
    INSERT INTO project_status VALUES ('legacy-project','main',44,NULL,'2026-10-09T00:00:00.000Z','claude');
  `)
  legacy.close()
  assert.throws(
    () => new ModsDatabase({
      databasePath,
      backupRunner(_source, destination) {
        fs.writeFileSync(destination, 'incomplete')
        throw new Error('injected backup failure')
      },
    }),
    error => error.code === 'MIGRATION_BACKUP_FAILED' && /injected backup failure/.test(error.message),
  )
  const unchanged = new DatabaseSync(databasePath, { readOnly: true })
  assert.equal(unchanged.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get().value, '0')
  assert.ok(!unchanged.prepare('PRAGMA table_info(project_status)').all().some(column => column.name === 'display_experiment_id'))
  assert.equal(unchanged.prepare('SELECT progress FROM project_status WHERE project_id=?').get('legacy-project').progress, 44)
  unchanged.close()
  assert.ok(!fs.existsSync(`${databasePath}.v0.backup`))
  assert.ok(!fs.existsSync(`${databasePath}.v0.backup.verified.json`))
  assert.equal(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')).length, 0)
  fs.copyFileSync(databasePath, `${databasePath}.v0.backup`)
  assert.throws(
    () => new ModsDatabase({ databasePath }),
    error => error.code === 'MIGRATION_BACKUP_INVALID' && /verification marker is missing/.test(error.message),
  )
  const stillLegacy = new DatabaseSync(databasePath, { readOnly: true })
  assert.equal(stillLegacy.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get().value, '0')
  stillLegacy.close()
  fs.rmSync(`${databasePath}.v0.backup`)
  const recovered = new ModsDatabase({ databasePath })
  assert.equal(recovered.db.prepare("SELECT value FROM schema_meta WHERE key='schema_version'").get().value, '1')
  assert.deepEqual(recovered.integrityCheck(), ['ok'])
  recovered.close()
})
