import { describe, expect, it } from 'vitest'
import {
  buildCanvasLayout,
  emptyCanvasExtras,
  migrateWorkspaceToCanvas,
  normalizeRestoredLayout,
  toCanvasExtras,
  type CanvasExtras,
} from './canvasPersistence'
import { allPaneIds, dockedPaneIds } from './layoutOperations'
import type { DockedLayoutNode, WorkspaceCanvasLayout } from './canvasTypes'
import type { PaneAssignment, Workspace } from '../../native/types'

const NOW = '2026-07-13T00:00:00.000Z'

function assignment(id: string): PaneAssignment {
  return { id, title: id, provider: 'powershell', executablePath: 'x', args: [], workingDirectory: '/', workingDirectoryMode: 'project_relative', positionOrder: 0 }
}

function workspace(root: DockedLayoutNode, ids: string[], activePaneId?: string): Workspace {
  return {
    id: 'ws', projectId: 'p', name: 'W', normalizedName: 'w', layout: root, activePaneId,
    restoreBehavior: 'inherit', panes: ids.map(assignment),
    createdAt: NOW, updatedAt: NOW, lastOpenedAt: NOW,
  }
}

const twoColumn: DockedLayoutNode = { type: 'split', direction: 'vertical', sizes: [50, 50], children: [{ type: 'pane', paneId: 'a' }, { type: 'pane', paneId: 'b' }] }

describe('migrateWorkspaceToCanvas', () => {
  it('produces a v2 layout with an empty floating layer', () => {
    const layout = migrateWorkspaceToCanvas(workspace(twoColumn, ['a', 'b'], 'a'))
    expect(layout.version).toBe(2)
    expect(layout.floatingPanes).toEqual([])
    expect(layout.activePaneId).toBe('a')
    expect(dockedPaneIds(layout.dockedRoot)).toEqual(['a', 'b'])
  })

  it('is idempotent: migrating already-migrated extras changes nothing structural', () => {
    const ws = workspace(twoColumn, ['a', 'b'], 'a')
    const first = migrateWorkspaceToCanvas(ws)
    const extras = toCanvasExtras(first)
    const second = buildCanvasLayout(ws, extras)
    expect(second).toEqual(first)
  })
})

describe('buildCanvasLayout with extras', () => {
  it('migrates legacy floating panes into the docked tree', () => {
    const extras: CanvasExtras = {
      version: 2,
      floatingPanes: [{ paneId: 'a', rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, zIndex: 1, createdAt: NOW, updatedAt: NOW }],
      nextFloatingZIndex: 2,
    }
    // 'a' was floating in an older build; on load it must be docked so nothing overlaps.
    const ws = workspace({ type: 'pane', paneId: 'b' }, ['a', 'b'])
    const layout = buildCanvasLayout(ws, extras)
    expect(layout.floatingPanes).toHaveLength(0)
    expect(dockedPaneIds(layout.dockedRoot).sort()).toEqual(['a', 'b'])
    expect(allPaneIds(layout).sort()).toEqual(['a', 'b'])
  })
})

describe('normalizeRestoredLayout', () => {
  it('docks a legacy floating pane into the tree (no floating layer survives)', () => {
    const layout: WorkspaceCanvasLayout = {
      version: 2, dockedRoot: { type: 'pane', paneId: 'b' },
      floatingPanes: [{ paneId: 'a', rect: { x: 5, y: 5, width: 3, height: 3 }, zIndex: 1, createdAt: NOW, updatedAt: NOW }],
      nextFloatingZIndex: 2,
    }
    const result = normalizeRestoredLayout(layout, ['a', 'b'])
    expect(result.floatingPanes).toHaveLength(0)
    expect(dockedPaneIds(result.dockedRoot).sort()).toEqual(['a', 'b'])
    expect(allPaneIds(result).sort()).toEqual(['a', 'b'])
  })

  it('drops floating panes for unknown ids', () => {
    const layout: WorkspaceCanvasLayout = {
      version: 2, dockedRoot: { type: 'pane', paneId: 'a' },
      floatingPanes: [{ paneId: 'ghost', rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 }, zIndex: 1, createdAt: NOW, updatedAt: NOW }],
      nextFloatingZIndex: 2,
    }
    const result = normalizeRestoredLayout(layout, ['a'])
    expect(result.floatingPanes).toHaveLength(0)
    expect(allPaneIds(result)).toEqual(['a'])
  })

  it('re-docks a pane that was stranded by a corrupt file', () => {
    const layout: WorkspaceCanvasLayout = { version: 2, dockedRoot: { type: 'pane', paneId: 'a' }, floatingPanes: [], nextFloatingZIndex: 1 }
    const result = normalizeRestoredLayout(layout, ['a', 'b'])
    expect(allPaneIds(result).sort()).toEqual(['a', 'b'])
  })

  it('is idempotent', () => {
    const layout = buildCanvasLayout(workspace(twoColumn, ['a', 'b'], 'a'), emptyCanvasExtras())
    const once = normalizeRestoredLayout(layout, ['a', 'b'])
    const twice = normalizeRestoredLayout(once, ['a', 'b'])
    expect(twice).toEqual(once)
  })
})
