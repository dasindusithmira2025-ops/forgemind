import { describe, expect, it } from 'vitest'
import {
  deriveSyncState,
  diffStat,
  fileStatusGlyph,
  filterFiles,
  groupFiles,
  parseRemoteProjection,
  parseUnifiedDiff,
  relativeTime,
  syncStateLabel,
} from './repositorySelectors'
import type { RemoteProjection, RepositoryFileStatus, RepositorySnapshot } from '../../native/types'

function file(partial: Partial<RepositoryFileStatus> & { path: string }): RepositoryFileStatus {
  return {
    path: partial.path,
    originalPath: partial.originalPath,
    indexStatus: partial.indexStatus ?? ' ',
    worktreeStatus: partial.worktreeStatus ?? ' ',
    conflicted: partial.conflicted ?? false,
    untracked: partial.untracked ?? false,
    renamed: partial.renamed ?? false,
    deleted: partial.deleted ?? false,
    submodule: partial.submodule ?? false,
  }
}

function snapshot(partial: Partial<RepositorySnapshot>): RepositorySnapshot {
  return {
    projectId: 'p1', repositoryPath: '/repo', worktreePath: '/repo', branch: 'main', headSha: 'abc',
    upstream: 'origin/main', ahead: 0, behind: 0, remotes: ['origin'], files: [],
    health: {
      gitAvailable: true, worktreeValid: true, bare: false, shallow: false, mergeInProgress: false,
      rebaseInProgress: false, cherryPickInProgress: false, revertInProgress: false, indexLocked: false,
      submodulesPresent: false, gitLfsAvailable: true, warnings: [],
    },
    capturedAt: new Date().toISOString(),
    ...partial,
  }
}

describe('groupFiles', () => {
  it('separates conflicted, staged, changed, and untracked files', () => {
    const files = [
      file({ path: 'conflict.ts', conflicted: true }),
      file({ path: 'staged.ts', indexStatus: 'M' }),
      file({ path: 'changed.ts', worktreeStatus: 'M' }),
      file({ path: 'new.ts', untracked: true }),
    ]
    const groups = Object.fromEntries(groupFiles(files).map((group) => [group.kind, group.files.map((f) => f.path)]))
    expect(groups.conflicted).toEqual(['conflict.ts'])
    expect(groups.staged).toEqual(['staged.ts'])
    expect(groups.changed).toEqual(['changed.ts'])
    expect(groups.untracked).toEqual(['new.ts'])
  })

  it('lists a partially-staged file in both staged and changed', () => {
    const groups = Object.fromEntries(
      groupFiles([file({ path: 'both.ts', indexStatus: 'M', worktreeStatus: 'M' })]).map((g) => [g.kind, g.files.length]),
    )
    expect(groups.staged).toBe(1)
    expect(groups.changed).toBe(1)
  })
})

describe('filterFiles', () => {
  it('matches path and original path case-insensitively', () => {
    const files = [file({ path: 'src/App.tsx' }), file({ path: 'src/store.ts', originalPath: 'src/old.ts' })]
    expect(filterFiles(files, 'app').map((f) => f.path)).toEqual(['src/App.tsx'])
    expect(filterFiles(files, 'OLD').map((f) => f.path)).toEqual(['src/store.ts'])
    expect(filterFiles(files, '')).toHaveLength(2)
  })
})

describe('fileStatusGlyph', () => {
  it('prefers the most significant state', () => {
    expect(fileStatusGlyph(file({ path: 'a', conflicted: true }))).toBe('U')
    expect(fileStatusGlyph(file({ path: 'a', untracked: true }))).toBe('?')
    expect(fileStatusGlyph(file({ path: 'a', renamed: true }))).toBe('R')
    expect(fileStatusGlyph(file({ path: 'a', deleted: true }))).toBe('D')
    expect(fileStatusGlyph(file({ path: 'a', indexStatus: 'M' }))).toBe('M')
  })
})

describe('deriveSyncState', () => {
  it('derives every posture from backend counts', () => {
    expect(deriveSyncState(undefined)).toBe('clean')
    expect(deriveSyncState(snapshot({ branch: undefined }))).toBe('detached')
    expect(deriveSyncState(snapshot({ upstream: undefined }))).toBe('unpublished')
    expect(deriveSyncState(snapshot({ ahead: 2, behind: 1 }))).toBe('diverged')
    expect(deriveSyncState(snapshot({ ahead: 2 }))).toBe('ahead')
    expect(deriveSyncState(snapshot({ behind: 3 }))).toBe('behind')
    expect(deriveSyncState(snapshot({}))).toBe('clean')
  })

  it('labels the sync state with counts', () => {
    expect(syncStateLabel('ahead', 2, 0)).toBe('2 ahead')
    expect(syncStateLabel('diverged', 2, 1)).toBe('2 ahead · 1 behind')
    expect(syncStateLabel('unpublished', 0, 0)).toBe('Not published')
  })
})

describe('parseUnifiedDiff', () => {
  it('assigns line kinds and tracks old/new line numbers', () => {
    const diff = ['@@ -1,2 +1,2 @@', ' context', '-removed', '+added'].join('\n')
    const lines = parseUnifiedDiff(diff)
    expect(lines.map((l) => l.kind)).toEqual(['hunk', 'context', 'del', 'add'])
    expect(lines[1]).toMatchObject({ oldLine: 1, newLine: 1 })
    expect(lines[2]).toMatchObject({ oldLine: 2 })
    expect(lines[3]).toMatchObject({ newLine: 2 })
    expect(diffStat(lines)).toEqual({ added: 1, removed: 1 })
  })

  it('returns nothing for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })
})

describe('parseRemoteProjection', () => {
  it('maps known object kinds and skips deleted/unknown ones defensively', () => {
    const projection: RemoteProjection = {
      projectId: 'p1', provider: 'github', repository: {}, lastSuccessfulSync: '', stale: false,
      syncStatuses: [],
      objects: [
        { kind: 'pull_request', externalId: '1', fetchedAt: '2026-01-01T00:00:00Z', stale: false, deleted: false, payload: { number: 1, title: 'PR', draft: true, headBranch: 'x' } },
        { kind: 'pull_request', externalId: '2', fetchedAt: '', stale: false, deleted: true, payload: { number: 2 } },
        { kind: 'workflow_run', externalId: '3', fetchedAt: '', stale: false, deleted: false, payload: { id: 3, state: 'failure', name: 'CI' } },
        { kind: 'mystery', externalId: '4', fetchedAt: '', stale: false, deleted: false, payload: {} },
      ],
    }
    const views = parseRemoteProjection(projection)
    expect(views.pullRequests).toHaveLength(1)
    expect(views.pullRequests[0]).toMatchObject({ number: 1, state: 'draft', headBranch: 'x' })
    expect(views.workflowRuns[0]).toMatchObject({ id: 3, state: 'failure' })
  })

  it('returns empty views when no projection is present', () => {
    expect(parseRemoteProjection(undefined).pullRequests).toEqual([])
  })

  it('maps GitHub workflow definitions, paginated run payload fields and rich pull request data', () => {
    const projection: RemoteProjection = {
      projectId: 'p1', provider: 'github', repository: {}, lastSuccessfulSync: '2026-07-17T00:00:00Z', stale: false,
      syncStatuses: [{ category: 'workflow', status: 'healthy', lastSuccessfulSync: '2026-07-17T00:00:00Z' }],
      objects: [
        { kind: 'workflow', externalId: '11', fetchedAt: '', stale: false, deleted: false, payload: { id: 11, name: 'Release Windows (reusable)', path: '.github/workflows/release-windows.yml', state: 'active', triggerKinds: ['workflow_call'] } },
        { kind: 'workflow_run', externalId: '22', fetchedAt: '', stale: false, deleted: false, payload: { id: 22, workflow_id: 11, name: 'Release Windows (reusable)', status: 'completed', conclusion: 'failure', head_branch: 'main', head_sha: 'abcdef123456', run_attempt: 2, actor: { login: 'octocat' }, created_at: '2026-07-17T00:00:00Z', updated_at: '2026-07-17T00:01:00Z', artifacts: [{ id: 8, name: 'installer', size_in_bytes: 1024, expired: false }] } },
        { kind: 'pull_request', externalId: '4', fetchedAt: '', stale: false, deleted: false, payload: { number: 4, title: 'Command Center', state: 'OPEN', isDraft: true, baseRefName: 'main', headRefName: 'feat/repository-command-center', headRefOid: 'abcdef', changedFiles: 52, additions: 8746, deletions: 196, commits: [{ oid: '1' }, { oid: '2' }], author: { login: 'dasindu' }, statusCheckRollup: [{ name: 'validate', status: 'COMPLETED', conclusion: 'SUCCESS', workflowName: 'Validate' }] } },
      ],
    }
    const views = parseRemoteProjection(projection)
    expect(views.workflows[0]).toMatchObject({ name: 'Release Windows (reusable)', triggerKinds: ['workflow_call'] })
    expect(views.workflowRuns[0]).toMatchObject({ id: 22, workflowId: 11, state: 'failure', branch: 'main', attempt: 2, actor: 'octocat', artifacts: [{ id: 8, name: 'installer', size: 1024 }] })
    expect(views.pullRequests[0]).toMatchObject({ number: 4, baseBranch: 'main', headBranch: 'feat/repository-command-center', changedFiles: 52, commits: 2, checksState: 'passing' })
  })

  it('keeps unexpanded PR summary counts diagnostic rather than presenting zero', () => {
    const projection: RemoteProjection = {
      projectId: 'p1', provider: 'github', repository: {}, lastSuccessfulSync: '', stale: false, syncStatuses: [],
      objects: [{ kind: 'pull_request', externalId: '5', fetchedAt: '', stale: false, deleted: false, payload: { number: 5, title: 'Summary only', state: 'OPEN' } }],
    }
    expect(parseRemoteProjection(projection).pullRequests[0]).toMatchObject({ commits: -1, comments: -1 })
  })
})

describe('relativeTime', () => {
  it('formats recent timestamps', () => {
    const now = Date.parse('2026-01-01T12:00:00Z')
    expect(relativeTime(undefined, now)).toBe('—')
    expect(relativeTime('2026-01-01T11:59:30Z', now)).toBe('just now')
    expect(relativeTime('2026-01-01T11:30:00Z', now)).toBe('30m ago')
    expect(relativeTime('2026-01-01T09:00:00Z', now)).toBe('3h ago')
  })
})
