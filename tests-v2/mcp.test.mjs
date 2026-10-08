import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers.mjs'
import { dispatch } from '../packages/mcp-server/src/server.mjs'

test('MCP tools operate on the same engine record', t => {
  const { engine, project } = fixture(t)
  const created = dispatch(engine, 'create_experiment', { cwd: project, name: 'Cross host', type: 'initial', host: 'claude' })
  dispatch(engine, 'start_experiment', { experimentId: created.experiment_id, host: 'claude' })
  const current = dispatch(engine, 'get_current_experiment', { cwd: project })
  assert.equal(current.experiment_id, created.experiment_id)
  dispatch(engine, 'finish_experiment', { experimentId: created.experiment_id, host: 'codex', result: 'success' })
  assert.equal(dispatch(engine, 'get_experiment', { experimentId: created.experiment_id }).last_updated_by_host, 'codex')
  assert.equal(dispatch(engine, 'get_experiment_history', { experimentId: created.experiment_id }).length, 3)
})

test('unknown MCP tools do not execute arbitrary commands', t => {
  const { engine } = fixture(t)
  assert.throws(() => dispatch(engine, 'shell_exec', { command: 'whoami' }), error => error.code === 'METHOD_NOT_FOUND')
})
