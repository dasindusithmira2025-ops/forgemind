import { create } from 'zustand'
import { displayUrl, normalizeUrl, type UrlRejectReason } from './browserUrl'
import type { SanitizedElement } from './inspectContext'

/**
 * Per-Workspace state for the embedded Browser surface. Like the tool-panel store, it lives outside
 * React so the terminal canvas never remounts, and it is scoped + persisted per Workspace so each
 * Workspace restores its own last URL and zoom. History is tracked here (not delegated to the native
 * webview) so Back/Forward behave identically regardless of what the underlying webview exposes.
 *
 * Persisted (localStorage): last URL + zoom only. Never persisted: page contents, credentials,
 * inspection captures, or auth state — those stay in the native webview's own session for its origin.
 */

export type BrowserErrorKind =
  | 'connection-refused'
  | 'invalid-url'
  | 'blocked-scheme'
  | 'security'
  | 'load-failed'

export interface BrowserError {
  kind: BrowserErrorKind
  message: string
  url: string
}

export interface BrowserSelection {
  element: SanitizedElement
  pageUrl: string
  pageTitle?: string
  screenshot?: string
}

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 3
export const ZOOM_STEP = 0.1
const MAX_HISTORY = 50

export interface BrowserHistory {
  entries: string[]
  index: number
}

export function canGoBack(history: BrowserHistory): boolean {
  return history.index > 0
}

export function canGoForward(history: BrowserHistory): boolean {
  return history.index >= 0 && history.index < history.entries.length - 1
}

export function currentEntry(history: BrowserHistory): string | undefined {
  return history.index >= 0 ? history.entries[history.index] : undefined
}

/** Push a navigation, truncating any forward entries (standard browser semantics) and coalescing a
 * repeat of the current URL into a reload rather than a new entry. Capped to MAX_HISTORY. */
export function pushEntry(history: BrowserHistory, url: string): BrowserHistory {
  if (currentEntry(history) === url) return history
  const kept = history.entries.slice(0, history.index + 1)
  kept.push(url)
  const trimmed = kept.slice(-MAX_HISTORY)
  return { entries: trimmed, index: trimmed.length - 1 }
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100))
}

function rejectionError(reason: UrlRejectReason, scheme: string | undefined, input: string): BrowserError {
  switch (reason) {
    case 'blocked-scheme':
      return { kind: 'blocked-scheme', url: input, message: `The ${scheme ?? 'requested'} scheme is blocked in the embedded browser.` }
    case 'empty':
      return { kind: 'invalid-url', url: input, message: 'Enter an address to open.' }
    default:
      return { kind: 'invalid-url', url: input, message: 'That address could not be understood.' }
  }
}

interface Persisted {
  lastUrl: string
  zoom: number
}

function persistKey(workspaceId: string): string {
  return `paralith.browser.${workspaceId}`
}

function loadPersisted(workspaceId: string): Persisted | undefined {
  try {
    const raw = localStorage.getItem(persistKey(workspaceId))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return {
      lastUrl: typeof parsed.lastUrl === 'string' ? displayUrl(parsed.lastUrl) : '',
      zoom: clampZoom(typeof parsed.zoom === 'number' ? parsed.zoom : 1),
    }
  } catch {
    return undefined
  }
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
function savePersisted(state: BrowserSessionState): void {
  if (!state.workspaceId) return
  const snapshot: Persisted = { lastUrl: displayUrl(currentEntry(state.history) ?? ''), zoom: state.zoom }
  const key = persistKey(state.workspaceId)
  const existing = saveTimers.get(key)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    saveTimers.delete(key)
    try {
      localStorage.setItem(key, JSON.stringify(snapshot))
    } catch {
      /* best-effort UI cache */
    }
  }, 200)
  saveTimers.set(key, timer)
}

export interface BrowserSessionState {
  workspaceId: string
  history: BrowserHistory
  /** Editable address-bar text; may differ from the loaded URL while the user is typing. */
  input: string
  loading: boolean
  title: string
  secure: boolean
  error?: BrowserError
  zoom: number
  inspecting: boolean
  selection?: BrowserSelection

  init: (workspaceId: string) => void
  setInput: (value: string) => void
  /** Normalize + navigate. Returns the URL to hand to the webview, or undefined when rejected. */
  navigate: (rawInput: string) => string | undefined
  goBack: () => string | undefined
  goForward: () => string | undefined
  reload: () => string | undefined
  /** Report a load lifecycle event coming back from the native webview. */
  onLoadStarted: (url: string) => void
  onLoadFinished: (payload: { url: string; title?: string; secure?: boolean }) => void
  onLoadFailed: (payload: { url: string; kind: BrowserErrorKind; message?: string }) => void
  setZoom: (zoom: number) => void
  zoomIn: () => number
  zoomOut: () => number
  resetZoom: () => number
  setInspecting: (value: boolean) => void
  setSelection: (selection: BrowserSelection | undefined) => void
}

export const useBrowserSessionStore = create<BrowserSessionState>((set, get) => {
  const commit = () => savePersisted(get())
  return {
    workspaceId: '',
    history: { entries: [], index: -1 },
    input: '',
    loading: false,
    title: '',
    secure: false,
    error: undefined,
    zoom: 1,
    inspecting: false,
    selection: undefined,

    init: (workspaceId) => {
      if (get().workspaceId === workspaceId) return
      const persisted = loadPersisted(workspaceId)
      const lastUrl = persisted?.lastUrl ?? ''
      set({
        workspaceId,
        history: lastUrl ? { entries: [lastUrl], index: 0 } : { entries: [], index: -1 },
        input: lastUrl,
        loading: false,
        title: '',
        secure: lastUrl.startsWith('https:'),
        error: undefined,
        zoom: persisted?.zoom ?? 1,
        inspecting: false,
        selection: undefined,
      })
    },

    setInput: (value) => set({ input: value }),

    navigate: (rawInput) => {
      const result = normalizeUrl(rawInput)
      if (!result.ok) {
        set({ error: rejectionError(result.reason, result.scheme, rawInput), loading: false })
        return undefined
      }
      set((state) => ({
        history: pushEntry(state.history, result.url),
        input: displayUrl(result.url),
        loading: true,
        error: undefined,
        secure: result.secure,
        selection: undefined,
        inspecting: false,
      }))
      commit()
      return result.url
    },

    goBack: () => {
      const { history } = get()
      if (!canGoBack(history)) return undefined
      const index = history.index - 1
      const url = history.entries[index]
      set({ history: { ...history, index }, input: displayUrl(url), loading: true, error: undefined, secure: url.startsWith('https:'), selection: undefined, inspecting: false })
      commit()
      return url
    },

    goForward: () => {
      const { history } = get()
      if (!canGoForward(history)) return undefined
      const index = history.index + 1
      const url = history.entries[index]
      set({ history: { ...history, index }, input: displayUrl(url), loading: true, error: undefined, secure: url.startsWith('https:'), selection: undefined, inspecting: false })
      commit()
      return url
    },

    reload: () => {
      const url = currentEntry(get().history)
      if (!url) return undefined
      set({ loading: true, error: undefined, selection: undefined, inspecting: false })
      return url
    },

    onLoadStarted: (url) => {
      if (url === 'about:blank') return
      const state = get()
      if (currentEntry(state.history) === url) {
        set({ loading: true, error: undefined })
        return
      }
      // The page navigated itself (server redirect or in-page link click). Mid-load of a commanded
      // navigation it is a redirect — replace the current entry; on a settled page it is a real
      // navigation — push a new entry. Either way the address bar must reflect the true URL.
      if (state.loading && state.history.index >= 0) {
        const entries = [...state.history.entries]
        entries[state.history.index] = url
        set({ history: { entries, index: state.history.index }, input: displayUrl(url), secure: url.startsWith('https:'), loading: true, error: undefined })
      } else {
        set((current) => ({
          history: pushEntry(current.history, url),
          input: displayUrl(url),
          secure: url.startsWith('https:'),
          loading: true,
          error: undefined,
          selection: undefined,
          inspecting: false,
        }))
      }
      commit()
    },

    onLoadFinished: ({ url, title, secure }) => {
      const state = get()
      if (url && url !== 'about:blank' && currentEntry(state.history) !== url && state.history.index >= 0) {
        // Landed on a different URL than believed current (late redirect): sync the entry in place.
        const entries = [...state.history.entries]
        entries[state.history.index] = url
        set({ history: { entries, index: state.history.index }, input: displayUrl(url), secure: url.startsWith('https:') })
        commit()
      }
      set((current) => ({ loading: false, title: title ?? current.title, secure: secure ?? current.secure, error: undefined }))
    },

    onLoadFailed: ({ url, kind, message }) => {
      set({ loading: false, error: { kind, url, message: message ?? failureMessage(kind) } })
    },

    setZoom: (zoom) => {
      set({ zoom: clampZoom(zoom) })
      commit()
    },
    zoomIn: () => {
      const zoom = clampZoom(get().zoom + ZOOM_STEP)
      set({ zoom })
      commit()
      return zoom
    },
    zoomOut: () => {
      const zoom = clampZoom(get().zoom - ZOOM_STEP)
      set({ zoom })
      commit()
      return zoom
    },
    resetZoom: () => {
      set({ zoom: 1 })
      commit()
      return 1
    },

    setInspecting: (value) => set({ inspecting: value }),
    setSelection: (selection) => set({ selection }),
  }
})

function failureMessage(kind: BrowserErrorKind): string {
  switch (kind) {
    case 'connection-refused':
      return 'Connection refused — no server is responding at this address yet.'
    case 'security':
      return 'The connection is not secure or was blocked by a security policy.'
    case 'blocked-scheme':
      return 'This address uses a scheme that is blocked in the embedded browser.'
    case 'invalid-url':
      return 'That address could not be understood.'
    default:
      return 'The page failed to load.'
  }
}
