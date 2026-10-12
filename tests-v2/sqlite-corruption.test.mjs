import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ExperimentEngine } from '../packages/core/src/index.mjs'

test('isolated corruption is detected and a verified backup can be opened separately', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mods-corruption-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const project = path.join(root, 'project')
  const original = path.join(root, 'original.sqlite3')
  const backup = path.join(root, 'verified-backup.sqlite3')
  const corrupt = path.join(root, 'corrupt-copy.sqlite3')
  const restored = path.join(root, 'restored-copy.sqlite3')
  fs.mkdirSync(project)

  const engine = new ExperimentEngine({ databasePath: original })
  const experiment = engine.createExperiment({ cwd: project, name: 'Recovery Fixture', type: 'initial', host: 'claude', idempotencyKey: 'recovery-create' })
  engine.startExperiment(experiment.experiment_id, { host: 'claude', idempotencyKey: 'recovery-start' })
  engine.finishExperiment(experiment.experiment_id, { host: 'codex', result: 'success', idempotencyKey: 'recovery-finish' })
  engine.database.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  await engine.database.backup(backup)
  engine.close()

  fs.copyFileSync(original, corrupt)
  const bytes = fs.readFileSync(corrupt)
  bytes.fill(0, 0, Math.min(100, bytes.length))
  fs.writeFileSync(corrupt, bytes)
  assert.throws(() => {
    const damaged = new DatabaseSync(corrupt, { readOnly: true })
    try { damaged.prepare('PRAGMA integrity_check').all() } finally { damaged.close() }
  })

  fs.copyFileSync(backup, restored)
  const recovered = new DatabaseSync(restored, { readOnly: true })
  assert.deepEqual(recovered.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check), ['ok'])
  assert.deepEqual(recovered.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(recovered.prepare('SELECT status FROM experiments WHERE experiment_id=?').get(experiment.experiment_id).status, 'completed')
  assert.equal(recovered.prepare('SELECT COUNT(*) count FROM experiment_events WHERE experiment_id=?').get(experiment.experiment_id).count, 3)
  assert.equal(recovered.prepare('SELECT COUNT(*) count FROM idempotency').get().count, 3)
  recovered.close()

  const untouched = new DatabaseSync(original, { readOnly: true })
  assert.deepEqual(untouched.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check), ['ok'])
  untouched.close()
})
