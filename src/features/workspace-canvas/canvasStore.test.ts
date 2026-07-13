import { beforeEach, describe, expect, it } from 'vitest'
import { useCanvasStore } from './canvasStore'
import type { PaneDragSession, WorkspaceCanvasLayout } from './canvasTypes'

function layout(): WorkspaceCanvasLayout {
  return {
    version: 2,
    dockedRoot: { type: 'split', direction: 'vertical', sizes: [50, 50], children: [{ type: 'pane', paneId: 'a' }, { type: 'pane', paneId: 'b' }] },
    floatingPanes: [],
    activePaneId: 'a',
    nextFloatingZIndex: 1,
  }
}

function drag(): PaneDragSession {
  return { paneId: 'a', sourcePlacement: 'docked', pointerId: 1, pointerOffsetX: 0, pointerOffsetY: 0, previewRect: { x: 0, y: 0, width: 100, height: 100 }, startedAt: 0, phase: 'dragging' }
}

describe('useCanvasStore', () => {
  beforeEach(() => useCanvasStore.getState().reset())

  it('keeps transient drag state separate from the persisted layout', () => {
    const store = useCanvasStore.getState()
    store.init('ws', layout(), 3)
    store.startDrag(drag())
    store.updateDrag({ previewRect: { x: 10, y: 10, width: 100, height: 100 }, activeDropTarget: { kind: 'float', rect: { x: 10, y: 10, width: 100, height: 100 } } })

    const state = useCanvasStore.getState()
    // The layout is untouched while dragging — only transient state changed.
    expect(state.layout).toEqual(layout())
    expect(state.drag?.previewRect.x).toBe(10)
    expect(state.revision).toBe(3)

    state.clearDrag()
    expect(useCanvasStore.getState().drag).toBeUndefined()
  })

  it('toggles maximize on and off in the layout only', () => {
    const store = useCanvasStore.getState()
    store.init('ws', layout(), 0)
    store.toggleMaximize('b')
    expect(useCanvasStore.getState().layout?.maximizedPaneId).toBe('b')
    useCanvasStore.getState().toggleMaximize('b')
    expect(useCanvasStore.getState().layout?.maximizedPaneId).toBeUndefined()
  })

  it('brings a floating pane to the front without persisting', () => {
    const store = useCanvasStore.getState()
    store.init('ws', {
      ...layout(),
      dockedRoot: { type: 'pane', paneId: 'a' },
      floatingPanes: [{ paneId: 'b', rect: { x: 0, y: 0, width: 0.4, height: 0.4 }, zIndex: 1, createdAt: '', updatedAt: '' }],
      nextFloatingZIndex: 2,
    }, 0)
    store.bringToFront('b')
    expect(useCanvasStore.getState().layout?.floatingPanes[0].zIndex).toBeGreaterThanOrEqual(2)
    // No revision bump — focus/z-order is not persisted per interaction.
    expect(useCanvasStore.getState().revision).toBe(0)
  })
})
