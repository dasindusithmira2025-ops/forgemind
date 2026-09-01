import { describe, expect, it } from 'vitest'
import { insertZoneFor, resolvePanePlacement, splitDirectionFor } from './paneCreation'
import { buildPresetTree } from './layoutPresets'
import type { CanvasBounds, DockedLayoutNode, WorkspaceCanvasLayout } from './canvasTypes'

const BOUNDS: CanvasBounds = { width: 2400, height: 1300 }

function layoutOf(dockedRoot: DockedLayoutNode | null, activePaneId?: string): WorkspaceCanvasLayout {
  return { version: 2, dockedRoot, floatingPanes: [], activePaneId, nextFloatingZIndex: 1 }
}

describe('splitDirectionFor', () => {
  it('splits a wide, short pane into columns even though height is the smaller extent', () => {
    expect(splitDirectionFor({ x: 0, y: 0, width: 900, height: 300 })).toBe('vertical')
  })

  it('splits a tall, narrow pane into rows', () => {
    expect(splitDirectionFor({ x: 0, y: 0, width: 600, height: 1000 })).toBe('horizontal')
  })

  it('uses the only axis that leaves both halves usable', () => {
    expect(splitDirectionFor({ x: 0, y: 0, width: 700, height: 300 })).toBe('vertical')
    expect(splitDirectionFor({ x: 0, y: 0, width: 400, height: 800 })).toBe('horizontal')
  })

  it('reports no usable axis when the pane is already at its minimum', () => {
    expect(splitDirectionFor({ x: 0, y: 0, width: 500, height: 300 })).toBeUndefined()
  })
})

describe('resolvePanePlacement', () => {
  it('splits the focused pane along its roomiest axis', () => {
    // Each Pair column is 1197x1300 - taller than it is wide relative to the pane minimums, so
    // the new pane goes underneath rather than shaving the column into two thin strips.
    const layout = layoutOf(buildPresetTree('pair', ['a', 'b']), 'b')
    expect(resolvePanePlacement(layout, BOUNDS, 'b', 'a')).toEqual({ targetPaneId: 'b', direction: 'horizontal' })
  })

  it('splits a single full-canvas pane into columns', () => {
    const layout = layoutOf({ type: 'pane', paneId: 'only' }, 'only')
    expect(resolvePanePlacement(layout, BOUNDS, 'only', 'only')).toEqual({ targetPaneId: 'only', direction: 'vertical' })
  })

  it('falls back to the roomiest pane when the focused pane cannot be split', () => {
    // A lead pane taking most of the canvas plus a rail of panes squeezed to their minimum.
    const layout = layoutOf({
      type: 'split',
      direction: 'vertical',
      sizes: [95, 5],
      children: [
        { type: 'pane', paneId: 'lead' },
        {
          type: 'split',
          direction: 'horizontal',
          sizes: [25, 25, 25, 25],
          children: [1, 2, 3, 4].map((index) => ({ type: 'pane' as const, paneId: `rail-${index}` })),
        },
      ],
    }, 'rail-1')
    expect(resolvePanePlacement(layout, BOUNDS, 'rail-1', 'lead')).toEqual({ targetPaneId: 'lead', direction: 'vertical' })
  })

  it('still places a pane when nothing fits rather than refusing creation', () => {
    const layout = layoutOf({ type: 'pane', paneId: 'only' }, 'only')
    expect(resolvePanePlacement(layout, { width: 300, height: 200 }, 'only', 'only')).toEqual({ targetPaneId: 'only', direction: 'vertical' })
  })

  it('uses the fallback pane when there is no layout to measure', () => {
    expect(resolvePanePlacement(null, BOUNDS, undefined, 'seed')).toEqual({ targetPaneId: 'seed', direction: 'vertical' })
  })
})

describe('insertZoneFor', () => {
  it('maps split axes onto the dock zones a new pane occupies', () => {
    expect(insertZoneFor('vertical')).toBe('right')
    expect(insertZoneFor('horizontal')).toBe('bottom')
  })
})
