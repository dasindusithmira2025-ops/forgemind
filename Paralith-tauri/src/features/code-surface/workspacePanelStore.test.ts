import { beforeEach, describe, expect, it } from 'vitest'
import { clampPanelWidth, useWorkspacePanelStore } from './workspacePanelStore'

function reset() {
  localStorage.clear()
  // Force a clean store between tests (init() no-ops when the id is unchanged).
  useWorkspacePanelStore.setState({ workspaceId: '', mounted: false, open: false, width: 520, maximized: false, surfaces: [], activeSurface: undefined })
}

describe('workspacePanelStore', () => {
  beforeEach(reset)

  it('is closed and unmounted by default, with no surfaces open', () => {
    useWorkspacePanelStore.getState().init('w1')
    const state = useWorkspacePanelStore.getState()
    expect(state.open).toBe(false)
    expect(state.mounted).toBe(false)
    expect(state.surfaces).toEqual([])
  })

  it('mounts and opens the panel, and stays mounted when closed', () => {
    const store = useWorkspacePanelStore.getState()
    store.init('w1')
    store.openPanel()
    expect(useWorkspacePanelStore.getState().open).toBe(true)
    expect(useWorkspacePanelStore.getState().mounted).toBe(true)

    store.closePanel()
    expect(useWorkspacePanelStore.getState().open).toBe(false)
    expect(useWorkspacePanelStore.getState().mounted).toBe(true)
    expect(useWorkspacePanelStore.getState().maximized).toBe(false)
  })

  it('toggles open/closed', () => {
    const store = useWorkspacePanelStore.getState()
    store.init('w1')
    store.toggle()
    expect(useWorkspacePanelStore.getState().open).toBe(true)
    store.toggle()
    expect(useWorkspacePanelStore.getState().open).toBe(false)
  })

  it('clamps width to the allowed range', () => {
    expect(clampPanelWidth(10)).toBe(320)
    expect(clampPanelWidth(99999)).toBe(1100)
    expect(clampPanelWidth(500.6)).toBe(501)
    const store = useWorkspacePanelStore.getState()
    store.init('w1')
    store.setWidth(20)
    expect(useWorkspacePanelStore.getState().width).toBe(320)
  })

  it('only maximizes while open, and clears maximize on close', () => {
    const store = useWorkspacePanelStore.getState()
    store.init('w1')
    store.toggleMaximized()
    expect(useWorkspacePanelStore.getState().maximized).toBe(false) // ignored while closed
    store.openPanel()
    store.toggleMaximized()
    expect(useWorkspacePanelStore.getState().maximized).toBe(true)
    store.closePanel()
    expect(useWorkspacePanelStore.getState().maximized).toBe(false)
  })

  it('opens a surface, mounting and opening the panel, and makes it active', () => {
    const store = useWorkspacePanelStore.getState()
    store.init('w1')
    store.openSurface('files')
    const state = useWorkspacePanelStore.getState()
    expect(state.open).toBe(true)
    expect(state.mounted).toBe(true)
    expect(state.surfaces).toEqual(['files'])
    expect(state.activeSurface).toBe('files')
  })

  it('opening an already-open singleton focuses it instead of duplicating', () => {
    const store = useWorkspacePanelStore.getState()
    store.init('w1')
    store.openSurface('files')
    store.openSurface('browser')
    store.openSurface('files')
    const state = useWorkspacePanelStore.getState()
    expect(state.surfaces).toEqual(['files', 'browser'])
    expect(state.activeSurface).toBe('files')
  })

  it('switches the active surface without changing the open set', () => {
    const store = useWorkspacePanelStore.getState()
    store.init('w1')
    store.openSurface('files')
    store.openSurface('browser')
    store.focusSurface('files')
    expect(useWorkspacePanelStore.getState().activeSurface).toBe('files')
    expect(useWorkspacePanelStore.getState().surfaces).toEqual(['files', 'browser'])
  })

  it('closing the active tab activates its previous neighbor', () => {
    const store = useWorkspacePanelStore.getState()
    store.init('w1')
    store.openSurface('files')
    store.openSurface('browser')
    store.openSurface('diff')
    store.focusSurface('browser')
    store.closeSurface('browser')
    const state = useWorkspacePanelStore.getState()
    expect(state.surfaces).toEqual(['files', 'diff'])
    expect(state.activeSurface).toBe('files')
  })

  it('closing a non-active tab leaves the active tab untouched', () => {
    const store = useWorkspacePanelStore.getState()
    store.init('w1')
    store.openSurface('files')
    store.openSurface('browser')
    store.closeSurface('files')
    expect(useWorkspacePanelStore.getState().activeSurface).toBe('browser')
    expect(useWorkspacePanelStore.getState().surfaces).toEqual(['browser'])
  })

  it('closing the last tab clears the active surface (returns to the empty chooser)', () => {
    const store = useWorkspacePanelStore.getState()
    store.init('w1')
    store.openSurface('files')
    store.closeSurface('files')
    const state = useWorkspacePanelStore.getState()
    expect(state.surfaces).toEqual([])
    expect(state.activeSurface).toBeUndefined()
  })

  it('reorders tabs', () => {
    const store = useWorkspacePanelStore.getState()
    store.init('w1')
    store.openSurface('files')
    store.openSurface('browser')
    store.openSurface('diff')
    store.reorderSurface('diff', 0)
    expect(useWorkspacePanelStore.getState().surfaces).toEqual(['diff', 'files', 'browser'])
  })

  it('persists and restores open surfaces per workspace', async () => {
    const store = useWorkspacePanelStore.getState()
    store.init('wtool')
    store.openSurface('browser')
    store.openSurface('agents')
    await new Promise((resolve) => setTimeout(resolve, 260))

    store.init('wother')
    expect(useWorkspacePanelStore.getState().surfaces).toEqual([])

    store.init('wtool')
    expect(useWorkspacePanelStore.getState().surfaces).toEqual(['browser', 'agents'])
    expect(useWorkspacePanelStore.getState().activeSurface).toBe('agents')
  })

  it('drops an unknown persisted surface kind instead of crashing restoration', () => {
    localStorage.setItem('paralith.toolpanel.wbad', JSON.stringify({ open: true, width: 520, surfaces: ['files', 'mystery'], activeSurface: 'mystery' }))
    useWorkspacePanelStore.getState().init('wbad')
    const state = useWorkspacePanelStore.getState()
    expect(state.surfaces).toEqual(['files'])
    expect(state.activeSurface).toBe('files')
  })

  it('normalizes a duplicate persisted surface list', () => {
    localStorage.setItem('paralith.toolpanel.wdup', JSON.stringify({ open: true, width: 520, surfaces: ['files', 'files', 'browser'], activeSurface: 'browser' }))
    useWorkspacePanelStore.getState().init('wdup')
    expect(useWorkspacePanelStore.getState().surfaces).toEqual(['files', 'browser'])
  })

  it('migrates a legacy single-tool persisted record', () => {
    localStorage.setItem('paralith.toolpanel.wlegacy', JSON.stringify({ open: true, width: 480, tool: 'browser' }))
    useWorkspacePanelStore.getState().init('wlegacy')
    const state = useWorkspacePanelStore.getState()
    expect(state.surfaces).toEqual(['browser'])
    expect(state.activeSurface).toBe('browser')
    expect(state.open).toBe(true)
  })

  it('persists and restores state per workspace independently', async () => {
    const store = useWorkspacePanelStore.getState()
    store.init('w1')
    store.openPanel()
    store.setWidth(640)
    // Persistence is debounced (200ms); wait it out.
    await new Promise((resolve) => setTimeout(resolve, 260))

    // Switch to a different workspace: its own (default, closed) state applies.
    store.init('w2')
    expect(useWorkspacePanelStore.getState().open).toBe(false)
    expect(useWorkspacePanelStore.getState().width).toBe(520)

    // Return to w1: restored from persistence.
    store.init('w1')
    expect(useWorkspacePanelStore.getState().open).toBe(true)
    expect(useWorkspacePanelStore.getState().mounted).toBe(true)
    expect(useWorkspacePanelStore.getState().width).toBe(640)
  })

  it('does not lose a pending save when switching workspaces quickly', async () => {
    const store = useWorkspacePanelStore.getState()
    store.init('w-fast-a')
    store.openPanel()
    store.setWidth(611)
    store.init('w-fast-b')
    store.openPanel()
    store.setWidth(722)
    await new Promise((resolve) => setTimeout(resolve, 260))

    expect(localStorage.getItem('paralith.toolpanel.w-fast-a')).toContain('"width":611')
    expect(localStorage.getItem('paralith.toolpanel.w-fast-b')).toContain('"width":722')
  })
})
