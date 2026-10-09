import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRemote, canonicalPathKey } from '../packages/core/src/index.mjs'
import { defaultStateDirectory } from '../packages/core/src/paths.mjs'

test('remote normalization unifies SSH and HTTPS repository spelling', () => {
  assert.equal(normalizeRemote('git@GitHub.com:Tuamah/mods.git'), 'ssh://github.com/tuamah/mods')
  assert.equal(normalizeRemote('HTTPS://GITHUB.COM/TUAMAH/MODS.git'), 'https://github.com/tuamah/mods')
})

test('state paths follow platform conventions', () => {
  assert.equal(defaultStateDirectory({ LOCALAPPDATA: 'C:\\State' }, 'win32', 'C:\\Home'), 'C:\\State\\tuamah-mods')
  assert.equal(defaultStateDirectory({ XDG_STATE_HOME: '/state' }, 'linux', '/home/u'), '/state/tuamah-mods')
  assert.equal(defaultStateDirectory({}, 'darwin', '/Users/u'), '/Users/u/Library/Application Support/tuamah-mods')
})

test('POSIX project identity preserves case while Windows identity folds it', () => {
  assert.notEqual(canonicalPathKey('/work/Project', 'linux'), canonicalPathKey('/work/project', 'linux'))
  assert.equal(canonicalPathKey('C:\\Work\\Project', 'win32'), canonicalPathKey('c:\\work\\project', 'win32'))
})
