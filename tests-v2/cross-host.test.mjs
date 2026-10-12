import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.mjs'
import { dispatch } from '../packages/mcp-server/src/server.mjs'

test('Claude and Codex share one experiment ID, record, and event stream', t => {
  const { engine, project } = fixture(t)
  const created = engine.createExperiment({ cwd: project, name: 'E', type: 'initial', host: 'claude', idempotencyKey: 'claude-create-E' })
  engine.startExperiment(created.experiment_id, { host: 'claude', idempotencyKey: 'claude-start-E' })

  const seenByCodex = dispatch(engine, 'get_current_experiment', { cwd: project })
  assert.equal(seenByCodex.experiment_id, created.experiment_id)
  dispatch(engine, 'update_experiment', { experimentId: created.experiment_id, description: 'updated in Codex', host: 'codex', idempotencyKey: 'codex-update-E' })
  dispatch(engine, 'finish_experiment', { experimentId: created.experiment_id, result: 'success', host: 'codex', idempotencyKey: 'codex-finish-E' })

  const seenByClaude = engine.getExperiment(created.experiment_id)
  assert.equal(seenByClaude.description, 'updated in Codex')
  assert.equal(seenByClaude.result, 'success')
  assert.equal(engine.listExperiments({ cwd: project }).length, 1)
  assert.deepEqual(engine.getHistory(created.experiment_id).map(e => [e.operation, e.host]), [
    ['create', 'claude'], ['running', 'claude'], ['update', 'codex'], ['completed', 'codex'],
  ])
})
