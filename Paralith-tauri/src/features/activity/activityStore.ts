import { create } from 'zustand'
import { asNativeError, native } from '../../native/commands'
import { onActivityChanged } from '../../native/events'
import type { ActivityState, ActivityThread } from '../../native/types'

/**
 * How many settled threads RECENT shows. Activity answers "what just happened", so the tail is
 * short on purpose — a long one would be the notification archive this surface exists to avoid.
 */
const RECENT_VISIBLE = 6

/** Threads a viewer must act on before anything else can progress. */
export function needsAttention(thread: ActivityThread): boolean {
  return thread.state === 'waiting_for_user' || thread.state === 'blocked'
}

export function isLive(thread: ActivityThread): boolean {
  return thread.state === 'queued' || thread.state === 'running'
}

/**
 * The pulse state, in priority order rather than recency order. A single failure outranks three
 * running jobs, because the running jobs need nothing from the user and the failure does.
 */
export type PulseState = 'idle' | 'live' | 'attention' | 'failure' | 'complete'

export interface ActivityBuckets {
  attention: ActivityThread[]
  live: ActivityThread[]
  recent: ActivityThread[]
}

interface ActivityStoreState {
  threads: ActivityThread[]
  open: boolean
  loaded: boolean
  error?: string
  /** Thread ids with an approve/reject in flight, so a double click cannot double-submit. */
  reviewing: string[]
  /** Ids whose expanded technical detail is showing. Collapsed is the default. */
  expanded: string[]
  /** Whether the pulse — which owns the dock — is on screen. The toast only offers "View" when it
   * is, so the action can never open a dock that nothing is rendering. */
  pulseMounted: boolean
  setPulseMounted: (mounted: boolean) => void
  hydrate: () => Promise<void>
  ingest: (thread: ActivityThread) => void
  setOpen: (open: boolean) => void
  toggleExpanded: (id: string) => void
  review: (threadId: string, approved: boolean) => Promise<void>
  dismiss: (threadId: string) => Promise<void>
  resync: () => Promise<void>
}

/** Newest first, by the source's own timestamp. */
const byRecency = (a: ActivityThread, b: ActivityThread) => b.updatedAt.localeCompare(a.updatedAt)

/**
 * Priority, not chronology. A deployment waiting on a human sits above a build that is merely
 * running, no matter which one changed most recently.
 */
export function bucketThreads(threads: ActivityThread[]): ActivityBuckets {
  const attention = threads.filter(needsAttention).sort(byRecency)
  const live = threads.filter((thread) => isLive(thread)).sort(byRecency)
  const recent = threads
    .filter((thread) => !needsAttention(thread) && !isLive(thread))
    .sort(byRecency)
    .slice(0, RECENT_VISIBLE)
  return { attention, live, recent }
}

export function pulseState(threads: ActivityThread[]): PulseState {
  if (threads.some(needsAttention)) return 'attention'
  if (threads.some((thread) => thread.state === 'failed')) return 'failure'
  if (threads.some(isLive)) return 'live'
  if (threads.some((thread) => thread.state === 'completed')) return 'complete'
  return 'idle'
}

export const useActivityStore = create<ActivityStoreState>((set, get) => ({
  threads: [],
  open: false,
  loaded: false,
  reviewing: [],
  expanded: [],
  pulseMounted: false,

  setPulseMounted(mounted) {
    set({ pulseMounted: mounted })
  },

  async hydrate() {
    try {
      const snapshot = await native.listActivityThreads()
      // The listener is established alongside this read. Preserve any newer broadcast that won
      // the race with hydration instead of replacing it with the older invocation snapshot.
      set((state) => {
        const threads = state.threads.slice()
        for (const thread of snapshot) {
          const index = threads.findIndex((item) => item.id === thread.id)
          if (index < 0) threads.push(thread)
          else if (threads[index].revision <= thread.revision) threads[index] = thread
        }
        return { threads, loaded: true, error: undefined }
      })
    } catch (error) {
      set({ loaded: true, error: asNativeError(error).message })
    }
  },

  /**
   * Fold one broadcast change into the list.
   *
   * The backend has already dropped duplicates, stale orderings and no-op observations, so this
   * is a straight replace-by-id. Guarding on `revision` anyway costs one comparison and makes the
   * renderer correct even if two windows ever deliver the same thread out of order.
   */
  ingest(thread) {
    set((state) => {
      const index = state.threads.findIndex((item) => item.id === thread.id)
      if (index < 0) return { threads: [thread, ...state.threads] }
      if (state.threads[index].revision > thread.revision) return state
      const threads = state.threads.slice()
      threads[index] = thread
      return { threads }
    })
  },

  setOpen(open) {
    set({ open })
    // Opening the dock is a good moment to confirm the model against GitHub, but it is not how
    // the dock stays current: it is already current when it opens.
    if (open) void get().resync()
  },

  toggleExpanded(id) {
    set((state) => ({
      expanded: state.expanded.includes(id)
        ? state.expanded.filter((item) => item !== id)
        : [...state.expanded, id],
    }))
  },

  async review(threadId, approved) {
    if (get().reviewing.includes(threadId)) return
    set((state) => ({ reviewing: [...state.reviewing, threadId], error: undefined }))
    try {
      const thread = await native.reviewActivityDeployment(threadId, approved)
      get().ingest(thread)
    } catch (error) {
      set({ error: asNativeError(error).message })
    } finally {
      set((state) => ({ reviewing: state.reviewing.filter((item) => item !== threadId) }))
    }
  },

  async dismiss(threadId) {
    try {
      await native.dismissActivityThread(threadId)
      set((state) => ({ threads: state.threads.filter((item) => item.id !== threadId) }))
    } catch (error) {
      set({ error: asNativeError(error).message })
    }
  },

  async resync() {
    try {
      await native.resyncActivity()
    } catch {
      // A reconciliation request that cannot be delivered is not worth a visible error; the
      // watcher's own cadence will catch up.
    }
  },
}))

/**
 * Subscribe the store to the Activity broadcast and to the moments that need reconciliation.
 *
 * The realtime channel is primary. Focus, wake and network recovery are the three points where it
 * may have silently missed transitions, so each asks the backend for one reconciliation pass
 * rather than starting a poll.
 */
export function startActivity(): () => void {
  void useActivityStore.getState().hydrate()
  const store = useActivityStore.getState()
  const pending = onActivityChanged((event) => useActivityStore.getState().ingest(event.thread))
  const reconcile = () => void store.resync()
  const onVisible = () => {
    if (document.visibilityState === 'visible') reconcile()
  }
  window.addEventListener('focus', reconcile)
  window.addEventListener('online', reconcile)
  document.addEventListener('visibilitychange', onVisible)
  let disposed = false
  let unlisten: (() => void) | undefined
  void pending.then((stop) => {
    if (disposed) stop()
    else unlisten = stop
  })
  return () => {
    disposed = true
    unlisten?.()
    window.removeEventListener('focus', reconcile)
    window.removeEventListener('online', reconcile)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

/** States worth interrupting someone over. Everything else belongs in the dock and nowhere else. */
const NOTIFIABLE: ActivityState[] = ['waiting_for_user', 'blocked', 'paused', 'failed', 'completed']

export function isNotifiable(thread: ActivityThread): boolean {
  return NOTIFIABLE.includes(thread.state)
}

const STATE_LABEL: Record<ActivityState, string> = {
  queued: 'Queued',
  running: 'Running',
  waiting_for_user: 'Waiting for you',
  paused: 'Paused',
  blocked: 'Blocked',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

/** One name per state, so the pulse, the dock rows and the notifications never disagree. */
export function activityStateLabel(state: ActivityState): string {
  return STATE_LABEL[state]
}

/**
 * One alert per thread *state*, not per event.
 *
 * The backend already suppresses no-op observations, but a reconnect, a resync or a second window
 * can legitimately redeliver the same thread at the same state, and a re-render always can. Keying
 * on `id:state` makes the alert idempotent for the transition rather than for the message.
 */
export function alertKey(thread: ActivityThread): string {
  return `${thread.id}:${thread.state}`
}

/** Threads whose current state deserves an interruption and has not already produced one. */
export function pendingAlerts(threads: ActivityThread[], fired: ReadonlySet<string>): ActivityThread[] {
  return threads
    .filter((thread) => isNotifiable(thread) && !fired.has(alertKey(thread)))
    .sort(byRecency)
}
