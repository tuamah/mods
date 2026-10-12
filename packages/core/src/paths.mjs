import os from 'node:os'
import path from 'node:path'

export function defaultStateDirectory(env = process.env, platform = process.platform, home = os.homedir()) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  if (env.MODS_STATE_DIR) return pathApi.resolve(env.MODS_STATE_DIR)
  if (platform === 'win32') return pathApi.join(env.LOCALAPPDATA || pathApi.join(home, 'AppData', 'Local'), 'tuamah-mods')
  if (platform === 'darwin') return pathApi.join(home, 'Library', 'Application Support', 'tuamah-mods')
  return pathApi.join(env.XDG_STATE_HOME || pathApi.join(home, '.local', 'state'), 'tuamah-mods')
}

export function defaultDatabasePath(options = {}) {
  if (options.databasePath) return path.resolve(options.databasePath)
  if (options.env?.MODS_DATABASE_PATH || process.env.MODS_DATABASE_PATH) {
    return path.resolve(options.env?.MODS_DATABASE_PATH || process.env.MODS_DATABASE_PATH)
  }
  return path.join(defaultStateDirectory(options.env, options.platform, options.home), 'experiments.sqlite3')
}
