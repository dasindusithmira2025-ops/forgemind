import { describe, expect, it } from 'vitest'
import type { RemoteProjection } from '../../native/types'
import { applyPrFilter, deriveProviderPosture } from './repositoryNav'
import type { PullRequestView } from './repositoryTypes'

function pr(overrides: Partial<PullRequestView>): PullRequestView {
  return {
    number: 1, title: 'PR', state: 'open', author: 'octocat', authorKind: 'human', baseBranch: 'main', headBranch: 'feat',
    reviewDecision: 'none', checksState: 'none', mergeable: null, changedFiles: 0, commits: 0, comments: 0, labels: [],
    assignees: [], updatedAt: '', headSha: '', body: '', additions: 0, deletions: 0, url: '', reviews: [], checks: [],
    files: [], reviewThreads: [], ...overrides,
  }
}

function projection(overrides: Partial<RemoteProjection>): RemoteProjection {
  return { projectId: 'p1', provider: 'github', repository: {}, objects: [], syncStatuses: [], lastSuccessfulSync: '2026-07-17T00:00:00Z', stale: false, ...overrides }
}

describe('applyPrFilter', () => {
  const prs = [
    pr({ number: 1, state: 'open', author: 'me', authorKind: 'human', reviewDecision: 'review_required' }),
    pr({ number: 2, state: 'draft', author: 'agent-bot', authorKind: 'agent' }),
    pr({ number: 3, state: 'merged', author: 'other', authorKind: 'human', reviewDecision: 'approved' }),
  ]

  it('active excludes merged and closed', () => {
    expect(applyPrFilter(prs, 'active').map((p) => p.number)).toEqual([1, 2])
  })
  it('drafts returns only draft PRs', () => {
    expect(applyPrFilter(prs, 'drafts').map((p) => p.number)).toEqual([2])
  })
  it('awaiting-review returns PRs needing a review decision', () => {
    expect(applyPrFilter(prs, 'awaiting-review').map((p) => p.number)).toEqual([1])
  })
  it('agents returns only agent-authored PRs', () => {
    expect(applyPrFilter(prs, 'agents').map((p) => p.number)).toEqual([2])
  })
  it('mine matches the connected account login when known', () => {
    expect(applyPrFilter(prs, 'mine', 'ME').map((p) => p.number)).toEqual([1])
  })
  it('mine falls back to human-authored PRs without a login', () => {
    expect(applyPrFilter(prs, 'mine').map((p) => p.number)).toEqual([1, 3])
  })
})

describe('deriveProviderPosture', () => {
  it('reports disconnected when the provider is not authenticated', () => {
    const posture = deriveProviderPosture({ providerStatus: { provider: 'github', host: '', authenticated: false, authenticationSource: '', permissions: [], message: 'Sign in' }, remoteLoading: false })
    expect(posture.kind).toBe('disconnected')
  })
  it('reports refreshing while a sync is in flight', () => {
    expect(deriveProviderPosture({ remoteLoading: true }).kind).toBe('refreshing')
  })
  it('reports synced when all categories are healthy and fresh', () => {
    const posture = deriveProviderPosture({ projection: projection({ syncStatuses: [{ category: 'pull_request', status: 'healthy' }] }), remoteLoading: false })
    expect(posture.kind).toBe('synced')
    expect(posture.tone).toBe('success')
  })
  it('names the missing permission when a category is permission-limited', () => {
    const posture = deriveProviderPosture({ projection: projection({ objects: [], syncStatuses: [{ category: 'workflow', status: 'failed', errorCode: 'github_permission_missing', requiredPermission: 'actions:read' }] }), remoteLoading: false })
    expect(posture.kind).toBe('permission-limited')
    expect(posture.detail).toContain('actions:read')
  })
  it('reports partially stale (not empty) when a category fails but cached data exists', () => {
    const posture = deriveProviderPosture({
      projection: projection({ objects: [{ kind: 'pull_request', externalId: '1', payload: {}, fetchedAt: '', stale: false, deleted: false }], syncStatuses: [{ category: 'workflow', status: 'failed', errorMessage: 'boom' }] }),
      remoteLoading: false,
    })
    expect(posture.kind).toBe('partially-stale')
    expect(posture.affected).toContain('Workflows')
  })
})
