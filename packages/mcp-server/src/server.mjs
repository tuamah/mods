import readline from 'node:readline'
import { ExperimentEngine } from '../../core/src/index.mjs'

const tools = [
  ['get_project_status', 'Read project status', { cwd: { type: 'string' }, branch: { type: 'string' } }],
  ['set_project_progress', 'Set project progress from 0 to 100', { cwd: { type: 'string' }, branch: { type: 'string' }, progress: { type: 'number' }, host: { type: 'string' } }, ['progress']],
  ['create_experiment', 'Create a pending experiment', { cwd: { type: 'string' }, branch: { type: 'string' }, name: { type: 'string' }, type: { type: 'string', enum: ['initial','fix','develop'] }, description: { type: 'string' }, metadata: { type: 'object' }, host: { type: 'string' }, idempotencyKey: { type: 'string' } }, ['name','type']],
  ['start_experiment', 'Start a pending experiment', { experimentId: { type: 'string' }, host: { type: 'string' }, idempotencyKey: { type: 'string' } }, ['experimentId']],
  ['update_experiment', 'Update description or metadata', { experimentId: { type: 'string' }, description: { type: 'string' }, metadata: { type: 'object' }, host: { type: 'string' }, idempotencyKey: { type: 'string' } }, ['experimentId']],
  ['finish_experiment', 'Complete an experiment with an outcome', { experimentId: { type: 'string' }, result: { type: 'string', enum: ['success','fail','inconclusive'] }, host: { type: 'string' }, idempotencyKey: { type: 'string' } }, ['experimentId','result']],
  ['get_current_experiment', 'Read the current experiment', { cwd: { type: 'string' }, branch: { type: 'string' } }],
  ['list_experiments', 'List and filter experiments', { cwd: { type: 'string' }, branch: { type: 'string' }, host: { type: 'string' }, type: { type: 'string' }, status: { type: 'string' }, result: { type: 'string' }, limit: { type: 'number' } }],
  ['get_experiment_history', 'Read append-only events', { experimentId: { type: 'string' } }, ['experimentId']],
  ['get_experiment', 'Read one experiment', { experimentId: { type: 'string' } }, ['experimentId']],
  ['export_experiments', 'Export stable JSON records', { cwd: { type: 'string' }, branch: { type: 'string' }, limit: { type: 'number' } }],
].map(([name, description, properties, required = []]) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false } }))

export function dispatch(engine, name, a = {}) {
  if (name === 'get_project_status') return engine.getProjectStatus(a)
  if (name === 'set_project_progress') return engine.setProgress(a)
  if (name === 'create_experiment') return engine.createExperiment(a)
  if (name === 'start_experiment') return engine.startExperiment(a.experimentId, a)
  if (name === 'update_experiment') return engine.updateExperiment(a.experimentId, a)
  if (name === 'finish_experiment') return engine.finishExperiment(a.experimentId, a)
  if (name === 'get_current_experiment') return engine.getProjectStatus(a).currentExperiment
  if (name === 'list_experiments' || name === 'export_experiments') return engine.listExperiments(a)
  if (name === 'get_experiment_history') return engine.getHistory(a.experimentId)
  if (name === 'get_experiment') return engine.getExperiment(a.experimentId)
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'METHOD_NOT_FOUND' })
}

export async function serve(input = process.stdin, output = process.stdout, options = {}) {
  const engine = new ExperimentEngine(options)
  const lines = readline.createInterface({ input, crlfDelay: Infinity })
  const send = value => output.write(`${JSON.stringify(value)}\n`)
  lines.on('line', line => {
    if (!line.trim()) return
    let message
    try { message = JSON.parse(line) } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return }
    if (message.method === 'notifications/initialized') return
    try {
      let result
      if (message.method === 'initialize') result = { protocolVersion: message.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'tuamah-mods', version: '0.2.0' } }
      else if (message.method === 'tools/list') result = { tools }
      else if (message.method === 'tools/call') {
        const data = dispatch(engine, message.params?.name, message.params?.arguments || {})
        result = { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
      } else throw Object.assign(new Error(`Method not found: ${message.method}`), { rpcCode: -32601 })
      send({ jsonrpc: '2.0', id: message.id, result })
    } catch (error) {
      send({ jsonrpc: '2.0', id: message.id, error: { code: error.rpcCode || -32000, message: error.message, data: { code: error.code || 'INTERNAL_ERROR' } } })
    }
  })
  lines.on('close', () => engine.close())
}

if (import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) serve()
