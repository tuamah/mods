import { atom, read, update } from 'claude-code'
import type { Hook, Register, SessionRateLimit } from 'claude-code'

import type {
  Experiment,
  ExperimentKind,
  ExperimentResult,
  Git,
  Limit,
  Tracked,
  Usage,
} from '../types'

type Dollar = Parameters<Hook<'turn.complete'>>[0]




const git = atom({ plugin: 'project-status', key: 'git' } as const, null)
const usage = atom({ plugin: 'project-status', key: 'usage' } as const, null)
const tracked = atom({ plugin: 'project-status', key: 'tracked' } as const, {
  progress: null,
  experiment: null,
})
const now = atom({ plugin: 'project-status', key: 'now' } as const, 0)
const isHidden = atom({ plugin: 'project-status', key: 'isHidden' } as const, false)

const KINDS: Record<string, ExperimentKind> = {
  initial: 'initial',
  'أولية': 'initial',
  'اولية': 'initial',
  fix: 'fix',
  'تصحيح': 'fix',
  develop: 'develop',
  'تطوير': 'develop',
}

const RESULTS: Record<string, ExperimentResult> = {
  running: 'running',
  'جارية': 'running',
  success: 'success',
  'نجاح': 'success',
  fail: 'fail',
  'فشل': 'fail',
}

const KIND_LABEL: Record<ExperimentKind, string> = {
  initial: 'أولية',
  fix: 'تصحيح لفشل سابق',
  develop: 'تطوير لتجربة ناجحة',
}

const RESULT_LABEL: Record<ExperimentResult, string> = {
  running: 'قيد التنفيذ',
  success: 'نجاح',
  fail: 'فشل',
}

export function experimentLabel(exp: Experiment): string {
  if (exp.kind === 'initial') {
    if (exp.result === 'success') return 'نجاح أولي'
    if (exp.result === 'fail') return 'فشل أولي'
    return 'أولية · قيد التنفيذ'
  }

  return `${KIND_LABEL[exp.kind]} · ${RESULT_LABEL[exp.result]}`
}

export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  if (days > 0) return `${days}ي ${hours}س`
  if (hours > 0) return `${hours}س ${rest}د`

  return `${rest}د`
}

export function bar(percent: number, cells = 10): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * cells)

  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

function limitOf(limits: readonly SessionRateLimit[], kind: string): Limit | null {
  const found = limits.find(one => one.kind === kind)

  return found ? { percentUsed: found.percentUsed, resetsAt: found.resetsAt } : null
}

function usageColor(percent: number): 'error' | 'warning' | 'success' {
  if (percent >= 90) return 'error'
  if (percent >= 70) return 'warning'

  return 'success'
}

const RESULT_COLOR: Record<ExperimentResult, 'warning' | 'success' | 'error'> = {
  running: 'warning',
  success: 'success',
  fail: 'error',
}

function storeKey(info: Git | null): string {
  return `tracked:${info?.project ?? '?'}:${info?.branch ?? '?'}`
}

async function run($: Dollar, argv: string[]): Promise<string> {
  try {
    const out = await $.process.run(argv, { timeoutMs: 5000 })

    return out.exitCode === 0 ? out.stdout.trim() : ''
  } catch {
    return ''
  }
}

async function refreshGit($: Dollar) {
  const cwd = await $.session.cwd()
  const remote = await run($, ['git', 'config', '--get', 'remote.origin.url'])
  const top = await run($, ['git', 'rev-parse', '--show-toplevel'])
  const base = (remote || top || cwd).replace(/\.git$/, '').split(/[\\/:]/)
  const branch =
    (await run($, ['git', 'branch', '--show-current'])) ||
    (await run($, ['git', 'rev-parse', '--short', 'HEAD'])) ||
    '—'
  const info: Git = { project: base[base.length - 1] || cwd, branch }
  const before = await read($, git)
  await update($, git, () => info)

  if (storeKey(before) !== storeKey(info)) {
    const saved = (await $.store.get(storeKey(info))) as Tracked | undefined
    await update($, tracked, () => saved ?? { progress: null, experiment: null })
  }
}

async function setUsage(
  $: Dollar,
  limits: readonly SessionRateLimit[],
  startedAt?: number,
) {
  await update($, usage, old => ({
    startedAt: startedAt ?? old?.startedAt ?? 0,
    fiveHour: limitOf(limits, 'five_hour') ?? old?.fiveHour ?? null,
    weekly: limitOf(limits, 'seven_day') ?? old?.weekly ?? null,
  }))
}

async function saveTracked(
  $: Dollar,
  fn: (old: Tracked) => Tracked,
) {
  const next = await update($, tracked, fn)
  await $.store.set(storeKey(await read($, git)), next)

  return next
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'status',
      description:
        'Project status band: /status progress 40 | /status exp T5 develop success | /status result fail | /status clear | /status hide | /status show',
    })
    await $.tool.register({
      name: 'set_status',
      description:
        "Update the project-status band shown above the person's prompt. Call it when the work's overall progress changes noticeably, and whenever an experiment starts or its outcome is known. kind: initial = first run of a new experiment; fix = a corrected re-run of an experiment that failed; develop = a further development of an experiment that succeeded. result: running, success or fail.",
      inputSchema: {
        type: 'object',
        properties: {
          progress: { type: 'number', minimum: 0, maximum: 100, description: 'Overall completion of the current task, percent' },
          experiment: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              kind: { type: 'string', enum: ['initial', 'fix', 'develop'] },
              result: { type: 'string', enum: ['running', 'success', 'fail'] },
            },
            required: ['name', 'kind', 'result'],
          },
          clear_experiment: { type: 'boolean' },
        },
      },
      isDeferred: false,
    })

    await refreshGit($)
    const measured = await $.session.usage()
    await setUsage($, measured.rateLimits, measured.startedAt)
    const ms = await $.clock.now()
    await update($, now, () => ms)
    $.clock.every(30000, () => {
      void $.clock.now().then(ms => update($, now, () => ms))
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await setUsage($, e.rateLimits)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refreshGit($)
    const ms = await $.clock.now()
    await update($, now, () => ms)

    return next(e)
  })

  on('tool.call', { tool: 'mcp__project-status__set_status' }, async ($, e) => {
    const args = e as unknown as {
      progress?: number
      experiment?: Experiment
      clear_experiment?: boolean
    }
    const exp = args.experiment
    if (exp && (!KINDS[exp.kind] || !RESULTS[exp.result] || !exp.name)) {
      return { deny: 'experiment needs name, kind (initial|fix|develop) and result (running|success|fail)' }
    }
    const saved = await saveTracked($, old => ({
      progress:
        typeof args.progress === 'number'
          ? Math.round(Math.min(100, Math.max(0, args.progress)))
          : old.progress,
      experiment: args.clear_experiment ? null : (exp ?? old.experiment),
    }))

    return { result: `Status band updated: ${JSON.stringify(saved)}` }
  })

  on('command.run', { command: 'status' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)

    if (verb === 'hide' || verb === 'show') {
      await update($, isHidden, () => verb === 'hide')

      return { text: verb === 'hide' ? 'Status band hidden.' : 'Status band shown.' }
    }

    if (verb === 'clear') {
      await saveTracked($, () => ({ progress: null, experiment: null }))

      return { text: 'Progress and experiment cleared.' }
    }

    if (verb === 'progress' || /^\d+%?$/.test(verb)) {
      const value = Number((verb === 'progress' ? rest[0] : verb)?.replace('%', ''))
      if (!Number.isFinite(value)) return { text: 'Usage: /status progress 40' }
      await saveTracked($, old => ({ ...old, progress: Math.round(Math.min(100, Math.max(0, value))) }))

      return { text: `Progress set to ${Math.round(Math.min(100, Math.max(0, value)))}%.` }
    }

    if (verb === 'exp') {
      const result = RESULTS[rest[rest.length - 1] ?? '']
      const kind = KINDS[rest[rest.length - 2] ?? '']
      const name = rest.slice(0, -2).join(' ')
      if (!result || !kind || !name) {
        return { text: 'Usage: /status exp <name> <initial|fix|develop> <running|success|fail>' }
      }
      await saveTracked($, old => ({ ...old, experiment: { name, kind, result } }))

      return { text: `Experiment ${name}: ${experimentLabel({ name, kind, result })}` }
    }

    if (verb === 'result') {
      const result = RESULTS[rest[0] ?? '']
      const current = (await read($, tracked)).experiment
      if (!result || !current) return { text: 'Usage: /status result <running|success|fail> (needs an experiment set)' }
      await saveTracked($, old => ({ ...old, experiment: { ...current, result } }))

      return { text: `Experiment ${current.name}: ${experimentLabel({ ...current, result })}` }
    }

    const state = await read($, tracked)
    const info = await read($, git)

    return {
      text: [
        `Project ${info?.project ?? '—'} · branch ${info?.branch ?? '—'}`,
        `Progress: ${state.progress === null ? 'not set' : `${state.progress}%`}`,
        `Experiment: ${state.experiment ? `${state.experiment.name} — ${experimentLabel(state.experiment)}` : 'none'}`,
        'Commands: progress N | exp <name> <initial|fix|develop> <running|success|fail> | result <r> | clear | hide | show',
      ].join('\n'),
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const info = await read($, git)
    const state = await read($, tracked)
    const use: Usage | null = await read($, usage)
    const at = (await read($, now)) || (await $.clock.now())
    const resets = (limit: Limit) =>
      limit.resetsAt ? ` (يتجدد بعد ${duration(Date.parse(limit.resetsAt) - at)})` : ''

    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>المشروع </Text>
          <Text bold>{info?.project ?? '—'}</Text>
          <Text dimColor>  الفرع </Text>
          <Text color="suggestion">{info?.branch ?? '—'}</Text>
          <Text dimColor>  الإنجاز </Text>
          {state.progress === null ? (
            <Text dimColor>غير محدد</Text>
          ) : (
            <Text color="claude">
              {bar(state.progress)} {state.progress}%
            </Text>
          )}
          <Text dimColor>  الوقت </Text>
          <Text>{use?.startedAt ? duration(at - use.startedAt) : '—'}</Text>
        </Box>
        <Box>
          <Text dimColor>التجربة </Text>
          {state.experiment ? (
            <Text>
              <Text bold>{state.experiment.name}</Text>
              <Text>: </Text>
              <Text color={RESULT_COLOR[state.experiment.result]}>
                {experimentLabel(state.experiment)}
              </Text>
            </Text>
          ) : (
            <Text dimColor>لا توجد</Text>
          )}
          <Text dimColor>  جلسة 5 ساعات </Text>
          {use?.fiveHour ? (
            <Text color={usageColor(use.fiveHour.percentUsed)}>
              {use.fiveHour.percentUsed}%{resets(use.fiveHour)}
            </Text>
          ) : (
            <Text dimColor>—</Text>
          )}
          <Text dimColor>  الأسبوعي </Text>
          {use?.weekly ? (
            <Text color={usageColor(use.weekly.percentUsed)}>
              {use.weekly.percentUsed}%{resets(use.weekly)}
            </Text>
          ) : (
            <Text dimColor>—</Text>
          )}
        </Box>
      </Box>
    )
  })
}
