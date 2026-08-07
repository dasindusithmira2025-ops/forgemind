import type { SidebarWorkspace, WorkspaceRuntimeStatus } from './sidebarTypes'

/**
 * Ordinal attention class for the opt-in "Needs you first" sort. Lower number = more
 * attention-demanding. Adapted from Orca's four-class smart sort onto our runtime statuses.
 *
 *   1 — Needs you   `failed` / `attention` / `waiting`
 *   2 — Settling    `starting` / `stopping`  (transient; resolves on its own but worth watching)
 *   3 — Working     `active` / `partially_active`
 *   4 — Idle        `closed`
 *
 * The classes exist because a flat status sort would rank by an arbitrary enum order. Ranking by
 * *how much a human is needed* is the only ordering that stays useful once a session has more
 * Workspaces than fit on screen — which is the whole reason the mode exists.
 */
export type AttentionClass = 1 | 2 | 3 | 4

/** Map one canonical runtime status onto its attention class. */
export function attentionClass(status: WorkspaceRuntimeStatus): AttentionClass {
  switch (status) {
    case 'failed':
    case 'attention':
    case 'waiting':
      return 1
    case 'starting':
    case 'stopping':
      return 2
    case 'active':
    case 'partially_active':
      return 3
    case 'closed':
      return 4
  }
}

/**
 * Order two Workspaces for the attention sort: class first, then most recently opened, then the
 * caller's original index.
 *
 * The final index tiebreak is what makes the sort *stable* — without it two Workspaces in the
 * same class with identical timestamps could swap places between renders, and a list that
 * reshuffles under a pointer is worse than one that is merely ordered badly.
 */
export function compareByAttention(
  a: SidebarWorkspace,
  b: SidebarWorkspace,
  indexOf: (entry: SidebarWorkspace) => number,
): number {
  const classDelta = attentionClass(a.runtime.status) - attentionClass(b.runtime.status)
  if (classDelta !== 0) return classDelta
  // Oldest first among Workspaces that are actually blocked on a person: the one that has been
  // waiting longest is the one that has been ignored longest. This is the opposite of the recency
  // rule below, and deliberately so — recency answers "what was I just doing", which is the wrong
  // question once something is stuck waiting for you.
  const waitDelta = compareAttentionSince(a.runtime.attentionSince, b.runtime.attentionSince)
  if (waitDelta !== 0) return waitDelta
  // Newest first: within one class, the Workspace touched most recently is the likelier target.
  const recency = b.workspace.lastOpenedAt.localeCompare(a.workspace.lastOpenedAt)
  if (recency !== 0) return recency
  return indexOf(a) - indexOf(b)
}

/** Order two optional wait timestamps: waiting sorts ahead of not waiting, oldest wait first. */
function compareAttentionSince(a?: string, b?: string): number {
  if (a && b) return a.localeCompare(b)
  if (a) return -1
  if (b) return 1
  return 0
}

/**
 * Apply the attention sort to a list, leaving the input untouched.
 *
 * `manual` order is never re-sorted here: the persisted drag order *is* the user's answer to
 * "what matters", and silently overriding it would make the drag handle look broken.
 */
export function sortByAttention(entries: SidebarWorkspace[]): SidebarWorkspace[] {
  const index = new Map(entries.map((entry, position) => [entry.workspace.id, position]))
  const indexOf = (entry: SidebarWorkspace) => index.get(entry.workspace.id) ?? 0
  return [...entries].sort((a, b) => compareByAttention(a, b, indexOf))
}
