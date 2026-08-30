import { describe, expect, it } from 'vitest'
import type { RepositoryCommitSummary } from '../../native/types'
import { layoutCommitGraph } from './commitGraphLayout'

function commit(sha: string, parents: string[] = []): RepositoryCommitSummary {
  return {
    sha, parents, authorName: 'Dax', authorEmail: 'dax@example.test', authoredAt: '2026-08-31T00:00:00Z',
    committerName: 'Dax', committerEmail: 'dax@example.test', committedAt: '2026-08-31T00:00:00Z',
    subject: sha, refs: [], signature: 'N',
  }
}

describe('layoutCommitGraph', () => {
  it('keeps a linear chain in one lane', () => {
    const rows = layoutCommitGraph([commit('c3', ['c2']), commit('c2', ['c1']), commit('c1')])
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0])
    expect(rows[0].parentLanes).toEqual([0])
  })

  it('draws both parents of a merge and retains its side lane', () => {
    const rows = layoutCommitGraph([
      commit('merge', ['main', 'topic']), commit('main', ['base']), commit('topic', ['base']), commit('base'),
    ])
    expect(rows[0].parentLanes).toHaveLength(2)
    expect(rows[0].lanesAfter).toEqual(['main', 'topic'])
    expect(rows[2].parentLanes).toEqual([0])
  })

  it('does not retain duplicate lanes once two graph paths join', () => {
    const rows = layoutCommitGraph([
      commit('top', ['merge']), commit('merge', ['main', 'topic']), commit('main', ['base']), commit('topic', ['base']), commit('base'),
    ])
    expect(new Set(rows.at(-1)?.lanesBefore ?? []).size).toBe((rows.at(-1)?.lanesBefore ?? []).length)
  })
})
