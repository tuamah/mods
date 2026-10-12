import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { install, uninstall } from '../packages/adapters/src/installer.mjs'

test('Codex install is previewed, atomic, idempotent, and reversible', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'mods-install-'))
  t.after(() => fs.rmSync(project, { recursive: true, force: true }))
  const config = path.join(project, '.codex', 'config.toml')
  fs.mkdirSync(path.dirname(config), { recursive: true })
  fs.writeFileSync(config, 'model = "unchanged"\n')
  assert.equal(install({ requestedHost: 'codex', project }).applied, false)
  const databasePath = path.join(project, 'state.sqlite3')
  const env = { ...process.env, MODS_DATABASE_PATH: databasePath }
  install({ requestedHost: 'codex', project, apply: true, env })
  const once = fs.readFileSync(config, 'utf8')
  assert.match(once, new RegExp(`MODS_DATABASE_PATH = "${databasePath.replace(/\\/g, '\\\\')}"`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  const serverLiteral = once.match(/args = \["((?:\\.|[^"])*)"\]/)?.[1]
  assert.ok(serverLiteral)
  const server = JSON.parse(`"${serverLiteral}"`)
  const handshake = spawnSync(process.execPath, [server], {
    cwd: project,
    env,
    input: '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}\n',
    encoding: 'utf8',
  })
  assert.equal(handshake.status, 0, handshake.stderr)
  assert.match(handshake.stdout, /"name":"tuamah-mods"/)
  const installedSkill = fs.readFileSync(path.join(project, '.agents', 'skills', 'project-status', 'SKILL.md'), 'utf8')
  assert.match(installedSkill, /mods\.mjs" status/)
  install({ requestedHost: 'codex', project, apply: true, env })
  assert.equal(fs.readFileSync(config, 'utf8'), once)
  assert.match(once, /model = "unchanged"/); assert.match(once, /mcp_servers\.project-status/)
  const removed = uninstall({ requestedHost: 'codex', project, apply: true })
  assert.equal(removed.databasePreserved, true)
  assert.match(fs.readFileSync(config, 'utf8'), /model = "unchanged"/)
  assert.doesNotMatch(fs.readFileSync(config, 'utf8'), /project-status/)
})

test('Claude installer delegates to the documented plugin command', () => {
  const calls = []
  const runner = (command, args) => { calls.push([command, args]); return { status: 0 } }
  install({ requestedHost: 'claude', apply: true, runner })
  uninstall({ requestedHost: 'claude', apply: true, runner })
  assert.deepEqual(calls[0], ['claude', ['plugin','install','project-status','--marketplace','tuamah/mods']])
  assert.deepEqual(calls[1], ['claude', ['plugin','uninstall','project-status']])
})

test('failed Codex installation rolls back every target', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'mods-install-failure-'))
  t.after(() => fs.rmSync(project, { recursive: true, force: true }))
  const config = path.join(project, '.codex', 'config.toml')
  const skill = path.join(project, '.agents', 'skills', 'project-status', 'SKILL.md')
  fs.mkdirSync(path.dirname(config), { recursive: true })
  fs.writeFileSync(config, 'model = "preserved"\n')
  assert.throws(() => install({ requestedHost: 'codex', project, apply: true, failAfterSkill: true }), error => error.code === 'INSTALL_INTERRUPTED')
  assert.equal(fs.readFileSync(config, 'utf8'), 'model = "preserved"\n')
  assert.equal(fs.existsSync(skill), false)
})
