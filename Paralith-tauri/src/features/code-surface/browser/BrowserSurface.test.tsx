import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { BrowserEvent } from '../../../native/types'

const holder = vi.hoisted(() => ({ handler: undefined as ((event: BrowserEvent) => void) | undefined }))

const browserNavigate = vi.fn().mockResolvedValue(undefined)
const openBrowserView = vi.fn().mockResolvedValue(undefined)
const browserSetBounds = vi.fn().mockResolvedValue(undefined)
const browserSetVisible = vi.fn().mockResolvedValue(undefined)
const browserSetInspect = vi.fn().mockResolvedValue(undefined)
const closeBrowserView = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../native/commands', () => ({
  native: {
    openBrowserView: (...args: unknown[]) => openBrowserView(...args),
    browserNavigate: (...args: unknown[]) => browserNavigate(...args),
    browserReload: vi.fn().mockResolvedValue(undefined),
    browserStop: vi.fn().mockResolvedValue(undefined),
    browserSetBounds: (...args: unknown[]) => browserSetBounds(...args),
    browserSetVisible: (...args: unknown[]) => browserSetVisible(...args),
    browserSetZoom: vi.fn().mockResolvedValue(undefined),
    browserSetInspect: (...args: unknown[]) => browserSetInspect(...args),
    closeBrowserView: (...args: unknown[]) => closeBrowserView(...args),
  },
}))
vi.mock('../../../native/events', () => ({
  onBrowserEvent: (handler: (event: BrowserEvent) => void) => {
    holder.handler = handler
    return Promise.resolve(() => undefined)
  },
}))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))

const { BrowserSurface } = await import('./BrowserSurface')
const { useBrowserSessionStore, currentEntry } = await import('./browserSessionStore')
const { encodeInspectPayload } = await import('./browserInspectBridge')

const context = { workspaceId: 'wsb', projectId: 'p1', workspaceName: 'WS', projectName: 'Proj' }

beforeEach(() => {
  holder.handler = undefined
  browserNavigate.mockClear()
  browserSetBounds.mockReset().mockResolvedValue(undefined)
  browserSetVisible.mockReset().mockResolvedValue(undefined)
  browserSetInspect.mockClear()
  openBrowserView.mockReset().mockResolvedValue(undefined)
  closeBrowserView.mockReset().mockResolvedValue(undefined)
  localStorage.clear()
  // jsdom reports a 0×0 layout; give the viewport a real size so the geometry effect (which drives
  // native navigation) proceeds instead of bailing on an empty rectangle.
  Element.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 40, width: 480, height: 600, top: 40, left: 0, right: 480, bottom: 640, toJSON: () => ({}) }) as DOMRect
  useBrowserSessionStore.setState({
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
  })
})

describe('BrowserSurface', () => {
  it('shows the start page when no URL is loaded', () => {
    render(<BrowserSurface active context={context} />)
    expect(screen.getByText('Open a development server')).toBeTruthy()
  })

  it('normalizes and submits an address, driving the native view', async () => {
    render(<BrowserSurface active context={context} />)
    const input = screen.getByLabelText('Address') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'localhost:3000/app' } })
    fireEvent.submit(input.closest('form')!)
    // Navigation flows through open_browser_view (which creates-at-URL or navigates on change).
    await waitFor(() =>
      expect(openBrowserView).toHaveBeenCalledWith('wsb', expect.anything(), 'http://localhost:3000/app'),
    )
    expect(currentEntry(useBrowserSessionStore.getState().history)).toBe('http://localhost:3000/app')
  })

  it('hides the native webview when it is not the active surface (isolation from HTML display)', async () => {
    // A native child webview paints above HTML and cannot be clipped by display:none, so the surface
    // must explicitly hide it when it stops being the active tool. Give it a URL first so the view is
    // meant to be shown while active.
    act(() => { useBrowserSessionStore.getState().init('wsb') })
    act(() => { useBrowserSessionStore.getState().navigate('http://localhost:3000/') })
    const { rerender } = render(<BrowserSurface active context={context} />)
    await waitFor(() => expect(openBrowserView).toHaveBeenCalled())
    browserSetBounds.mockClear()
    browserSetVisible.mockClear()
    rerender(<BrowserSurface active={false} context={context} />)
    await waitFor(() => expect(browserSetBounds).toHaveBeenCalledWith('wsb', { x: -32000, y: -32000, width: 1, height: 1 }))
    await waitFor(() => expect(browserSetVisible).toHaveBeenCalledWith('wsb', false))
  })

  it('orders a panel-collapse hide after pending native webview creation', async () => {
    let finishOpen!: () => void
    const opened = new Promise<void>((resolve) => { finishOpen = resolve })
    const lifecycle: string[] = []
    openBrowserView.mockImplementationOnce(async () => {
      await opened
      lifecycle.push('open:resolved')
    })
    browserSetBounds.mockImplementation(async (_workspaceId: string, bounds: { x: number; y: number; width: number; height: number }) => {
      if (bounds.x === -32000 && bounds.y === -32000 && bounds.width === 1 && bounds.height === 1) lifecycle.push('bounds:hidden')
    })
    browserSetVisible.mockImplementation(async (_workspaceId: string, visible: boolean) => {
      lifecycle.push(`visible:${visible}`)
    })

    act(() => { useBrowserSessionStore.getState().init('wsb') })
    act(() => { useBrowserSessionStore.getState().navigate('http://localhost:3000/') })
    const { rerender } = render(<BrowserSurface active context={context} />)
    await waitFor(() => expect(openBrowserView).toHaveBeenCalled())

    rerender(<BrowserSurface active={false} context={context} />)
    expect(browserSetVisible).not.toHaveBeenCalled()
    finishOpen()

    await waitFor(() => expect(lifecycle.at(-1)).toBe('visible:false'))
    expect(lifecycle).toContain('bounds:hidden')
    expect(browserSetVisible).not.toHaveBeenCalledWith('wsb', true)
  })

  it('orders unmount cleanup after pending native webview creation', async () => {
    let finishOpen!: () => void
    const opened = new Promise<void>((resolve) => { finishOpen = resolve })
    const lifecycle: string[] = []
    openBrowserView.mockImplementationOnce(async () => {
      await opened
      lifecycle.push('open:resolved')
    })
    closeBrowserView.mockImplementation(async () => {
      lifecycle.push('close')
    })

    act(() => { useBrowserSessionStore.getState().init('wsb') })
    act(() => { useBrowserSessionStore.getState().navigate('http://localhost:3000/') })
    const { unmount } = render(<BrowserSurface active context={context} />)
    await waitFor(() => expect(openBrowserView).toHaveBeenCalled())

    unmount()
    expect(closeBrowserView).not.toHaveBeenCalled()
    finishOpen()

    await waitFor(() => expect(lifecycle.at(-1)).toBe('close'))
  })

  it('decodes + sanitizes an inspect selection and exits inspect mode', async () => {
    render(<BrowserSurface active context={context} />)
    // Load a localhost page so the store has a current URL.
    act(() => { useBrowserSessionStore.getState().navigate('http://localhost:5173/') })
    act(() => { useBrowserSessionStore.getState().setInspecting(true) })
    const payload = encodeInspectPayload({ tag: 'BUTTON', id: 'save', text: 'Save', attributes: { value: 'secret' } })
    act(() => { holder.handler?.({ kind: 'inspect-selected', workspaceId: 'wsb', payload }) })
    const state = useBrowserSessionStore.getState()
    expect(state.inspecting).toBe(false)
    expect(state.selection?.element.tag).toBe('button')
    // Secret value attribute must have been stripped by sanitization.
    expect(state.selection?.element.attributes).not.toHaveProperty('value')
  })

  it('ignores an inspect bridge event unless this workspace entered inspect mode', () => {
    render(<BrowserSurface active context={context} />)
    const payload = encodeInspectPayload({ tag: 'BUTTON', id: 'forged' })
    act(() => { holder.handler?.({ kind: 'inspect-selected', workspaceId: 'wsb', payload }) })
    expect(useBrowserSessionStore.getState().selection).toBeUndefined()
  })

  it('reports a blocked navigation as a security error', async () => {
    render(<BrowserSurface active context={context} />)
    act(() => { holder.handler?.({ kind: 'nav-blocked', workspaceId: 'wsb', url: 'file:///etc/passwd', scheme: 'file' }) })
    await waitFor(() => expect(useBrowserSessionStore.getState().error?.kind).toBe('blocked-scheme'))
  })

  it('shows an explicit starting state behind the native surface instead of a blank area', () => {
    // The starting state only applies inside a real Tauri host (elsewhere the honest
    // "unavailable" notice renders instead), so simulate the Tauri marker.
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    try {
      act(() => { useBrowserSessionStore.getState().init('wsb') })
      act(() => { useBrowserSessionStore.getState().navigate('http://localhost:5173/') })
      render(<BrowserSurface active context={context} />)
      expect(screen.getByText('Starting browser…')).toBeTruthy()
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    }
  })

  it('syncs the address bar when the page navigates itself (link click / redirect)', async () => {
    act(() => { useBrowserSessionStore.getState().init('wsb') })
    act(() => { useBrowserSessionStore.getState().navigate('http://localhost:5199/') })
    render(<BrowserSurface active context={context} />)
    act(() => { holder.handler?.({ kind: 'load-finished', workspaceId: 'wsb', url: 'http://localhost:5199/' }) })
    act(() => { holder.handler?.({ kind: 'load-started', workspaceId: 'wsb', url: 'http://localhost:5199/docs/' }) })
    const state = useBrowserSessionStore.getState()
    expect(state.input).toBe('http://localhost:5199/docs/')
    expect(state.history.entries).toEqual(['http://localhost:5199/', 'http://localhost:5199/docs/'])
  })
})
