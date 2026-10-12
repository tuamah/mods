import { ModsError } from '../../core/src/index.mjs'

const HOSTS = new Set(['claude', 'codex'])

export function detectHost(requested = 'auto', env = process.env) {
  if (HOSTS.has(requested)) return { host: requested, source: 'explicit-argument' }
  if (requested !== 'auto') throw new ModsError('INVALID_HOST', 'Host must be auto, claude, or codex')
  if (HOSTS.has(env.MODS_ACTIVE_HOST)) return { host: env.MODS_ACTIVE_HOST, source: 'explicit-wrapper-context' }
  throw new ModsError('AMBIGUOUS_HOST', 'Cannot identify the active host safely. Re-run with --host claude or --host codex.')
}
