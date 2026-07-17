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
