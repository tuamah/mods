import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { ExperimentEngine } from '../packages/core/src/index.mjs'

test('concurrent processes serialize writes and preserve integrity', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuamah-mods-concurrency-'))
  const project = path.join(dir, 'project'); const databasePath = path.join(dir, 'shared.sqlite3')
  fs.mkdirSync(project)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const moduleUrl = new URL('../packages/core/src/index.mjs', import.meta.url).href
  const script = `import { ExperimentEngine } from ${JSON.stringify(moduleUrl)}; const e=new ExperimentEngine({databasePath:process.argv[1]}); e.createExperiment({cwd:process.argv[2],name:process.argv[3],type:'initial',host:process.argv[3]}); e.close()`
  const runs = Array.from({ length: 8 }, (_, index) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, databasePath, project, `host-${index}`], { stdio: 'pipe' })
    let error = ''; child.stderr.on('data', chunk => { error += chunk })
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(error || `exit ${code}`)))
  }))
  await Promise.all(runs)
  const engine = new ExperimentEngine({ databasePath })
  assert.equal(engine.listExperiments({ cwd: project, limit: 20 }).length, 8)
  assert.deepEqual(engine.database.integrityCheck(), ['ok'])
  engine.close()
})
