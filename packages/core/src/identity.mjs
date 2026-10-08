import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

export function normalizeRemote(remote) {
  return remote
    .trim()
    .replace(/^git@([^:]+):/, 'ssh://$1/')
    .replace(/\.git$/i, '')
    .replace(/\\/g, '/')
    .toLowerCase()
}

function stableId(identityKey) {
  return `prj_${crypto.createHash('sha256').update(identityKey).digest('hex').slice(0, 24)}`
}

export function resolveProjectIdentity(cwd = process.cwd()) {
  const resolvedPath = path.resolve(cwd)
  let canonicalPath = resolvedPath
  try { canonicalPath = fs.realpathSync.native(resolvedPath) } catch {}
  const root = git(canonicalPath, ['rev-parse', '--show-toplevel'])
  const branch = git(canonicalPath, ['branch', '--show-current']) || git(canonicalPath, ['rev-parse', '--short', 'HEAD']) || '—'
  const remote = normalizeRemote(git(canonicalPath, ['config', '--get', 'remote.origin.url']))
  const gitCommon = git(canonicalPath, ['rev-parse', '--git-common-dir'])
  let repositoryRoot = root || canonicalPath
  try { repositoryRoot = fs.realpathSync.native(repositoryRoot) } catch { repositoryRoot = path.resolve(repositoryRoot) }
  const identityKey = remote
    ? `git-remote:${remote}`
    : root
      ? `git-common:${path.resolve(repositoryRoot, gitCommon).replace(/\\/g, '/').toLowerCase()}`
      : `path:${canonicalPath.replace(/\\/g, '/').toLowerCase()}`
  const displayName = remote ? remote.split('/').at(-1) : path.basename(repositoryRoot)
  return {
    projectId: stableId(identityKey),
    identityKey,
    displayName,
    canonicalPath: repositoryRoot,
    remoteUrl: remote || null,
    branch,
    isGit: Boolean(root),
  }
}
