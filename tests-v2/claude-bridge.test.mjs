import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sharedCliUrl, SHARED_CLI } from '../hooks/shared-cli.mjs'

test('Claude bridge resolves relative to its module without CLAUDE_PLUGIN_ROOT', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mods-claude-bridge-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const env = { ...process.env, MODS_DATABASE_PATH: path.join(dir, 'shared.sqlite3') }
  delete env.CLAUDE_PLUGIN_ROOT
  const run = spawnSync(process.execPath, ['-e', SHARED_CLI, sharedCliUrl(), 'status', '--format', 'json', '--cwd', dir], { cwd: dir, env, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.equal(JSON.parse(run.stdout).project.canonicalPath, dir)
})

test('Claude bridge fails before invocation when the resolved entry point is absent', () => {
  const missing = new URL('./missing-mods-cli.mjs', import.meta.url).href
  const run = spawnSync(process.execPath, ['-e', SHARED_CLI, missing, 'status'], { encoding: 'utf8' })
  assert.notEqual(run.status, 0)
  assert.match(run.stderr, /ENOENT|no such file/i)
})
