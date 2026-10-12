import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.mjs'

test('experiment lifecycle separates status from result and appends history', t => {
  const { engine, project } = fixture(t)
  const created = engine.createExperiment({ cwd: project, name: 'Battery Aging', type: 'initial', host: 'claude' })
  assert.equal(created.status, 'pending'); assert.equal(created.result, 'pending')
  const running = engine.startExperiment(created.experiment_id, { host: 'claude' })
  assert.equal(running.status, 'running'); assert.equal(running.result, 'pending')
  const completed = engine.finishExperiment(created.experiment_id, { host: 'codex', result: 'success' })
  assert.equal(completed.status, 'completed'); assert.equal(completed.result, 'success')
  assert.deepEqual(engine.getHistory(created.experiment_id).map(e => e.operation), ['create', 'running', 'completed'])
})

test('invalid transitions fail without a partial event', t => {
  const { engine, project } = fixture(t)
  const created = engine.createExperiment({ cwd: project, name: 'T', type: 'fix' })
  assert.throws(() => engine.finishExperiment(created.experiment_id, { result: 'fail' }), error => error.code === 'INVALID_TRANSITION')
  assert.equal(engine.getHistory(created.experiment_id).length, 1)
})

test('idempotent mutation returns one record and conflicts on changed input', t => {
  const { engine, project } = fixture(t)
  const input = { cwd: project, name: 'T', type: 'develop', idempotencyKey: 'request-1' }
  const first = engine.createExperiment(input); const second = engine.createExperiment(input)
  assert.equal(first.experiment_id, second.experiment_id)
  assert.equal(engine.listExperiments({ cwd: project }).length, 1)
  assert.throws(() => engine.createExperiment({ ...input, name: 'Different' }), error => error.code === 'IDEMPOTENCY_CONFLICT')
})

test('progress is clamped and shared across hosts', t => {
  const { engine, project } = fixture(t)
  engine.setProgress({ cwd: project, progress: 140, host: 'claude' })
  assert.equal(engine.getProjectStatus({ cwd: project }).progress, 100)
  engine.setProgress({ cwd: project, progress: 42, host: 'codex' })
  assert.equal(engine.getProjectStatus({ cwd: project }).progress, 42)
})

test('filters and integrity check are stable', t => {
  const { engine, project } = fixture(t)
  const one = engine.createExperiment({ cwd: project, name: 'One', type: 'initial', host: 'claude' })
  engine.startExperiment(one.experiment_id); engine.finishExperiment(one.experiment_id, { result: 'fail' })
  engine.createExperiment({ cwd: project, name: 'Two', type: 'fix', host: 'codex' })
  assert.equal(engine.listExperiments({ cwd: project, type: 'fix' }).length, 1)
  assert.equal(engine.listExperiments({ cwd: project, result: 'fail' }).length, 1)
  assert.deepEqual(engine.database.integrityCheck(), ['ok'])
})

test('legacy import is repeatable and labels the imported state', t => {
  const { engine, project } = fixture(t)
  const input = { cwd: project, tracked: { progress: 55, experiment: { name: 'Legacy', kind: 'initial', result: 'success' } } }
  const first = engine.importLegacySnapshot(input); const second = engine.importLegacySnapshot(input)
  assert.equal(first.imported, true); assert.equal(second.imported, false)
  assert.equal(engine.getProjectStatus({ cwd: project }).progress, 55)
  assert.equal(engine.listExperiments({ cwd: project }).length, 1)
  assert.equal(first.experiment.metadata.imported, true)
})

test('experiment comparison reports changed fields', t => {
  const { engine, project } = fixture(t)
  const left = engine.createExperiment({ cwd: project, name: 'A', type: 'initial' })
  const right = engine.createExperiment({ cwd: project, name: 'B', type: 'fix' })
  const comparison = engine.compareExperiments(left.experiment_id, right.experiment_id)
  assert.equal(comparison.changed.name.left, 'A')
  assert.equal(comparison.changed.type.right, 'fix')
})

test('sensitive metadata keys are rejected', t => {
  const { engine, project } = fixture(t)
  assert.throws(
    () => engine.createExperiment({ cwd: project, name: 'Unsafe', type: 'initial', metadata: { api_key: 'do-not-store' } }),
    error => error.code === 'SENSITIVE_METADATA',
  )
})

test('status reads do not create project or experiment records', t => {
  const { engine, project } = fixture(t)
  const status = engine.getProjectStatus({ cwd: project })
  assert.equal(status.progress, null)
  assert.equal(engine.database.db.prepare('SELECT COUNT(*) count FROM projects').get().count, 0)
  assert.equal(engine.database.db.prepare('SELECT COUNT(*) count FROM experiments').get().count, 0)
})
