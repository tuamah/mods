import { ExperimentEngine, defaultDatabasePath } from '../../core/src/index.mjs'
import { install, uninstall } from '../../adapters/src/installer.mjs'

function options(args) {
  const positional = []; const flags = {}
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) positional.push(args[i])
    else {
      const [key, inline] = args[i].slice(2).split('=', 2)
      flags[key] = inline ?? (args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true)
    }
  }
  return { positional, flags }
}

function csv(rows) {
  if (!rows.length) return ''
  const columns = Object.keys(rows[0])
  const cell = value => `"${(typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')).replaceAll('"', '""')}"`
  return [columns.map(cell).join(','), ...rows.map(row => columns.map(key => cell(row[key])).join(','))].join('\n')
}

function statusText(value) {
  const exp = value.currentExperiment
  return [
    'Q2ML PROJECT STATUS', '',
    `Project: ${value.project.displayName}`,
    `Branch: ${value.project.branch}`,
    `Progress: ${value.progress === null ? 'not set' : `${value.progress}%`}`, '',
    `Experiment: ${exp?.name || 'none'}`,
    `Type: ${exp?.type || '—'}`,
    `Status: ${exp?.status || '—'}`,
    `Result: ${exp?.result || '—'}`, '',
    `History: ${value.historyCount} experiments`,
    `Last result: ${value.lastResult || '—'}`,
  ].join('\n')
}

const help = `mods commands:
  doctor
  install --host auto|claude|codex [--project PATH] [--apply]
  uninstall --host claude|codex [--project PATH] [--apply]
  status [--format text|json] [--cwd PATH]
  progress <0-100> [--host claude|codex|cli]
  experiment create <name> --type initial|fix|develop [--description TEXT]
  experiment start|cancel|resume|interrupt <id>
  experiment finish <id> --result success|fail|inconclusive
  experiment update <id> [--description TEXT] [--metadata JSON]
  experiment show <id>
  experiment compare <left-id> <right-id>
  history [--project current] [--branch current] [--limit 20] [--format text|json|csv]
  export [--format json|csv]
  mcp

Storage overrides: MODS_STATE_DIR or MODS_DATABASE_PATH.`

export async function main(argv, io = process) {
  const { positional: p, flags: f } = options(argv)
  const command = p[0]
  if (!command || ['help', '-h', '--help'].includes(command)) { io.stdout.write(`${help}\n`); return }
  if (command === 'mcp') { const { serve } = await import('../../mcp-server/src/server.mjs'); await serve(); return }
  if (command === 'doctor') {
    const engine = new ExperimentEngine()
    try {
      const report = { node: process.version, platform: process.platform, database: defaultDatabasePath(), integrity: engine.database.integrityCheck(), schemaVersion: 1 }
      io.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } finally { engine.close() }
    return
  }
  if (command === 'install' || command === 'uninstall') {
    const operation = command === 'install' ? install : uninstall
    const result = operation({ requestedHost: f.host || 'auto', project: f.project || process.cwd(), apply: Boolean(f.apply) })
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  const engine = new ExperimentEngine()
  const cwd = f.cwd || process.cwd(); const host = f.host || 'cli'; const branch = f.branch === 'current' ? undefined : f.branch
  try {
    let result
    if (command === 'bridge' && p[1] === 'sync-legacy') {
      result = engine.applyLegacyState({ cwd, branch, tracked: JSON.parse(String(f.state || '{}')), host })
      io.stdout.write(`${JSON.stringify(result)}\n`); return
    }
    if (command === 'status') {
      result = engine.getProjectStatus({ cwd, branch })
      io.stdout.write(f.format === 'json' ? `${JSON.stringify(result, null, 2)}\n` : `${statusText(result)}\n`); return
    }
    if (command === 'progress') result = engine.setProgress({ cwd, branch, progress: Number(p[1]), host })
    else if (command === 'experiment') {
      const action = p[1]; const id = p[2]
      if (action === 'create') result = engine.createExperiment({ cwd, branch, name: p.slice(2).join(' '), type: f.type, description: f.description, metadata: f.metadata ? JSON.parse(f.metadata) : {}, host, idempotencyKey: f['idempotency-key'] })
      else if (action === 'show') result = { experiment: engine.getExperiment(id), history: engine.getHistory(id) }
      else if (action === 'compare') result = engine.compareExperiments(id, p[3])
      else if (action === 'start') result = engine.startExperiment(id, { host, idempotencyKey: f['idempotency-key'] })
      else if (action === 'finish') result = engine.finishExperiment(id, { host, result: f.result, idempotencyKey: f['idempotency-key'] })
      else if (action === 'cancel') result = engine.cancelExperiment(id, { host, idempotencyKey: f['idempotency-key'] })
      else if (action === 'interrupt') result = engine.interruptExperiment(id, { host, idempotencyKey: f['idempotency-key'] })
      else if (action === 'resume') result = engine.resumeExperiment(id, { host, idempotencyKey: f['idempotency-key'] })
      else if (action === 'update') result = engine.updateExperiment(id, { host, description: f.description, metadata: f.metadata ? JSON.parse(f.metadata) : undefined, idempotencyKey: f['idempotency-key'] })
      else throw Object.assign(new Error(`Unknown experiment action: ${action}`), { code: 'INVALID_COMMAND' })
    } else if (command === 'history' || command === 'export') {
      const useCurrent = f.project === 'current' || f.branch === 'current'
      result = engine.listExperiments({ cwd: useCurrent ? cwd : undefined, branch, host: f.host, type: f.type, status: f.status, result: f.result, from: f.from, to: f.to, limit: f.limit || (command === 'export' ? 1000 : 20) })
      if (f.format === 'csv') { io.stdout.write(`${csv(result)}\n`); return }
    } else throw Object.assign(new Error(`Unknown command: ${command}`), { code: 'INVALID_COMMAND' })
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } finally { engine.close() }
}
