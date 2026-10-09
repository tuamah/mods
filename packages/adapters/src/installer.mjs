import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { detectHost } from './host-detection.mjs'
import { ModsError } from '../../core/src/index.mjs'

const BEGIN = '# BEGIN tuamah-mods project-status (managed)'
const END = '# END tuamah-mods project-status (managed)'
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`
  fs.writeFileSync(temporary, content, 'utf8')
  fs.renameSync(temporary, file)
}

function toml(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function managedBlock(project, env = process.env) {
  const server = path.join(sourceRoot, 'packages', 'mcp-server', 'src', 'server.mjs')
  const configuredEnvironment = ['MODS_DATABASE_PATH', 'MODS_STATE_DIR']
    .filter(name => env[name])
    .map(name => `${name} = "${toml(env[name])}"`)
  const environment = configuredEnvironment.length
    ? `\n[mcp_servers.project-status.env]\n${configuredEnvironment.join('\n')}`
    : ''
  return `${BEGIN}\n[mcp_servers.project-status]\ncommand = "node"\nargs = ["${toml(server)}"]\ncwd = "${toml(project)}"\nrequired = true${environment}\n${END}`
}

function mergeBlock(content, project, env) {
  const expression = new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'm')
  const clean = content.replace(expression, '').trimEnd()
  return `${clean}${clean ? '\n\n' : ''}${managedBlock(project, env)}\n`
}

function removeBlock(content) {
  const start = content.indexOf(BEGIN); const end = content.indexOf(END)
  if (start < 0 || end < start) return content
  return `${content.slice(0, start)}${content.slice(end + END.length)}`.replace(/^\s+|\s+$/g, '') + '\n'
}

export function planInstall({ requestedHost = 'auto', project = process.cwd(), env = process.env } = {}) {
  const detection = detectHost(requestedHost, env)
  if (detection.host === 'claude') return { ...detection, project: path.resolve(project), changes: [], command: 'claude plugin install project-status --marketplace tuamah/mods' }
  const root = path.resolve(project)
  return {
    ...detection,
    project: root,
    changes: [
      path.join(root, '.agents', 'skills', 'project-status', 'SKILL.md'),
      path.join(root, '.codex', 'config.toml'),
    ],
  }
}

export function install(options = {}) {
  const plan = planInstall(options)
  if (!options.apply) return { applied: false, plan }
  if (plan.host === 'claude') {
    const run = (options.runner || spawnSync)('claude', ['plugin', 'install', 'project-status', '--marketplace', 'tuamah/mods'], { encoding: 'utf8', stdio: options.runner ? 'pipe' : 'inherit' })
    if (run.status !== 0) throw new ModsError('INSTALL_FAILED', 'Claude plugin installation failed')
    return { applied: true, plan }
  }
  const skillSource = path.join(sourceRoot, 'integrations', 'codex', '.agents', 'skills', 'project-status', 'SKILL.md')
  const skillTarget = plan.changes[0]; const configTarget = plan.changes[1]
  const before = new Map([skillTarget, configTarget].map(file => [file, fs.existsSync(file) ? fs.readFileSync(file) : null]))
  try {
    fs.mkdirSync(path.dirname(skillTarget), { recursive: true })
    const cli = path.join(sourceRoot, 'packages', 'cli', 'bin', 'mods.mjs')
    const skill = fs.readFileSync(skillSource, 'utf8').replace('node packages/cli/bin/mods.mjs status', `node "${cli}" status`)
    if (fs.existsSync(skillTarget) && fs.readFileSync(skillTarget, 'utf8') !== skill) {
      fs.copyFileSync(skillTarget, `${skillTarget}.pre-tuamah-mods.backup`)
    }
    atomicWrite(skillTarget, skill)
    if (options.failAfterSkill) throw new ModsError('INSTALL_INTERRUPTED', 'Injected installer interruption')
    const config = fs.existsSync(configTarget) ? fs.readFileSync(configTarget, 'utf8') : ''
    if (config && !config.includes(BEGIN)) fs.copyFileSync(configTarget, `${configTarget}.pre-tuamah-mods.backup`)
    atomicWrite(configTarget, mergeBlock(config, plan.project, options.env))
  } catch (error) {
    for (const [file, content] of before) {
      if (content === null) { if (fs.existsSync(file)) fs.unlinkSync(file) }
      else atomicWrite(file, content)
    }
    throw error
  }
  return { applied: true, plan }
}

export function uninstall(options = {}) {
  const plan = planInstall(options)
  if (!options.apply) return { applied: false, plan }
  if (plan.host === 'claude') {
    const run = (options.runner || spawnSync)('claude', ['plugin', 'uninstall', 'project-status'], { encoding: 'utf8', stdio: options.runner ? 'pipe' : 'inherit' })
    if (run.status !== 0) throw new ModsError('UNINSTALL_FAILED', 'Claude plugin uninstall failed')
    return { applied: true, plan }
  }
  const [skillTarget, configTarget] = plan.changes
  if (fs.existsSync(skillTarget)) {
    const installed = fs.readFileSync(skillTarget, 'utf8')
    const cli = path.join(sourceRoot, 'packages', 'cli', 'bin', 'mods.mjs')
    const source = fs.readFileSync(path.join(sourceRoot, 'integrations', 'codex', '.agents', 'skills', 'project-status', 'SKILL.md'), 'utf8').replace('node packages/cli/bin/mods.mjs status', `node "${cli}" status`)
    if (installed === source) fs.unlinkSync(skillTarget)
  }
  if (fs.existsSync(configTarget)) atomicWrite(configTarget, removeBlock(fs.readFileSync(configTarget, 'utf8')))
  return { applied: true, plan, databasePreserved: true }
}
