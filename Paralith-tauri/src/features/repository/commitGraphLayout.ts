import type { RepositoryCommitSummary } from '../../native/types'

/**
 * A compact, deterministic lane assignment for the currently loaded page of Git history.
 * Git remains the topology source of truth; this only decides where its known parent edges are
 * drawn. Parent lanes that continue beyond the page deliberately remain visible at its boundary.
 */
export interface CommitGraphRow {
  commit: RepositoryCommitSummary
  lane: number
  lanesBefore: string[]
  lanesAfter: string[]
  parentLanes: number[]
}

export function layoutCommitGraph(commits: RepositoryCommitSummary[]): CommitGraphRow[] {
  const active: string[] = []

  return commits.map((commit) => {
    let lane = active.indexOf(commit.sha)
    if (lane === -1) {
      active.unshift(commit.sha)
      lane = 0
    }

    const lanesBefore = [...active]
    const parents = commit.parents
    if (parents.length === 0) {
      active.splice(lane, 1)
      return { commit, lane, lanesBefore, lanesAfter: [...active], parentLanes: [] }
    }

    const parentLanes: number[] = []
    const primary = parents[0]
    const duplicatePrimary = active.findIndex((sha, index) => index !== lane && sha === primary)
    if (duplicatePrimary >= 0) {
      active.splice(lane, 1)
      parentLanes.push(duplicatePrimary > lane ? duplicatePrimary - 1 : duplicatePrimary)
    } else {
      active[lane] = primary
      parentLanes.push(lane)
    }

    for (const parent of parents.slice(1)) {
      const known = active.indexOf(parent)
      if (known >= 0) {
        parentLanes.push(known)
        continue
      }
      const insertion = Math.min(parentLanes[0] + 1, active.length)
      active.splice(insertion, 0, parent)
      parentLanes.push(insertion)
    }

    return { commit, lane, lanesBefore, lanesAfter: [...active], parentLanes }
  })
}
