import { describe, expect, it } from 'vitest'
import { calculateDockedRects } from './geometryEngine'
import { applyLayoutPreset, buildPresetTree, orderPanesForPreset, tidyPresetFor, type LayoutPresetId } from './layoutPresets'
import { dockedPaneIds } from './layoutOperations'
import type { CanvasBounds, WorkspaceCanvasLayout } from './canvasTypes'

const BOUNDS: CanvasBounds = { width: 2400, height: 1300 }
const PRESETS: LayoutPresetId[] = ['focus', 'pair', 'workbench', 'review', 'swarm', 'tidy']

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `pane-${index + 1}`)
}

function layoutOf(paneIds: string[], activePaneId?: string): WorkspaceCanvasLayout {
  return {
    version: 2,
    dockedRoot: buildPresetTree('pair', paneIds),
    floatingPanes: [],
    activePaneId,
    nextFloatingZIndex: 1,
  }
}

describe('buildPresetTree', () => {
  it('returns null for an empty pane list', () => {
    for (const preset of PRESETS) expect(buildPresetTree(preset, [])).toBeNull()
  })

  it('preserves every pane exactly once, for every preset and pane count', () => {
    for (const preset of PRESETS) {
      for (let count = 1; count <= 9; count += 1) {
        const paneIds = ids(count)
        const tree = buildPresetTree(preset, paneIds)
        expect(dockedPaneIds(tree).sort()).toEqual([...paneIds].sort())
      }
    }
  })

  it('drops duplicate pane ids rather than placing a pane twice', () => {
    const tree = buildPresetTree('pair', ['a', 'b', 'a'])
    expect(dockedPaneIds(tree)).toEqual(['a', 'b'])
  })

  it('collapses to a bare pane when only one pane exists', () => {
    for (const preset of PRESETS) {
      expect(buildPresetTree(preset, ['solo'])).toEqual({ type: 'pane', paneId: 'solo' })
    }
  })

  it('gives the lead pane a dominant share in focus, rather than an equal split', () => {
    const { rects } = calculateDockedRects(buildPresetTree('focus', ids(4)), BOUNDS)
    const lead = rects['pane-1']
    const supporting = rects['pane-2']
    // The point of the preset: six sessions must not become six equal rectangles.
    expect(lead.width).toBeGreaterThan(supporting.width * 2)
    expect(lead.height).toBeCloseTo(BOUNDS.height, 0)
  })

  it('produces an asymmetric composition for six panes under swarm', () => {
    const { rects } = calculateDockedRects(buildPresetTree('swarm', ids(6)), BOUNDS)
    const areas = Object.values(rects).map((rect) => rect.width * rect.height)
    expect(Math.max(...areas)).toBeGreaterThan(Math.min(...areas) * 1.5)
  })

  it('spans the lead pane the full width in review', () => {
    const { rects } = calculateDockedRects(buildPresetTree('review', ids(3)), BOUNDS)
    expect(rects['pane-1'].width).toBeCloseTo(BOUNDS.width, 0)
    expect(rects['pane-2'].width).toBeLessThan(BOUNDS.width)
  })

  it('keeps every pane on-canvas and non-overlapping for every preset and count', () => {
    for (const preset of PRESETS) {
      for (let count = 1; count <= 8; count += 1) {
        const { rects } = calculateDockedRects(buildPresetTree(preset, ids(count)), BOUNDS)
        const boxes = Object.values(rects)
        expect(boxes).toHaveLength(count)
        for (const box of boxes) {
          expect(box.x).toBeGreaterThanOrEqual(-0.01)
          expect(box.y).toBeGreaterThanOrEqual(-0.01)
          expect(box.x + box.width).toBeLessThanOrEqual(BOUNDS.width + 0.01)
          expect(box.y + box.height).toBeLessThanOrEqual(BOUNDS.height + 0.01)
          expect(box.width).toBeGreaterThan(0)
          expect(box.height).toBeGreaterThan(0)
        }
        for (let a = 0; a < boxes.length; a += 1) {
          for (let b = a + 1; b < boxes.length; b += 1) {
            const overlapX = Math.min(boxes[a].x + boxes[a].width, boxes[b].x + boxes[b].width) - Math.max(boxes[a].x, boxes[b].x)
            const overlapY = Math.min(boxes[a].y + boxes[a].height, boxes[b].y + boxes[b].height) - Math.max(boxes[a].y, boxes[b].y)
            expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(0.01)
          }
        }
      }
    }
  })
})

describe('tidyPresetFor', () => {
  it('maps pane count to a shape that suits it', () => {
    expect(tidyPresetFor(0)).toBe('focus')
    expect(tidyPresetFor(1)).toBe('focus')
    expect(tidyPresetFor(2)).toBe('pair')
    expect(tidyPresetFor(3)).toBe('workbench')
    expect(tidyPresetFor(4)).toBe('review')
    expect(tidyPresetFor(7)).toBe('swarm')
  })
})

describe('orderPanesForPreset', () => {
  it('promotes the active pane to lead and keeps the rest in tree order', () => {
    const layout = layoutOf(ids(4), 'pane-3')
    expect(orderPanesForPreset(layout)).toEqual(['pane-3', 'pane-1', 'pane-2', 'pane-4'])
  })

  it('keeps tree order when the active pane is unknown', () => {
    expect(orderPanesForPreset(layoutOf(ids(3), 'ghost'))).toEqual(ids(3))
  })

  it('includes floating panes after the docked ones', () => {
    const layout: WorkspaceCanvasLayout = {
      ...layoutOf(['a', 'b']),
      floatingPanes: [{ paneId: 'c', rect: { x: 0, y: 0, width: 0.3, height: 0.3 }, zIndex: 1, createdAt: '', updatedAt: '' }],
    }
    expect(orderPanesForPreset(layout)).toEqual(['a', 'b', 'c'])
  })
})

describe('applyLayoutPreset', () => {
  it('docks floating panes and clears maximize, without losing any pane', () => {
    const layout: WorkspaceCanvasLayout = {
      ...layoutOf(['a', 'b'], 'b'),
      maximizedPaneId: 'a',
      floatingPanes: [{ paneId: 'c', rect: { x: 0, y: 0, width: 0.3, height: 0.3 }, zIndex: 1, createdAt: '', updatedAt: '' }],
    }
    const next = applyLayoutPreset(layout, 'workbench')
    expect(next.floatingPanes).toEqual([])
    expect(next.maximizedPaneId).toBeUndefined()
    expect(dockedPaneIds(next.dockedRoot).sort()).toEqual(['a', 'b', 'c'])
    // The active pane leads the composition.
    expect(dockedPaneIds(next.dockedRoot)[0]).toBe('b')
  })

  it('leaves an empty layout untouched', () => {
    const empty: WorkspaceCanvasLayout = { version: 2, dockedRoot: null, floatingPanes: [], nextFloatingZIndex: 1 }
    expect(applyLayoutPreset(empty, 'tidy')).toBe(empty)
  })

  it('does not mutate the input layout', () => {
    const layout = layoutOf(ids(3), 'pane-2')
    const snapshot = JSON.stringify(layout)
    applyLayoutPreset(layout, 'swarm')
    expect(JSON.stringify(layout)).toBe(snapshot)
  })
})
