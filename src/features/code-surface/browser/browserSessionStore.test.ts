import { beforeEach, describe, expect, it } from 'vitest'
import {
  canGoBack,
  canGoForward,
  clampZoom,
  currentEntry,
  pushEntry,
  useBrowserSessionStore,
  type BrowserHistory,
} from './browserSessionStore'

describe('history core', () => {
  it('pushes, truncates forward entries, and coalesces reloads', () => {
    let h: BrowserHistory = { entries: [], index: -1 }
    h = pushEntry(h, 'http://a/')
    h = pushEntry(h, 'http://b/')
    h = pushEntry(h, 'http://c/')
    expect(h).toEqual({ entries: ['http://a/', 'http://b/', 'http://c/'], index: 2 })
    // A repeat of the current URL is not a new entry.
    expect(pushEntry(h, 'http://c/')).toBe(h)
    // Navigating from the middle truncates the forward tail.
    const mid = { entries: h.entries, index: 1 }
    const forked = pushEntry(mid, 'http://d/')
    expect(forked).toEqual({ entries: ['http://a/', 'http://b/', 'http://d/'], index: 2 })
  })

  it('reports back/forward availability', () => {
    const h: BrowserHistory = { entries: ['http://a/', 'http://b/'], index: 0 }
    expect(canGoBack(h)).toBe(false)
    expect(canGoForward(h)).toBe(true)
    expect(currentEntry(h)).toBe('http://a/')
  })
})

describe('clampZoom', () => {
  it('clamps into range', () => {
    expect(clampZoom(0.1)).toBe(0.5)
    expect(clampZoom(9)).toBe(3)
    expect(clampZoom(1.234)).toBe(1.23)
  })
})

describe('useBrowserSessionStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useBrowserSessionStore.setState({ workspaceId: '', history: { entries: [], index: -1 }, input: '', loading: false, title: '', secure: false, error: undefined, zoom: 1, inspecting: false, selection: undefined })
  })

  it('normalizes and navigates, returning the concrete URL', () => {
    const store = useBrowserSessionStore.getState()
    store.init('ws-nav')
    const url = useBrowserSessionStore.getState().navigate('localhost:3000/x')
    expect(url).toBe('http://localhost:3000/x')
    const state = useBrowserSessionStore.getState()
    expect(currentEntry(state.history)).toBe('http://localhost:3000/x')
    expect(state.loading).toBe(true)
  })

  it('rejects a blocked scheme with an error and no navigation', () => {
    const store = useBrowserSessionStore.getState()
    store.init('ws-block')
    const url = useBrowserSessionStore.getState().navigate('file:///etc/passwd')
    expect(url).toBeUndefined()
    const state = useBrowserSessionStore.getState()
    expect(state.error?.kind).toBe('blocked-scheme')
    expect(state.history.entries).toHaveLength(0)
  })

  it('drives back and forward through the URL stack', () => {
    useBrowserSessionStore.getState().init('ws-hist')
    useBrowserSessionStore.getState().navigate('http://a/')
    useBrowserSessionStore.getState().navigate('http://b/')
    expect(useBrowserSessionStore.getState().goBack()).toBe('http://a/')
    expect(useBrowserSessionStore.getState().goForward()).toBe('http://b/')
    expect(useBrowserSessionStore.getState().goForward()).toBeUndefined()
  })

  it('surfaces load failures as an error state', () => {
    useBrowserSessionStore.getState().init('ws-err')
    useBrowserSessionStore.getState().navigate('http://localhost:9999/')
    useBrowserSessionStore.getState().onLoadFailed({ url: 'http://localhost:9999/', kind: 'connection-refused' })
    const state = useBrowserSessionStore.getState()
    expect(state.loading).toBe(false)
    expect(state.error?.kind).toBe('connection-refused')
  })

  it('persists last URL + zoom and restores on re-init', () => {
    useBrowserSessionStore.getState().init('ws-persist')
    useBrowserSessionStore.getState().navigate('http://localhost:5173/')
    useBrowserSessionStore.getState().setZoom(1.5)
    // Force the debounced write out synchronously.
    localStorage.setItem('paralith.browser.ws-persist', JSON.stringify({ lastUrl: 'http://localhost:5173/', zoom: 1.5 }))
    // Switch away then back.
    useBrowserSessionStore.getState().init('ws-other')
    useBrowserSessionStore.getState().init('ws-persist')
    const state = useBrowserSessionStore.getState()
    expect(currentEntry(state.history)).toBe('http://localhost:5173/')
    expect(state.zoom).toBe(1.5)
  })

  it('treats a mid-load different-URL load-start as a redirect and replaces the entry', () => {
    useBrowserSessionStore.getState().init('ws-redirect')
    useBrowserSessionStore.getState().navigate('http://cursor.com/')
    // Still loading when the redirect target starts loading.
    useBrowserSessionStore.getState().onLoadStarted('https://cursor.com/')
    const state = useBrowserSessionStore.getState()
    expect(state.history.entries).toEqual(['https://cursor.com/'])
    expect(state.input).toBe('https://cursor.com/')
    expect(state.secure).toBe(true)
  })

  it('pushes a new entry when a settled page navigates itself (link click)', () => {
    useBrowserSessionStore.getState().init('ws-linknav')
    useBrowserSessionStore.getState().navigate('http://localhost:5199/')
    useBrowserSessionStore.getState().onLoadFinished({ url: 'http://localhost:5199/' })
    useBrowserSessionStore.getState().onLoadStarted('http://localhost:5199/docs/')
    const state = useBrowserSessionStore.getState()
    expect(state.history.entries).toEqual(['http://localhost:5199/', 'http://localhost:5199/docs/'])
    expect(state.history.index).toBe(1)
    expect(canGoBack(state.history)).toBe(true)
  })

  it('syncs the current entry when a load finishes on a different URL (late redirect)', () => {
    useBrowserSessionStore.getState().init('ws-late')
    useBrowserSessionStore.getState().navigate('http://cursor.com/')
    useBrowserSessionStore.getState().onLoadFinished({ url: 'https://cursor.com/' })
    const state = useBrowserSessionStore.getState()
    expect(state.history.entries).toEqual(['https://cursor.com/'])
    expect(state.input).toBe('https://cursor.com/')
    expect(state.loading).toBe(false)
  })

  it('ignores about:blank load events entirely', () => {
    useBrowserSessionStore.getState().init('ws-blank')
    useBrowserSessionStore.getState().onLoadStarted('about:blank')
    expect(useBrowserSessionStore.getState().history.entries).toHaveLength(0)
    expect(useBrowserSessionStore.getState().loading).toBe(false)
  })

  it('clears selection + inspection when navigating', () => {
    useBrowserSessionStore.getState().init('ws-insp')
    useBrowserSessionStore.getState().setInspecting(true)
    useBrowserSessionStore.getState().setSelection({ element: { tag: 'div', classNames: [], attributes: {} }, pageUrl: 'http://a/' })
    useBrowserSessionStore.getState().navigate('http://b/')
    const state = useBrowserSessionStore.getState()
    expect(state.inspecting).toBe(false)
    expect(state.selection).toBeUndefined()
  })
})
