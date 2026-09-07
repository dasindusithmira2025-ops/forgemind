import { describe, expect, it } from 'vitest'
import type { RepositoryCommitSummary } from '../../native/types'
import {
  buildCommitGraph, groupByDirectory, groupRefs, refDisplayName, refRemoteSuffix, splitPath,
} from './commitGraph'

function commit(sha: string, parents: string[], refs: string[] = []): RepositoryCommitSummary {
  return {
    sha,
    parents,
    authorName: 'Dasindu',
    authorEmail: 'd@example.com',
    authoredAt: '2026-08-08T00:00:00Z',
    committerName: 'Dasindu',
    committerEmail: 'd@example.com',
    committedAt: '2026-08-08T00:00:00Z',
    subject: sha,
    refs,
    signature: 'N',
  }
}

describe('commit graph lanes', () => {
  it('keeps a linear history in one lane', () => {
    const { rows, lanes } = buildCommitGraph([
      commit('c', ['b']), commit('b', ['a']), commit('a', []),
    ])
    expect(lanes).toBe(1)
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0])
    // The root commit has no parent, so nothing leaves its row.
    expect(rows[2].bottom).toEqual([])
    expect(rows[0].bottom).toEqual([{ from: 0, to: 0, color: 0 }])
  })

  it('opens a lane for a merge and closes it when the side branch is consumed', () => {
    //  m ── merge of main (a) and a topic branch (t)
    const { rows, lanes } = buildCommitGraph([
      commit('m', ['a', 't']),
      commit('a', ['base']),
      commit('t', ['base']),
      commit('base', []),
    ])
    expect(lanes).toBe(2)
    expect(rows[0]).toMatchObject({ lane: 0, merge: true })
    // The merge sends one line down its own lane and one out to the topic lane.
    expect(rows[0].bottom).toEqual([
      { from: 0, to: 0, color: 0 },
      { from: 0, to: 1, color: 1 },
    ])
    expect(rows[1].lane).toBe(0) // `a` on the main lane
    expect(rows[2].lane).toBe(1) // `t` on the lane the merge opened
    // Both sides reach `base`: the topic lane bends back into lane 0 as it leaves `t`'s row.
    expect(rows[2].bottom).toContainEqual({ from: 1, to: 0, color: 0 })
    expect(rows[3].lane).toBe(0)
    expect(rows[3].bottom).toEqual([])
  })

  it('leaves a lane open when its next commit is outside the loaded page', () => {
    const [row] = buildCommitGraph([commit('c', ['not-loaded'])]).rows
    expect(row.bottom).toEqual([{ from: 0, to: 0, color: 0 }])
  })

  it('never reports more lanes than the rail reserves', () => {
    // Ten tips whose parents are all off-page keep ten lanes open; the rail clamps its width
    // instead of growing without bound.
    const wide = Array.from({ length: 10 }, (_, index) => commit(`r${index}`, [`p${index}`]))
    expect(buildCommitGraph(wide).lanes).toBe(6)
  })
})

describe('ref grouping', () => {
  it('folds HEAD, local and remote copies of one branch into a single entry', () => {
    const [main] = groupRefs(['HEAD -> main', 'origin/main', 'upstream/main'])
    expect(main).toMatchObject({ label: 'main', kind: 'branch', head: true, local: true })
    expect(main.remotes).toEqual(['origin', 'upstream'])
    expect(refDisplayName(main)).toBe('main')
    expect(refRemoteSuffix(main)).toBe('origin +1')
  })

  it('keeps a remote-only branch prefixed and drops the origin/HEAD alias', () => {
    const groups = groupRefs(['origin/feature-x', 'origin/HEAD'])
    expect(groups).toHaveLength(1)
    expect(refDisplayName(groups[0])).toBe('origin/feature-x')
    expect(refRemoteSuffix(groups[0])).toBe('')
  })

  it('sorts HEAD first and tags ahead of ordinary branches', () => {
    const groups = groupRefs(['origin/release', 'tag: v1.2.0', 'HEAD -> main'])
    expect(groups.map((group) => group.label)).toEqual(['main', 'v1.2.0', 'release'])
  })
})

describe('paths', () => {
  it('splits a nested path into directory and file name', () => {
    expect(splitPath('src-tauri/src/database/activity.rs'))
      .toEqual({ dir: 'src-tauri/src/database/', name: 'activity.rs' })
    expect(splitPath('README.md')).toEqual({ dir: '', name: 'README.md' })
  })

  it('buckets files by directory in the order Git listed them', () => {
    const groups = groupByDirectory([
      { path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'docs/x.md' }, { path: 'src/c.ts' },
    ])
    expect(groups.map((group) => group.dir)).toEqual(['src/', 'docs/'])
    expect(groups[0].files).toHaveLength(3)
  })
})
