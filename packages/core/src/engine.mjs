import crypto from 'node:crypto'
import { ModsDatabase } from './database.mjs'
import { invariant, ModsError } from './errors.mjs'
import { resolveProjectIdentity } from './identity.mjs'

const TYPES = new Set(['initial', 'fix', 'develop'])
const RESULTS = new Set(['pending', 'success', 'fail', 'inconclusive'])
const TRANSITIONS = {
  pending: new Set(['running', 'cancelled']),
  running: new Set(['completed', 'cancelled', 'interrupted']),
  interrupted: new Set(['running', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
}

const now = () => new Date().toISOString()
const parse = value => typeof value === 'string' ? JSON.parse(value) : value
const state = row => row && ({ ...row, metadata: parse(row.metadata) })
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const SENSITIVE_KEY = /(^|_)(api[_-]?key|token|secret|password|credential|conversation|transcript)(_|$)/i

function validateMetadata(value, prefix = '') {
  invariant(value && typeof value === 'object', 'INVALID_METADATA', 'Metadata must be an object')
  if (Array.isArray(value)) {
    for (const [index, nested] of value.entries()) if (nested && typeof nested === 'object') validateMetadata(nested, `${prefix}[${index}]`)
    return
  }
  for (const [key, nested] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key
    invariant(!SENSITIVE_KEY.test(key), 'SENSITIVE_METADATA', `Sensitive metadata field is not allowed: ${name}`)
    if (nested && typeof nested === 'object') validateMetadata(nested, name)
  }
}

export class ExperimentEngine {
  constructor(options = {}) {
    this.database = options.database || new ModsDatabase(options)
    this.ownsDatabase = !options.database
  }

  close() { if (this.ownsDatabase) this.database.close() }

  resolveProject({ cwd = process.cwd(), branch, host = 'cli' } = {}) {
    const identity = resolveProjectIdentity(cwd)
    if (branch) identity.branch = branch
    const at = now()
    this.database.db.prepare(`INSERT INTO projects(project_id,identity_key,display_name,canonical_path,remote_url,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET display_name=excluded.display_name,canonical_path=excluded.canonical_path,remote_url=excluded.remote_url,updated_at=excluded.updated_at`)
      .run(identity.projectId, identity.identityKey, identity.displayName, identity.canonicalPath, identity.remoteUrl, at, at)
    this.database.db.prepare('INSERT OR REPLACE INTO project_aliases(alias_path,project_id,created_at) VALUES (?,?,?)')
      .run(identity.canonicalPath, identity.projectId, at)
    this.database.db.prepare(`INSERT INTO project_status(project_id,branch,progress,current_experiment_id,display_experiment_id,updated_at,updated_by_host)
      VALUES (?,?,NULL,NULL,NULL,?,?) ON CONFLICT(project_id,branch) DO NOTHING`).run(identity.projectId, identity.branch, at, host)
    return identity
  }

  #idempotent(operation, key, request, fn) {
    if (!key) return fn()
    invariant(typeof key === 'string' && key.length <= 200, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency key must be a string of at most 200 characters')
    const requestHash = hash(request)
    const old = this.database.db.prepare('SELECT * FROM idempotency WHERE idempotency_key=?').get(key)
    if (old) {
      invariant(old.operation === operation && old.request_hash === requestHash, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different request')
      return parse(old.response)
    }
    const response = fn()
    this.database.db.prepare('INSERT INTO idempotency VALUES (?,?,?,?,?)').run(key, operation, requestHash, JSON.stringify(response), now())
    return response
  }

  #event(experimentId, host, operation, previousState, newState, metadata = {}) {
    this.database.db.prepare('INSERT INTO experiment_events VALUES (?,?,?,?,?,?,?,?)').run(
      `evt_${crypto.randomUUID()}`, experimentId, now(), host, operation,
      previousState ? JSON.stringify(previousState) : null, JSON.stringify(newState), JSON.stringify(metadata),
    )
  }

  setProgress({ cwd, branch, progress, host = 'cli' }) {
    invariant(Number.isFinite(progress), 'INVALID_PROGRESS', 'Progress must be a number')
    const project = this.resolveProject({ cwd, branch, host })
    const value = Math.round(Math.min(100, Math.max(0, progress)))
    this.database.db.prepare('UPDATE project_status SET progress=?,updated_at=?,updated_by_host=? WHERE project_id=? AND branch=?')
      .run(value, now(), host, project.projectId, project.branch)
    return this.getProjectStatus({ cwd, branch: project.branch })
  }

  clearProjectStatus({ cwd, branch, host = 'cli' } = {}) {
    const project = this.resolveProject({ cwd, branch, host })
    this.database.db.prepare('UPDATE project_status SET progress=NULL,current_experiment_id=NULL,display_experiment_id=NULL,updated_at=?,updated_by_host=? WHERE project_id=? AND branch=?')
      .run(now(), host, project.projectId, project.branch)
    return this.getProjectStatus({ cwd, branch: project.branch })
  }

  getProjectStatus({ cwd, branch } = {}) {
    const project = resolveProjectIdentity(cwd || process.cwd())
    if (branch) project.branch = branch
    const status = this.database.db.prepare('SELECT * FROM project_status WHERE project_id=? AND branch=?').get(project.projectId, project.branch)
    if (!status) return { project, progress: null, currentExperiment: null, displayExperiment: null, historyCount: 0, lastResult: null, updatedAt: null }
    const current = status.current_experiment_id ? this.getExperiment(status.current_experiment_id) : null
    const displayed = status.display_experiment_id ? this.getExperiment(status.display_experiment_id) : null
    const summary = this.database.db.prepare(`SELECT COUNT(*) count,
      (SELECT result FROM experiments WHERE project_id=? AND branch=? AND status='completed' ORDER BY finished_at DESC LIMIT 1) last_result
      FROM experiments WHERE project_id=? AND branch=?`).get(project.projectId, project.branch, project.projectId, project.branch)
    return { project, progress: status.progress, currentExperiment: current, displayExperiment: displayed, historyCount: Number(summary.count), lastResult: summary.last_result || null, updatedAt: status.updated_at }
  }

  createExperiment(input) {
    const { cwd, branch, name, type, description = '', metadata = {}, host = 'cli', idempotencyKey } = input
    invariant(typeof name === 'string' && name.trim(), 'INVALID_NAME', 'Experiment name is required')
    invariant(TYPES.has(type), 'INVALID_TYPE', 'Type must be initial, fix, or develop')
    validateMetadata(metadata)
    const project = this.resolveProject({ cwd, branch, host })
    const request = { projectId: project.projectId, branch: project.branch, name, type, description, metadata, host }
    return this.database.transaction(() => this.#idempotent('create_experiment', idempotencyKey, request, () => {
      const at = now(); const experimentId = `exp_${crypto.randomUUID()}`
      this.database.db.prepare(`INSERT INTO experiments VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        experimentId, project.projectId, project.branch, name.trim(), type, 'pending', 'pending', description,
        at, null, null, at, host, host, JSON.stringify(metadata),
      )
      const created = this.getExperiment(experimentId)
      this.#event(experimentId, host, 'create', null, created)
      return created
    }))
  }

  getExperiment(experimentId) {
    const row = this.database.db.prepare('SELECT * FROM experiments WHERE experiment_id=?').get(experimentId)
    invariant(row, 'EXPERIMENT_NOT_FOUND', `Experiment not found: ${experimentId}`)
    return state(row)
  }

  #transition(experimentId, nextStatus, { host = 'cli', result, metadata = {}, idempotencyKey } = {}) {
    return this.database.transaction(() => this.#idempotent(`transition:${nextStatus}`, idempotencyKey, { experimentId, nextStatus, host, result, metadata }, () => {
      const previous = this.getExperiment(experimentId)
      invariant(TRANSITIONS[previous.status]?.has(nextStatus), 'INVALID_TRANSITION', `Cannot transition ${previous.status} to ${nextStatus}`)
      const at = now()
      const nextResult = nextStatus === 'completed' ? result : previous.result
      if (nextStatus === 'completed') invariant(RESULTS.has(result) && result !== 'pending', 'INVALID_RESULT', 'Completed experiments require success, fail, or inconclusive')
      this.database.db.prepare(`UPDATE experiments SET status=?,result=?,started_at=?,finished_at=?,updated_at=?,last_updated_by_host=?,metadata=? WHERE experiment_id=?`).run(
        nextStatus, nextResult,
        nextStatus === 'running' ? (previous.started_at || at) : previous.started_at,
        ['completed','cancelled'].includes(nextStatus) ? at : previous.finished_at,
        at, host, JSON.stringify({ ...previous.metadata, ...metadata }), experimentId,
      )
      if (nextStatus === 'running') {
        this.database.db.prepare('UPDATE project_status SET current_experiment_id=?,display_experiment_id=?,updated_at=?,updated_by_host=? WHERE project_id=? AND branch=?')
          .run(experimentId, experimentId, at, host, previous.project_id, previous.branch)
      } else if (['completed','cancelled'].includes(nextStatus)) {
        this.database.db.prepare('UPDATE project_status SET current_experiment_id=NULL,updated_at=?,updated_by_host=? WHERE project_id=? AND branch=? AND current_experiment_id=?')
          .run(at, host, previous.project_id, previous.branch, experimentId)
      }
      const next = this.getExperiment(experimentId)
      this.#event(experimentId, host, nextStatus, previous, next, metadata)
      return next
    }))
  }

  startExperiment(id, options) { return this.#transition(id, 'running', options) }
  finishExperiment(id, options) { return this.#transition(id, 'completed', options) }
  cancelExperiment(id, options) { return this.#transition(id, 'cancelled', options) }
  interruptExperiment(id, options) { return this.#transition(id, 'interrupted', options) }
  resumeExperiment(id, options) { return this.#transition(id, 'running', options) }

  updateExperiment(id, { description, metadata, host = 'cli', idempotencyKey } = {}) {
    if (metadata !== undefined) validateMetadata(metadata)
    return this.database.transaction(() => this.#idempotent('update_experiment', idempotencyKey, { id, description, metadata, host }, () => {
      const previous = this.getExperiment(id); const at = now()
      this.database.db.prepare('UPDATE experiments SET description=?,metadata=?,updated_at=?,last_updated_by_host=? WHERE experiment_id=?').run(
        description ?? previous.description, JSON.stringify({ ...previous.metadata, ...(metadata || {}) }), at, host, id,
      )
      const next = this.getExperiment(id); this.#event(id, host, 'update', previous, next, metadata || {})
      return next
    }))
  }

  correctExperimentResult(id, { result, host = 'cli', metadata = {}, idempotencyKey } = {}) {
    invariant(RESULTS.has(result) && result !== 'pending', 'INVALID_RESULT', 'Corrected result must be success, fail, or inconclusive')
    validateMetadata(metadata)
    return this.database.transaction(() => this.#idempotent('correct_result', idempotencyKey, { id, result, host, metadata }, () => {
      const previous = this.getExperiment(id)
      invariant(previous.status === 'completed', 'INVALID_TRANSITION', 'Only a completed experiment result can be corrected')
      this.database.db.prepare('UPDATE experiments SET result=?,updated_at=?,last_updated_by_host=?,metadata=? WHERE experiment_id=?')
        .run(result, now(), host, JSON.stringify({ ...previous.metadata, ...metadata }), id)
      const next = this.getExperiment(id)
      this.#event(id, host, 'correct_result', previous, next, metadata)
      return next
    }))
  }

  listExperiments(filters = {}) {
    const where = []; const values = []
    const project = filters.cwd ? this.resolveProject({ cwd: filters.cwd, branch: filters.branch, host: 'read' }) : null
    for (const [column, value] of [['project_id', filters.projectId || project?.projectId], ['branch', filters.branch], ['last_updated_by_host', filters.host], ['type', filters.type], ['status', filters.status], ['result', filters.result]]) {
      if (value) { where.push(`${column}=?`); values.push(value) }
    }
    if (filters.from) { where.push('updated_at>=?'); values.push(filters.from) }
    if (filters.to) { where.push('updated_at<=?'); values.push(filters.to) }
    const limit = Math.min(1000, Math.max(1, Number(filters.limit || 20)))
    return this.database.db.prepare(`SELECT * FROM experiments ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`).all(...values, limit).map(state)
  }

  getHistory(experimentId) {
    return this.database.db.prepare('SELECT * FROM experiment_events WHERE experiment_id=? ORDER BY timestamp,rowid').all(experimentId).map(row => ({ ...row, previous_state: row.previous_state ? parse(row.previous_state) : null, new_state: parse(row.new_state), metadata: parse(row.metadata) }))
  }

  compareExperiments(leftId, rightId) {
    const left = this.getExperiment(leftId); const right = this.getExperiment(rightId)
    const changed = {}
    for (const key of Object.keys(left)) {
      if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) changed[key] = { left: left[key], right: right[key] }
    }
    return { left, right, changed }
  }

  importLegacySnapshot({ cwd, branch, tracked, host = 'claude', source = 'claude-plugin-store' }) {
    invariant(tracked && typeof tracked === 'object', 'INVALID_LEGACY_DATA', 'Legacy tracked state is required')
    const project = this.resolveProject({ cwd, branch, host })
    const migrationId = `legacy-v1:${project.projectId}:${project.branch}:${hash({ tracked, source })}`
    const prior = this.database.db.prepare('SELECT migration_id FROM migrations WHERE migration_id=?').get(migrationId)
    if (prior) return { imported: false, migrationId, reason: 'already-imported' }
    return this.database.transaction(() => {
      if (typeof tracked.progress === 'number') this.setProgress({ cwd, branch: project.branch, progress: tracked.progress, host })
      let experiment = null
      if (tracked.experiment?.name) {
        const legacy = tracked.experiment
        experiment = this.createExperiment({
          cwd, branch: project.branch, name: legacy.name,
          type: TYPES.has(legacy.kind) ? legacy.kind : 'initial',
          description: 'Imported from legacy project-status state; no historical events were available.',
          metadata: { imported: true, source, legacy_result: legacy.result || null }, host,
          idempotencyKey: migrationId,
        })
        if (legacy.result === 'running') experiment = this.startExperiment(experiment.experiment_id, { host, idempotencyKey: `${migrationId}:start` })
        if (legacy.result === 'success' || legacy.result === 'fail') {
          this.startExperiment(experiment.experiment_id, { host, idempotencyKey: `${migrationId}:start` })
          experiment = this.finishExperiment(experiment.experiment_id, { host, result: legacy.result, idempotencyKey: `${migrationId}:finish`, metadata: { imported: true } })
        }
      }
      this.database.db.prepare('INSERT INTO migrations VALUES (?,?,?)').run(migrationId, now(), JSON.stringify({ source, projectId: project.projectId, branch: project.branch }))
      return { imported: true, migrationId, experiment }
    })
  }

  applyLegacyState({ cwd, branch, tracked, host = 'claude' }) {
    invariant(tracked && typeof tracked === 'object', 'INVALID_LEGACY_DATA', 'Tracked state is required')
    if (tracked.progress === null && tracked.experiment === null) return this.clearProjectStatus({ cwd, branch, host })
    if (typeof tracked.progress === 'number') this.setProgress({ cwd, branch, progress: tracked.progress, host })
    const wanted = tracked.experiment
    if (!wanted?.name) return this.getProjectStatus({ cwd, branch })
    invariant(TYPES.has(wanted.kind), 'INVALID_TYPE', 'Legacy experiment kind is invalid')
    invariant(['running', 'success', 'fail'].includes(wanted.result), 'INVALID_RESULT', 'Legacy experiment result is invalid')
    let record = this.listExperiments({ cwd, branch, limit: 1 })[0]
    if (!record || record.name !== wanted.name || record.type !== wanted.kind) {
      record = this.createExperiment({ cwd, branch, name: wanted.name, type: wanted.kind, host })
    }
    if (wanted.result === 'running') {
      if (record.status === 'pending') this.startExperiment(record.experiment_id, { host })
      else if (record.status === 'interrupted') this.resumeExperiment(record.experiment_id, { host })
    } else {
      if (record.status === 'pending') record = this.startExperiment(record.experiment_id, { host })
      if (record.status === 'running') this.finishExperiment(record.experiment_id, { host, result: wanted.result })
      else if (record.status === 'completed' && record.result !== wanted.result) {
        this.correctExperimentResult(record.experiment_id, { host, result: wanted.result, metadata: { corrected_via: 'legacy_bridge' } })
      }
    }
    return this.getProjectStatus({ cwd, branch })
  }
}

export { ModsError }
