import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { bar, duration, experimentLabel } from '../hooks/register'

const SURFACES = ['terminal', 'desktop'] as const
const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }
const RUN = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } }

// Stand in for the engine: an in-memory store and an empty default band.
function engine(on: On) {
  const kept = new Map<string, unknown>()
  on('store.get', async (_$, e) => ({ value: kept.get(e.key) }))
  on('store.set', async (_$, e) => {
    kept.set(e.key, e.value)

    return { value: undefined }
  })
  on('clock.now', async () => ({ value: 1_800_000_000_000 }))
  on('ui.render', async ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
}

test('labels the five experiment states in Arabic', () => {
  expect(experimentLabel({ name: 'T1', kind: 'initial', result: 'running' })).toBe('أولية · قيد التنفيذ')
  expect(experimentLabel({ name: 'T1', kind: 'initial', result: 'success' })).toBe('نجاح أولي')
  expect(experimentLabel({ name: 'T1', kind: 'initial', result: 'fail' })).toBe('فشل أولي')
  expect(experimentLabel({ name: 'T2', kind: 'fix', result: 'success' })).toBe('تصحيح لفشل سابق · نجاح')
  expect(experimentLabel({ name: 'T3', kind: 'develop', result: 'fail' })).toBe('تطوير لتجربة ناجحة · فشل')
})

test('formats durations and the progress bar', () => {
  expect(duration(45 * 60000)).toBe('45د')
  expect(duration(125 * 60000)).toBe('2س 5د')
  expect(duration((3 * 1440 + 4 * 60) * 60000)).toBe('3ي 4س')
  expect(bar(40)).toBe('▰▰▰▰▱▱▱▱▱▱')
})

test('/pstatus sets progress and experiment and the band shows them', async ($, on) => {
  engine(on)
  await $.command.run({ ...RUN, command: 'pstatus', args: 'progress 40' })
  await $.command.run({ ...RUN, command: 'pstatus', args: 'exp T5 develop success' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'project-status',
      surface,
      component: 'AbovePrompt',
      props: BAND,
    })
    expect(await ui.find({ text: /40%/ })).toBeDefined()
    expect(await ui.find({ text: /تطوير لتجربة ناجحة · نجاح/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/pstatus hide leaves the band to the engine', async ($, on) => {
  engine(on)
  await $.command.run({ ...RUN, command: 'pstatus', args: 'hide' })
  const ui = await $.ui.mount({
    plugin: 'project-status',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND,
  })
  expect(await ui.find({ text: /الإنجاز/ })).toBeUndefined()
})
