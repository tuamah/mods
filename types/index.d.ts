export type ExperimentKind = 'initial' | 'fix' | 'develop'
export type ExperimentResult = 'running' | 'success' | 'fail'
export type Experiment = { name: string; kind: ExperimentKind; result: ExperimentResult }
export type Git = { project: string; branch: string }
export type Limit = { percentUsed: number; resetsAt?: string }
export type Usage = { startedAt: number; fiveHour: Limit | null; weekly: Limit | null }
export type Tracked = { progress: number | null; experiment: Experiment | null }

declare module 'claude-code' {
  interface PluginState {
    'project-status': {
      git: Git | null
      usage: Usage | null
      tracked: Tracked
      now: number
      isHidden: boolean
    }
  }
}
