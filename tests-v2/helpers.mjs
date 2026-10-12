import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ExperimentEngine } from '../packages/core/src/index.mjs'

export function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tuamah-mods-test-'))
  const project = path.join(dir, 'project')
  fs.mkdirSync(project)
  const engine = new ExperimentEngine({ databasePath: path.join(dir, 'state', 'test.sqlite3') })
  t.after(() => { engine.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  return { dir, project, engine }
}
