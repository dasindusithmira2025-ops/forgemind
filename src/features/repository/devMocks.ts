import type { RemoteProjectionViews } from './repositoryTypes'

/**
 * Development-only fixtures for the remote-projection sections (Pull Requests, Actions, Issues,
 * Releases, Security). These are NEVER used in production: the gate requires both Vite's DEV
 * build flag and an explicit opt-in localStorage key, so a production bundle can neither reach
 * nor tree-shake-retain this data path. Real deployments render connected empty/offline states.
 */
export const REPOSITORY_MOCK_FLAG = 'paralith.repo.dev-mocks'

export function isRepositoryMockEnabled(): boolean {
  if (!import.meta.env.DEV) return false
  try {
    return globalThis.localStorage?.getItem(REPOSITORY_MOCK_FLAG) === '1'
  } catch {
    return false
  }
}

export function mockRemoteViews(branch: string, headSha: string): RemoteProjectionViews {
  const now = Date.now()
  const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString()
  return {
    pullRequests: [
      {
        number: 128, title: 'Agent: parallelize snapshot inspection', state: 'open',
        author: 'claude-agent-3', authorKind: 'agent', baseBranch: 'main', headBranch: branch || 'agent/snapshot-perf',
        reviewDecision: 'review_required', checksState: 'pending', mergeable: true,
        changedFiles: 7, commits: 4, comments: 2, labels: ['agent', 'performance'], assignees: ['you'],
        linkedIssue: '#101', updatedAt: iso(12), headSha, body: 'Splits repository inspection into worker tasks to keep the UI responsive on large trees.',
      },
      {
        number: 127, title: 'Fix merge-gate evidence rendering', state: 'draft',
        author: 'you', authorKind: 'human', baseBranch: 'main', headBranch: 'fix/merge-gate',
        reviewDecision: 'none', checksState: 'failing', mergeable: false,
        changedFiles: 3, commits: 1, comments: 0, labels: ['bug'], assignees: [],
        updatedAt: iso(48), headSha: 'a1b2c3d', body: 'Draft — investigating a failing check.',
      },
    ],
    workflowRuns: [
      {
        id: 90211, name: 'CI', branch: branch || 'main', commitSha: headSha, commitMessage: 'parallelize snapshot inspection',
        state: 'failure', event: 'pull_request', durationSeconds: 214, createdAt: iso(11),
        failureSummary: 'test: repository::selectors::group_files panicked at assertion',
        jobs: [
          { id: 1, name: 'lint', state: 'success', durationSeconds: 32, steps: [{ name: 'oxlint', state: 'success' }] },
          {
            id: 2, name: 'test', state: 'failure', durationSeconds: 182,
            steps: [{ name: 'build', state: 'success' }, { name: 'vitest', state: 'failure' }],
          },
        ],
      },
      {
        id: 90188, name: 'CI', branch: 'main', commitSha: 'ffee0011', commitMessage: 'chore: sync governance branch',
        state: 'success', event: 'push', durationSeconds: 176, createdAt: iso(90),
        jobs: [{ id: 3, name: 'test', state: 'success', durationSeconds: 176, steps: [] }],
      },
    ],
    issues: [
      { number: 101, title: 'Snapshot inspection blocks the UI on huge repos', state: 'open', author: 'you', labels: ['performance'], comments: 3, updatedAt: iso(120) },
    ],
    releases: [
      { tag: 'v0.2.0', name: 'Paralith 0.2.0', draft: false, prerelease: false, publishedAt: iso(1440), author: 'release-bot' },
    ],
    securityAlerts: [
      { id: 'ghsa-xxxx', kind: 'dependabot', severity: 'high', summary: 'Prototype pollution in a transitive dependency', state: 'open', updatedAt: iso(300) },
    ],
  }
}
