import { create } from 'zustand'
import type { UnlistenFn } from '@tauri-apps/api/event'
import type { ThemeDefinition, ThemeId } from './tokens'
import { toWindowChrome } from './tokens'
import { applyTheme, cachedThemeId } from './applyTheme'
import { coerceThemeId, resolveTheme } from './registry'
import { onSystemAppearanceChange, prefersDarkNow } from './system'
import { native } from '../native/commands'
import { onThemeChanged } from '../native/events'

interface ThemeStore {
  /** The user's selection, which may be `system`. */
  selectedId: ThemeId
  /** The concrete theme currently applied (system resolved to dark/light). */
  resolved: ThemeDefinition
  /** Whether the OS currently prefers dark, used to resolve `system`. */
  prefersDark: boolean
  /** True once the authoritative persisted preference has been reconciled. */
  ready: boolean
  /** Set when persisting the last selection failed; the theme still applied for this session. */
  persistError?: string
  /** User action: apply immediately, persist, and broadcast to every window. */
  setTheme: (id: ThemeId) => void
  /** Apply a selection without persisting/broadcasting (used for external + system updates). */
  applySelection: (id: ThemeId) => void
  /** React to an OS appearance change; re-resolves only when following the system. */
  handleSystemChange: (prefersDark: boolean) => void
}

const initialPrefersDark = prefersDarkNow()
const initialId = coerceThemeId(cachedThemeId())

/**
 * Apply a theme to this window: the CSS custom properties *and* the OS-drawn window frame.
 *
 * The frame is not reachable from CSS, so it has to be pushed to the backend separately. The call
 * is fire-and-forget: a frame that could not be repainted is cosmetic, and must never stop the
 * theme itself from applying (it also fails harmlessly in tests and in a plain browser, where
 * there is no Tauri backend to talk to).
 */
function paint(resolved: ThemeDefinition, selectedId: ThemeId): void {
  applyTheme(resolved, selectedId)
  void native.applyWindowChrome(toWindowChrome(resolved)).catch(() => undefined)
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  selectedId: initialId,
  resolved: resolveTheme(initialId, initialPrefersDark),
  prefersDark: initialPrefersDark,
  ready: false,

  applySelection: (id) => {
    const selectedId = coerceThemeId(id)
    const resolved = resolveTheme(selectedId, get().prefersDark)
    paint(resolved, selectedId)
    set({ selectedId, resolved })
  },

  setTheme: (id) => {
    const selectedId = coerceThemeId(id)
    if (selectedId === get().selectedId) return
    get().applySelection(selectedId)
    // Persist + broadcast. A failure is surfaced to the Appearance UI but must not roll the live
    // theme back — the selection already applied and the localStorage cache keeps it across restarts.
    set({ persistError: undefined })
    void native
      .setThemePreference(selectedId)
      .catch(() => set({ persistError: 'This theme is active now but could not be saved. It may not persist after a restart.' }))
  },

  handleSystemChange: (prefersDark) => {
    if (prefersDark === get().prefersDark) return
    set({ prefersDark })
    if (get().selectedId === 'system') {
      const resolved = resolveTheme('system', prefersDark)
      paint(resolved, 'system')
      set({ resolved })
    }
  },
}))

let started = false
let cleanup: (() => void) | undefined

/**
 * Initialise theme synchronisation for this window. Idempotent per renderer:
 *  1. Reconcile the fast localStorage guess with the authoritative persisted id.
 *  2. Re-apply when the OS appearance changes (only matters while following `system`).
 *  3. Re-apply when another window broadcasts a `theme-changed` event — without re-broadcasting, so
 *     there is no feedback loop and no duplicate subscriptions.
 * Returns a cleanup that unregisters every listener (call on window teardown).
 */
export function initThemeRuntime(): () => void {
  if (started) return cleanup ?? (() => {})
  started = true

  // Ensure the initial (cached) selection is actually applied to the DOM for this session.
  useThemeStore.getState().applySelection(useThemeStore.getState().selectedId)

  const stopSystem = onSystemAppearanceChange((prefersDark) =>
    useThemeStore.getState().handleSystemChange(prefersDark),
  )

  let stopEvent: UnlistenFn | undefined
  let disposed = false
  void onThemeChanged((themeId) => {
    // External update from another window (or our own broadcast echo): apply without persisting.
    useThemeStore.getState().applySelection(coerceThemeId(themeId))
  })
    .then((unlisten) => {
      if (disposed) unlisten()
      else stopEvent = unlisten
    })
    .catch(() => undefined)

  // Reconcile with the durable source of truth. The cache may be stale (e.g. changed in another
  // window while this one was closed) or empty on first ever run.
  void native
    .getThemePreference()
    .then((persisted) => {
      useThemeStore.getState().applySelection(coerceThemeId(persisted))
      useThemeStore.setState({ ready: true })
    })
    .catch(() => useThemeStore.setState({ ready: true }))

  cleanup = () => {
    disposed = true
    stopSystem()
    stopEvent?.()
    started = false
    cleanup = undefined
  }
  return cleanup
}

/** Test-only reset of the module-level init guard. */
export function __resetThemeRuntimeForTests(): void {
  cleanup?.()
  started = false
  cleanup = undefined
}
