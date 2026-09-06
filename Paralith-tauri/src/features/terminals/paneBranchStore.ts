import { create } from 'zustand'
import { asNativeError, native } from '../../native/commands'
import { humanActor } from '../repository/repositoryTypes'
import { newId } from '../../shared/layout'
import type { RepositoryBranchSummary } from '../../native/types'

/**
 * Per-terminal Git branch state.
 *
 * A workspace is not one branch: every pane has its own working directory, and an agent may be
 * running in an isolated worktree on a branch nobody else is on. State is therefore keyed by
 * `projectId + working directory` — two panes in the same directory share one reading and one
 * git call, two panes in different worktrees never borrow each other's branch.
 *
 * ponytail: reads are on demand (mount, pane activation, window focus, menu open, after a switch)
 * rather than polled — a `git status` per pane on a timer is real cost on a large repository. A
 * `git checkout` typed inside the terminal shows up on the next of those moments.
 */

const STALE_AFTER_MS = 4_000

export interface PaneBranchReading {
  status: 'loading' | 'ready' | 'error'
  branch?: string
  ahead: number
  behind: number
  /** Changed files reported by git status for this working directory. */
  dirty: number
  checkedAt: number
  /** Set when this directory is not usable as a repository worktree — the chip stays hidden. */
  unavailable?: boolean
  error?: string
}

interface BranchList {
  status: 'loading' | 'ready' | 'error'
  items: RepositoryBranchSummary[]
  error?: string
}

interface PaneBranchStore {
  readings: Record<string, PaneBranchReading>
  lists: Record<string, BranchList>
  /** Directory key -> branch name currently being checked out. */
  switching: Record<string, string>
  refresh: (projectId: string, directory: string, force?: boolean) => Promise<void>
  loadBranches: (projectId: string, force?: boolean) => Promise<void>
  switchBranch: (projectId: string, directory: string, name: string) => Promise<boolean>
}

export const directoryKey = (projectId: string, directory: string) => `${projectId}\u0000${directory}`

const inFlight = new Map<string, Promise<void>>()

export const usePaneBranchStore = create<PaneBranchStore>((set, get) => ({
  readings: {},
  lists: {},
  switching: {},

  refresh: async (projectId, directory, force = false) => {
    const key = directoryKey(projectId, directory)
    const existing = get().readings[key]
    if (!force && existing && Date.now() - existing.checkedAt < STALE_AFTER_MS) return
    const running = inFlight.get(key)
    if (running) return running
    const request = (async () => {
      set({ readings: { ...get().readings, [key]: { ...(existing ?? { ahead: 0, behind: 0, dirty: 0, checkedAt: 0 }), status: 'loading' } } })
      try {
        const snapshot = await native.inspectRepository(projectId, undefined, directory)
        set({ readings: { ...get().readings, [key]: {
          status: 'ready',
          branch: snapshot.branch,
          ahead: snapshot.ahead,
          behind: snapshot.behind,
          dirty: snapshot.files.length,
          checkedAt: Date.now(),
        } } })
      } catch (caught) {
        const error = asNativeError(caught)
        set({ readings: { ...get().readings, [key]: {
          status: 'error',
          ahead: 0,
          behind: 0,
          dirty: 0,
          checkedAt: Date.now(),
          // A pane can legitimately sit outside the repository; that is absence of a branch, not
          // a failure worth shouting about, so the chip hides itself instead.
          unavailable: true,
          error: error.message,
        } } })
      }
    })().finally(() => inFlight.delete(key))
    inFlight.set(key, request)
    return request
  },

  loadBranches: async (projectId, force = false) => {
    const current = get().lists[projectId]
    if (!force && current && current.status !== 'error') return
    set({ lists: { ...get().lists, [projectId]: { status: 'loading', items: current?.items ?? [] } } })
    try {
      const items = await native.listRepositoryBranches(projectId)
      set({ lists: { ...get().lists, [projectId]: { status: 'ready', items } } })
    } catch (caught) {
      set({ lists: { ...get().lists, [projectId]: { status: 'error', items: [], error: asNativeError(caught).message } } })
    }
  },

  switchBranch: async (projectId, directory, name) => {
    const key = directoryKey(projectId, directory)
    if (get().switching[key]) return false
    set({ switching: { ...get().switching, [key]: name } })
    try {
      const record = await native.executeRepositoryOperation({
        context: {
          projectId,
          worktreePath: directory,
          actor: humanActor(),
          expectedBranch: get().readings[key]?.branch,
          idempotencyKey: newId(),
        },
        operation: { kind: 'switch_branch', name },
      })
      if (record.status === 'succeeded') {
        // Every pane of this Project re-reads: a sibling pane in a subdirectory of the same
        // worktree is now on the branch this one just checked out, and a header that kept showing
        // the old name would be fiction.
        const prefix = directoryKey(projectId, '')
        const directories = Object.keys(get().readings)
          .filter((entry) => entry.startsWith(prefix))
          .map((entry) => entry.slice(prefix.length))
        await Promise.all(Array.from(new Set([directory, ...directories])).map((entry) => get().refresh(projectId, entry, true)))
        void get().loadBranches(projectId, true)
        return true
      }
      const message = record.status === 'awaiting_approval'
        ? `Switching to ${name} needs an approval in Source Control.`
        : record.errorMessage ?? `Could not switch to ${name}.`
      set({ readings: { ...get().readings, [key]: { ...get().readings[key], status: 'ready', error: message } as PaneBranchReading } })
      return false
    } catch (caught) {
      const message = asNativeError(caught).message
      set({ readings: { ...get().readings, [key]: { ...get().readings[key], status: 'ready', error: message } as PaneBranchReading } })
      return false
    } finally {
      const next = { ...get().switching }
      delete next[key]
      set({ switching: next })
    }
  },
}))
