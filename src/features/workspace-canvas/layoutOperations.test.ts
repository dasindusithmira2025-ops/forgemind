import { describe, expect, it } from 'vitest'
import {
  allPaneIds,
  applyDrop,
  bringFloatingToFront,
  collapseRedundantSplits,
  countSubMinPanes,
  dockFloatingPane,
  dockPaneAtCanvasEdge,
  dockedPaneIds,
  dropPreservesMinimumSizes,
  findDockPath,
  floatPane,
  insertPaneBesideTarget,
  movePaneBeside,
  removePaneFromDockedTree,
  swapPaneLocations,
  swapPanePlacements,
  validateCanvasLayout,
} from './layoutOperations'
import type { DockedLayoutNode, PaneDragSession, WorkspaceCanvasLayout } from './canvasTypes'

const NOW = '2026-07-13T00:00:00.000Z'

function pane(id: string): DockedLayoutNode {
  return { type: 'pane', paneId: id }
}

function baseLayout(root: DockedLayoutNode | null): WorkspaceCanvasLayout {
  return { version: 2, dockedRoot: root, floatingPanes: [], activePaneId: undefined, nextFloatingZIndex: 1 }
}

describe('findDockPath', () => {
  it('locates nested panes', () => {
    const tree: DockedLayoutNode = { type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), { type: 'split', direction: 'horizontal', sizes: [50, 50], children: [pane('b'), pane('c')] }] }
    expect(findDockPath(tree, 'a')).toEqual([0])
    expect(findDockPath(tree, 'c')).toEqual([1, 1])
    expect(findDockPath(tree, 'z')).toBeUndefined()
  })
})

describe('insertPaneBesideTarget', () => {
  it('wraps a lone pane on the left', () => {
    const result = insertPaneBesideTarget(pane('a'), 'a', 'b', 'left')
    expect(result).toEqual({ type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('b'), pane('a')] })
  })

  it('wraps a lone pane below', () => {
    const result = insertPaneBesideTarget(pane('a'), 'a', 'b', 'bottom')
    expect(result).toEqual({ type: 'split', direction: 'horizontal', sizes: [50, 50], children: [pane('a'), pane('b')] })
  })

  it('merges into a same-direction parent split', () => {
    const tree: DockedLayoutNode = { type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] }
    const result = insertPaneBesideTarget(tree, 'a', 'c', 'right')
    expect(result.type).toBe('split')
    if (result.type === 'split') {
      expect(result.children.map((child) => (child.type === 'pane' ? child.paneId : '?'))).toEqual(['a', 'c', 'b'])
      expect(result.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(100)
    }
  })

  it('keeps a same-direction row balanced (equal shares) when splicing in a pane', () => {
    const tree: DockedLayoutNode = { type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] }
    const result = insertPaneBesideTarget(tree, 'a', 'c', 'right')
    if (result.type === 'split') {
      // Three equal columns rather than shrinking the drop target to a quarter.
      expect(result.sizes).toHaveLength(3)
      for (const size of result.sizes) expect(size).toBeCloseTo(100 / 3, 6)
    }
  })

  it('throws when the target is missing', () => {
    expect(() => insertPaneBesideTarget(pane('a'), 'z', 'b', 'left')).toThrow(/not be found|not found/)
  })
})

describe('removePaneFromDockedTree', () => {
  it('collapses a split down to the surviving sibling', () => {
    const tree: DockedLayoutNode = { type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] }
    expect(removePaneFromDockedTree(tree, 'a')).toEqual(pane('b'))
  })
  it('returns null when the last pane is removed', () => {
    expect(removePaneFromDockedTree(pane('a'), 'a')).toBeNull()
  })
  it('preserves remaining ids in a larger tree', () => {
    const tree: DockedLayoutNode = { type: 'split', direction: 'vertical', sizes: [33, 33, 34], children: [pane('a'), pane('b'), pane('c')] }
    const result = removePaneFromDockedTree(tree, 'b')
    expect(dockedPaneIds(result)).toEqual(['a', 'c'])
  })
})

describe('swapPaneLocations', () => {
  it('swaps two ids in place', () => {
    const tree: DockedLayoutNode = { type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] }
    expect(swapPaneLocations(tree, 'a', 'b')).toEqual({ type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('b'), pane('a')] })
  })
})

describe('collapseRedundantSplits', () => {
  it('flattens nested same-direction splits', () => {
    const tree: DockedLayoutNode = {
      type: 'split', direction: 'vertical', sizes: [50, 50],
      children: [pane('a'), { type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('b'), pane('c')] }],
    }
    const result = collapseRedundantSplits(tree)
    expect(dockedPaneIds(result)).toEqual(['a', 'b', 'c'])
    if (result.type === 'split') {
      expect(result.children).toHaveLength(3)
      expect(result.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(100)
    }
  })
})

describe('floatPane / dockFloatingPane', () => {
  it('moves a docked pane into the floating layer and records its previous path', () => {
    const layout = baseLayout({ type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] })
    const rect = { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }
    const next = floatPane(layout, 'a', rect, NOW)
    expect(dockedPaneIds(next.dockedRoot)).toEqual(['b'])
    expect(next.floatingPanes).toHaveLength(1)
    expect(next.floatingPanes[0].previousDockPath).toEqual([0])
    expect(next.nextFloatingZIndex).toBe(2)
    expect(allPaneIds(next).sort()).toEqual(['a', 'b'])
  })

  it('docks a floating pane back beside a target', () => {
    let layout = baseLayout({ type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] })
    layout = floatPane(layout, 'a', { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, NOW)
    const docked = dockFloatingPane(layout, 'a', { targetPaneId: 'b', zone: 'bottom' })
    expect(docked.floatingPanes).toHaveLength(0)
    expect(dockedPaneIds(docked.dockedRoot).sort()).toEqual(['a', 'b'])
  })

  it('docks a floating pane as the root when the tree is empty', () => {
    let layout = baseLayout(pane('a'))
    layout = floatPane(layout, 'a', { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, NOW)
    expect(layout.dockedRoot).toBeNull()
    const docked = dockFloatingPane(layout, 'a', undefined)
    expect(docked.dockedRoot).toEqual(pane('a'))
  })
})

describe('swapPanePlacements', () => {
  it('swaps two docked panes', () => {
    const layout = baseLayout({ type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] })
    const result = swapPanePlacements(layout, 'a', 'b', NOW)
    expect(dockedPaneIds(result.dockedRoot)).toEqual(['b', 'a'])
  })

  it('exchanges a floating pane with a docked pane', () => {
    let layout = baseLayout({ type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] })
    layout = floatPane(layout, 'a', { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, NOW)
    // Now a floats, b docked. Swap a (floating) with b (docked).
    const result = swapPanePlacements(layout, 'a', 'b', NOW)
    expect(dockedPaneIds(result.dockedRoot)).toEqual(['a'])
    expect(result.floatingPanes.map((floating) => floating.paneId)).toEqual(['b'])
    expect(allPaneIds(result).sort()).toEqual(['a', 'b'])
  })
})

describe('bringFloatingToFront', () => {
  it('raises a floating pane above the others', () => {
    let layout = baseLayout(null)
    layout = { ...layout, floatingPanes: [
      { paneId: 'a', rect: { x: 0, y: 0, width: 0.4, height: 0.4 }, zIndex: 1, createdAt: NOW, updatedAt: NOW },
      { paneId: 'b', rect: { x: 0.2, y: 0.2, width: 0.4, height: 0.4 }, zIndex: 2, createdAt: NOW, updatedAt: NOW },
    ], nextFloatingZIndex: 3 }
    const result = bringFloatingToFront(layout, 'a')
    const a = result.floatingPanes.find((floating) => floating.paneId === 'a')!
    const b = result.floatingPanes.find((floating) => floating.paneId === 'b')!
    expect(a.zIndex).toBeGreaterThan(b.zIndex)
  })
})

describe('validateCanvasLayout', () => {
  it('accepts a coherent layout', () => {
    const layout = baseLayout({ type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] })
    expect(() => validateCanvasLayout(layout, ['a', 'b'])).not.toThrow()
  })

  it('rejects a duplicate pane across docked + floating', () => {
    const layout: WorkspaceCanvasLayout = {
      version: 2,
      dockedRoot: pane('a'),
      floatingPanes: [{ paneId: 'a', rect: { x: 0, y: 0, width: 0.4, height: 0.4 }, zIndex: 1, createdAt: NOW, updatedAt: NOW }],
      nextFloatingZIndex: 2,
    }
    expect(() => validateCanvasLayout(layout)).toThrow(/more than once/)
  })

  it('rejects an unknown or missing pane reference', () => {
    const layout = baseLayout(pane('a'))
    expect(() => validateCanvasLayout(layout, ['a', 'b'])).toThrow(/not placed/)
    expect(() => validateCanvasLayout(baseLayout(pane('x')), ['a'])).toThrow(/unknown pane/)
  })
})

describe('movePaneBeside', () => {
  it('moves a docked pane beside another, leaving no duplicate', () => {
    const layout = baseLayout({ type: 'split', direction: 'vertical', sizes: [33, 33, 34], children: [pane('a'), pane('b'), pane('c')] })
    const result = movePaneBeside(layout, 'a', 'c', 'bottom')
    expect(allPaneIds(result).sort()).toEqual(['a', 'b', 'c'])
    expect(result.floatingPanes).toHaveLength(0)
  })
})

describe('applyDrop', () => {
  const bounds = { width: 1000, height: 800 }
  function session(paneId: string, placement: 'docked' | 'floating'): PaneDragSession {
    return { paneId, sourcePlacement: placement, pointerId: 1, pointerOffsetX: 0, pointerOffsetY: 0, previewRect: { x: 0, y: 0, width: 360, height: 220 }, startedAt: 0, phase: 'dragging' }
  }

  it('never floats: a canvas-edge snap docks the pane as a root column', () => {
    const layout = baseLayout({ type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] })
    const result = applyDrop(layout, session('a', 'docked'), { kind: 'canvas-snap', zone: 'left-half', rect: { x: 0, y: 0, width: 500, height: 800 } }, bounds, NOW)
    expect(result.floatingPanes).toHaveLength(0)
    expect(dockedPaneIds(result.dockedRoot)).toEqual(['a', 'b'])
  })

  it('docks beside a target pane', () => {
    const layout = baseLayout({ type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] })
    const result = applyDrop(layout, session('a', 'docked'), { kind: 'pane-dock', targetPaneId: 'b', zone: 'bottom', rect: { x: 0, y: 0, width: 10, height: 10 } }, bounds, NOW)
    expect(result.floatingPanes).toHaveLength(0)
    expect(dockedPaneIds(result.dockedRoot).sort()).toEqual(['a', 'b'])
  })

  it('swaps on a centre drop', () => {
    const layout = baseLayout({ type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] })
    const result = applyDrop(layout, session('a', 'docked'), { kind: 'pane-dock', targetPaneId: 'b', zone: 'center', rect: { x: 0, y: 0, width: 10, height: 10 } }, bounds, NOW)
    expect(dockedPaneIds(result.dockedRoot)).toEqual(['b', 'a'])
  })

  it('returns the layout unchanged on invalid / return-home / no target', () => {
    const layout = baseLayout({ type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] })
    expect(applyDrop(layout, session('a', 'docked'), { kind: 'invalid', rect: { x: 0, y: 0, width: 10, height: 10 } }, bounds, NOW)).toEqual(layout)
    expect(applyDrop(layout, session('a', 'docked'), { kind: 'return-home' }, bounds, NOW)).toEqual(layout)
    expect(applyDrop(layout, session('a', 'docked'), undefined, bounds, NOW)).toEqual(layout)
  })
})

describe('dockPaneAtCanvasEdge', () => {
  it('wraps the root as a right-hand column, flattening a same-direction root', () => {
    const layout = baseLayout({ type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] })
    const result = dockPaneAtCanvasEdge(layout, 'a', 'right-half')
    // 'a' pulled out and re-docked to the right edge → order becomes b, a.
    expect(dockedPaneIds(result.dockedRoot)).toEqual(['b', 'a'])
    expect(result.floatingPanes).toHaveLength(0)
  })

  it('stacks the pane as a top row for a top-half snap', () => {
    const layout = baseLayout({ type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] })
    const result = dockPaneAtCanvasEdge(layout, 'a', 'top-half')
    const root = result.dockedRoot!
    expect(root.type).toBe('split')
    if (root.type === 'split') {
      expect(root.direction).toBe('horizontal')
      expect(root.children[0]).toEqual(pane('a'))
      expect(dockedPaneIds(root.children[1])).toEqual(['b'])
    }
  })
})

describe('countSubMinPanes / dropPreservesMinimumSizes', () => {
  const bounds = { width: 1000, height: 600 }
  const minW = 280
  const minH = 180

  it('counts panes rendered below the minimum tile size', () => {
    // Four equal columns of 1000px → 250px each, below the 280px minimum width.
    const fourCols: DockedLayoutNode = {
      type: 'split', direction: 'vertical', sizes: [25, 25, 25, 25],
      children: [pane('a'), pane('b'), pane('c'), pane('d')],
    }
    expect(countSubMinPanes(fourCols, bounds, minW, minH)).toBe(4)
    expect(countSubMinPanes({ type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] }, bounds, minW, minH)).toBe(0)
  })

  it('rejects a drop that newly squeezes panes below the minimum', () => {
    // Three columns already fit (≈333px each). Adding a fourth would drop them below 280px.
    const threeCols: DockedLayoutNode = {
      type: 'split', direction: 'vertical', sizes: [34, 33, 33], children: [pane('a'), pane('b'), pane('c')],
    }
    const fourCols: DockedLayoutNode = {
      type: 'split', direction: 'vertical', sizes: [25, 25, 25, 25], children: [pane('a'), pane('b'), pane('c'), pane('d')],
    }
    expect(dropPreservesMinimumSizes(threeCols, fourCols, bounds)).toBe(false)
  })

  it('allows rearranging within an already-too-small canvas (never locks out)', () => {
    const tiny = { width: 200, height: 200 }
    const before: DockedLayoutNode = { type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('a'), pane('b')] }
    const after: DockedLayoutNode = { type: 'split', direction: 'vertical', sizes: [50, 50], children: [pane('b'), pane('a')] }
    expect(dropPreservesMinimumSizes(before, after, tiny)).toBe(true)
  })
})
