import { create } from 'zustand'

/**
 * The one confirmation surface. Every destructive or process-stopping action in the app resolves
 * here instead of `window.confirm` or the Tauri native dialog.
 *
 * Native confirms were the single largest break in the visual language: an unthemed OS dialog, in a
 * product whose whole promise is "you will not lose agent work", at exactly the moment the user most
 * needs to trust the chrome. They also cannot carry the two things these decisions actually need —
 * an itemised list of consequences, and a safe default focus.
 *
 * The API is imperative on purpose (`if (!(await confirm({...}))) return`) so call sites inside
 * async flows read the same as the `window.confirm` they replaced, with no prop drilling and no
 * per-screen dialog state. `ConfirmHost` renders whatever is pending.
 */
export interface ConfirmRequest {
  title: string
  /** One sentence: what is about to happen. */
  body?: string
  /** One line per consequence. Each line states a fact, not a warning. */
  details?: string[]
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` renders the destructive button treatment and focuses Cancel instead of Confirm. */
  intent?: 'default' | 'danger'
}

export interface PendingConfirm extends ConfirmRequest {
  id: number
  resolve: (value: boolean) => void
}

interface ConfirmState {
  queue: PendingConfirm[]
  push: (pending: PendingConfirm) => void
  settle: (id: number, value: boolean) => void
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  queue: [],
  push: (pending) => set((state) => ({ queue: [...state.queue, pending] })),
  settle: (id, value) => {
    const target = get().queue.find((item) => item.id === id)
    if (!target) return
    set((state) => ({ queue: state.queue.filter((item) => item.id !== id) }))
    target.resolve(value)
  },
}))

let nextId = 0

/**
 * Ask the user to confirm. Resolves `true` only on explicit confirmation — dismissing with Escape,
 * the backdrop or Cancel all resolve `false`, so a call site can never mistake "went away" for
 * "approved". Concurrent calls queue rather than overwrite each other.
 */
export function confirm(request: ConfirmRequest): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    nextId += 1
    useConfirmStore.getState().push({ ...request, id: nextId, resolve })
  })
}
