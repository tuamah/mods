import test from 'node:test'
import assert from 'node:assert/strict'
import { detectHost } from '../packages/adapters/src/host-detection.mjs'

test('explicit host selection is deterministic', () => {
  assert.deepEqual(detectHost('claude', {}), { host: 'claude', source: 'explicit-argument' })
  assert.deepEqual(detectHost('codex', {}), { host: 'codex', source: 'explicit-argument' })
})

test('auto detection uses only explicit wrapper context and fails closed', () => {
  assert.equal(detectHost('auto', { MODS_ACTIVE_HOST: 'codex' }).host, 'codex')
  assert.throws(() => detectHost('auto', { PATH: 'contains-both-binaries' }), error => error.code === 'AMBIGUOUS_HOST')
})
