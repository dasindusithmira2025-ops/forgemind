import { beforeEach, describe, expect, it } from 'vitest'
import { clampPanelWidth, useWorkspacePanelStore } from './workspacePanelStore'

function reset() {
  localStorage.clear()
  // Force a clean store between tests (init() no-ops when the id is unchanged).
  useWorkspacePanelStore.setState({ workspaceId: '', mounted: false, open: false, width: 520, maximized: false, tool: 'files' })
}

describe('workspacePanelStore', () => {
  beforeEach(reset)

  it('is closed and unmounted by default', () => {
    useWorkspacePanelStore.getState().init('w1')
    const state = useWorkspacePanelStore.getState()
    expect(state.open).toBe(false)
    expect(state.mounted).toBe(false)
  })

  it('mounts and opens the panel, and stays mounted when closed', () => {
    const store = useWorkspacePanelStore.getState()
    store.init('w1')
    store.openPanel()
    expect(useWorkspacePanelStore.getState().open).toBe(true)
    expect(useWorkspacePanelStore.getState().mounted).toBe(true)

    store.closePanel()
    // Closing hides but keeps the panel mounted so editor state survives.
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

  it('persists and restores the active tool per workspace', async () => {
    const store = useWorkspacePanelStore.getState()
    store.init('wtool')
    store.openPanel()
    store.setTool('browser')
    expect(useWorkspacePanelStore.getState().tool).toBe('browser')
    await new Promise((resolve) => setTimeout(resolve, 260))
    // Switch away (defaults back to files) then return.
    store.init('wother')
    expect(useWorkspacePanelStore.getState().tool).toBe('files')
    store.init('wtool')
    expect(useWorkspacePanelStore.getState().tool).toBe('browser')
  })

  it('ignores an unknown persisted tool and falls back to files', () => {
    localStorage.setItem('paralith.toolpanel.wbad', JSON.stringify({ open: true, width: 520, tool: 'mystery' }))
    useWorkspacePanelStore.getState().init('wbad')
    expect(useWorkspacePanelStore.getState().tool).toBe('files')
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
})
