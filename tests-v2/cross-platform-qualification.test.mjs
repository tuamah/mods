import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { ExperimentEngine } from '../packages/core/src/index.mjs'
import { install, uninstall } from '../packages/adapters/src/installer.mjs'
import { resolveProjectIdentity } from '../packages/core/src/identity.mjs'

function temporaryRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

test('Unicode and whitespace paths support lifecycle and logical integrity checks', t => {
  const root = temporaryRoot(t, 'mods qualification ')
  const project = path.join(root, 'مشروع Δ with spaces')
  const databasePath = path.join(root, 'state with spaces', 'تجارب.sqlite3')
  fs.mkdirSync(project, { recursive: true })
  const engine = new ExperimentEngine({ databasePath })
  const created = engine.createExperiment({ cwd: project, name: 'تجربة Δ', type: 'initial', host: 'claude', idempotencyKey: 'unicode-create' })
  engine.startExperiment(created.experiment_id, { host: 'claude', idempotencyKey: 'unicode-start' })
  engine.finishExperiment(created.experiment_id, { host: 'codex', result: 'success', idempotencyKey: 'unicode-finish' })

  assert.deepEqual(engine.database.integrityCheck(), ['ok'])
  assert.deepEqual(engine.database.db.prepare('PRAGMA foreign_key_check').all(), [])
  const record = engine.getExperiment(created.experiment_id)
  const history = engine.getHistory(created.experiment_id)
  assert.deepEqual(history.map(event => event.operation), ['create', 'running', 'completed'])
  assert.deepEqual(history.at(-1).new_state, record)
  const keys = engine.database.db.prepare('SELECT idempotency_key FROM idempotency ORDER BY idempotency_key').all()
  assert.equal(keys.length, 3)
  assert.equal(new Set(keys.map(row => row.idempotency_key)).size, keys.length)
  engine.close()
})

test('Git identity is stable between a repository and its linked worktree', t => {
  const root = temporaryRoot(t, 'mods-git-identity-')
  const repository = path.join(root, 'Repository With Space')
  const worktree = path.join(root, 'Linked Δ Worktree')
  fs.mkdirSync(repository)
  execFileSync('git', ['init', '-b', 'main'], { cwd: repository, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'MODS Test'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'mods-test@example.invalid'], { cwd: repository })
  fs.writeFileSync(path.join(repository, 'seed.txt'), 'seed\n')
  execFileSync('git', ['add', 'seed.txt'], { cwd: repository })
  execFileSync('git', ['commit', '-m', 'seed'], { cwd: repository, stdio: 'ignore' })
  execFileSync('git', ['worktree', 'add', '-b', 'qualification', worktree], { cwd: repository, stdio: 'ignore' })

  const primary = resolveProjectIdentity(repository)
  const linked = resolveProjectIdentity(worktree)
  assert.equal(primary.projectId, linked.projectId)
  assert.equal(primary.identityKey, linked.identityKey)
  assert.equal(primary.branch, 'main')
  assert.equal(linked.branch, 'qualification')
})

test('uninstall preserves a checkpointed and closed database byte-for-byte', t => {
  const root = temporaryRoot(t, 'mods-uninstall-db-')
  const project = path.join(root, 'consumer project')
  const databasePath = path.join(root, 'shared.sqlite3')
  fs.mkdirSync(project)
  const engine = new ExperimentEngine({ databasePath })
  engine.createExperiment({ cwd: project, name: 'Preserved', type: 'initial', idempotencyKey: 'preserved-create' })
  engine.database.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  engine.close()
  const before = hash(databasePath)

  const env = { ...process.env, MODS_DATABASE_PATH: databasePath }
  install({ requestedHost: 'codex', project, env, apply: true })
  uninstall({ requestedHost: 'codex', project, env, apply: true })

  assert.equal(hash(databasePath), before)
  const verification = new DatabaseSync(databasePath, { readOnly: true })
  assert.deepEqual(verification.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check), ['ok'])
  assert.deepEqual(verification.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(verification.prepare('SELECT COUNT(*) count FROM experiments').get().count, 1)
  verification.close()
})
