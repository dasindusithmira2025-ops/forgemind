import type { RepositoryCommitSummary } from '../../native/types'

/**
 * Presentation-only geometry for the commit graph rail.
 *
 * Everything here is derived from the parent pointers Git already returned on
 * `RepositoryCommitSummary` — no extra walk, no extra IPC, no second source of history. The rail
 * assigns each commit a lane and describes the line segments entering and leaving its row, so the
 * renderer can draw the topology without knowing anything about Git.
 */

/** Distinct lane hues. Lanes beyond this recycle a colour rather than inventing one. */
export const GRAPH_LANE_COLORS = 6

/**
 * Lane cap for the *rail's width*, not for the topology. Deeper lanes still get correct edges;
 * they are drawn clamped against the last column so a pathological fan-out cannot push the rail
 * over the commit text or introduce a horizontal scrollbar.
 */
export const GRAPH_MAX_LANES = 6

/** One line segment across half a row, from lane `from` to lane `to`. */
export interface GraphEdge { from: number; to: number; color: number }

export interface GraphRow {
  sha: string
  /** Column the commit's node sits in. */
  lane: number
  color: number
  /** Segments from the row's top edge down to the node line. */
  top: GraphEdge[]
  /** Segments from the node line down to the row's bottom edge. */
  bottom: GraphEdge[]
  /** True when the commit has more than one parent, so the node can read as a junction. */
  merge: boolean
}

export interface CommitGraph {
  rows: GraphRow[]
  /** Columns the rail must reserve, already clamped to `GRAPH_MAX_LANES`. */
  lanes: number
}

/** Lane index to draw at, clamped so a very wide graph still fits the reserved rail. */
export function laneColumn(lane: number): number {
  return Math.min(lane, GRAPH_MAX_LANES - 1)
}

function firstFree(lanes: (string | undefined)[]): number {
  const index = lanes.indexOf(undefined)
  return index === -1 ? lanes.length : index
}

/**
 * Lay out a page of commits (newest first, exactly as `git log` returned them) into lanes.
 *
 * The walk keeps one array of "which commit each lane is waiting for". A row claims the lane that
 * was waiting for it (or a free one), every other lane waiting for the same commit converges into
 * it, and each parent is then either handed to a lane that already awaits it or given a lane of
 * its own. A parent outside the loaded page simply keeps its lane open, which is what makes the
 * bottom of a page render as continuing lines rather than as a hard edge.
 */
export function buildCommitGraph(commits: RepositoryCommitSummary[]): CommitGraph {
  let lanes: (string | undefined)[] = []
  let laneColors: number[] = []
  let nextColor = 0
  let widest = 1
  const rows: GraphRow[] = []

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.sha)
    if (lane === -1) {
      lane = firstFree(lanes)
      lanes[lane] = commit.sha
      laneColors[lane] = nextColor++ % GRAPH_LANE_COLORS
    }
    const color = laneColors[lane]
    const top = lanes.slice()
    const topColors = laneColors.slice()

    // This row consumes every lane that was waiting for it; the parents are placed afterwards.
    const after = lanes.slice()
    const afterColors = laneColors.slice()
    for (let index = 0; index < after.length; index += 1) {
      if (after[index] === commit.sha) after[index] = undefined
    }
    for (const [index, parent] of commit.parents.entries()) {
      if (after.includes(parent)) continue
      const target = index === 0 && after[lane] === undefined ? lane : firstFree(after)
      after[target] = parent
      afterColors[target] = target === lane ? color : nextColor++ % GRAPH_LANE_COLORS
    }
    while (after.length > 0 && after[after.length - 1] === undefined) {
      after.pop()
      afterColors.pop()
    }

    const topEdges: GraphEdge[] = []
    const bottomEdges: GraphEdge[] = []
    for (let index = 0; index < top.length; index += 1) {
      const waiting = top[index]
      if (!waiting) continue
      if (waiting === commit.sha) {
        // Converges into this commit's node and stops there.
        topEdges.push({ from: index, to: lane, color: topColors[index] })
        continue
      }
      const below = after.indexOf(waiting)
      if (below === -1) continue // lane ended with a commit outside this page
      topEdges.push({ from: index, to: index, color: topColors[index] })
      bottomEdges.push({ from: index, to: below, color: topColors[index] })
    }
    const seen = new Set<number>()
    for (const parent of commit.parents) {
      const below = after.indexOf(parent)
      if (below === -1 || seen.has(below)) continue
      seen.add(below)
      bottomEdges.push({ from: lane, to: below, color: afterColors[below] })
    }

    rows.push({ sha: commit.sha, lane, color, top: topEdges, bottom: bottomEdges, merge: commit.parents.length > 1 })
    widest = Math.max(widest, top.length, after.length, lane + 1)
    lanes = after
    laneColors = afterColors
  }

  return { rows, lanes: Math.min(widest, GRAPH_MAX_LANES) }
}

// ---- Ref decorations -------------------------------------------------------------------------

export interface RefGroup {
  label: string
  kind: 'branch' | 'tag'
  /** HEAD points here. */
  head: boolean
  /** A local branch of this name exists. */
  local: boolean
  /** Remotes carrying the same branch name, so `main` + `origin/main` read as one thing. */
  remotes: string[]
}

/**
 * Fold Git's raw decoration list into one entry per name.
 *
 * `git log` reports `HEAD -> main`, `origin/main` and `upstream/main` as three separate strings,
 * which is what turned the row into a wall of pills. They describe one branch on three hosts, so
 * they are grouped into one label carrying its remotes. Nothing is invented: a remote-only branch
 * stays remote-only, and `origin/HEAD` (a symbolic alias, not a tip) is dropped.
 */
export function groupRefs(refs: string[]): RefGroup[] {
  const groups = new Map<string, RefGroup>()
  const upsert = (kind: RefGroup['kind'], label: string): RefGroup => {
    const key = `${kind}:${label}`
    const existing = groups.get(key)
    if (existing) return existing
    const created: RefGroup = { label, kind, head: false, local: false, remotes: [] }
    groups.set(key, created)
    return created
  }

  for (const raw of refs) {
    const ref = raw.trim()
    if (!ref) continue
    if (ref.startsWith('tag: ')) {
      upsert('tag', ref.slice(5)).local = true
      continue
    }
    const arrow = ref.indexOf(' -> ')
    if (arrow !== -1) {
      const group = upsert('branch', ref.slice(arrow + 4))
      group.head = true
      group.local = true
      continue
    }
    if (ref === 'HEAD') {
      const group = upsert('branch', 'HEAD')
      group.head = true
      group.local = true
      continue
    }
    const slash = ref.indexOf('/')
    if (slash > 0) {
      const name = ref.slice(slash + 1)
      if (name === 'HEAD') continue
      const group = upsert('branch', name)
      const remote = ref.slice(0, slash)
      if (!group.remotes.includes(remote)) group.remotes.push(remote)
      continue
    }
    upsert('branch', ref).local = true
  }

  // HEAD first, then tags, then the rest — the order a reader scans for.
  return [...groups.values()].sort((a, b) =>
    Number(b.head) - Number(a.head) || Number(b.kind === 'tag') - Number(a.kind === 'tag'))
}

/** Remotes to print beside a local branch name, e.g. `origin` or `origin +1`. Empty when there is nothing to add. */
export function refRemoteSuffix(group: RefGroup): string {
  if (group.remotes.length === 0 || !group.local) return ''
  return group.remotes.length === 1 ? group.remotes[0] : `${group.remotes[0]} +${group.remotes.length - 1}`
}

/** The name to print for a grouped ref: a remote-only branch keeps its remote prefix. */
export function refDisplayName(group: RefGroup): string {
  return group.local || group.remotes.length === 0 ? group.label : `${group.remotes[0]}/${group.label}`
}

// ---- Paths -----------------------------------------------------------------------------------

/** Split a repository path into its directory (with trailing slash) and its file name. */
export function splitPath(path: string): { dir: string; name: string } {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? { dir: '', name: path } : { dir: path.slice(0, cut + 1), name: path.slice(cut + 1) }
}

export interface DirectoryGroup<T> { dir: string; files: T[] }

/** Bucket changed files by their directory, keeping Git's own ordering within and between groups. */
export function groupByDirectory<T extends { path: string }>(files: T[]): DirectoryGroup<T>[] {
  const groups = new Map<string, DirectoryGroup<T>>()
  for (const file of files) {
    const { dir } = splitPath(file.path)
    const existing = groups.get(dir)
    if (existing) existing.files.push(file)
    else groups.set(dir, { dir, files: [file] })
  }
  return [...groups.values()]
}
