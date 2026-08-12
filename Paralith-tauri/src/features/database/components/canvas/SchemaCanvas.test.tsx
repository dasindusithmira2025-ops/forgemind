import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { SchemaCanvas } from './SchemaCanvas'
import { useDatabaseCanvasStore } from './databaseCanvasStore'
import type { DatabaseTableNodeView } from '../../databaseTypes'

function table(id: string, name: string): DatabaseTableNodeView {
  return {
    id,
    qualifiedName: `public.${name}`,
    name,
    groupId: 'public',
    groupLabel: 'public',
    columns: [],
    relationCount: 0,
    issueCount: 0,
    pinned: false,
  }
}

const tables = [table('table:users', 'users')]

function renderCanvas(onPinPosition = vi.fn(), overrides: Partial<DatabaseTableNodeView> = {}) {
  render(
    <SchemaCanvas
      tables={[{ ...tables[0], ...overrides }]}
      groups={[{ id: 'public', label: 'public', tableIds: ['table:users'], issueCount: 0 }]}
      edges={[]}
      selection={new Set()}
      onSelect={vi.fn()}
      hideUnrelated={false}
      onHideUnrelatedChange={vi.fn()}
      nHop={1}
      onNHopChange={vi.fn()}
      grouped={false}
      onGroupedChange={vi.fn()}
      loading={false}
      layoutPending={false}
      onPinPosition={onPinPosition}
      onSelectEdge={vi.fn()}
      selectedEdgeIds={new Set()}
      framingKey="test"
      onRevealHandled={vi.fn()}
    />,
  )
  return onPinPosition
}

beforeEach(() => {
  act(() => {
    useDatabaseCanvasStore.setState({
      positions: { 'table:users': { x: 100, y: 60 } },
      bounds: { width: 400, height: 300 },
      viewport: { x: 0, y: 0, zoom: 1 },
    })
  })
})

afterEach(() => {
  act(() => {
    useDatabaseCanvasStore.setState({ positions: {}, bounds: { width: 0, height: 0 }, viewport: { x: 0, y: 0, zoom: 0.6 } })
  })
})

describe('dragging a table pins it', () => {
  it('reports the dropped world position, so layout stops moving the card', () => {
    const onPin = renderCanvas()
    const node = document.querySelector('[data-node-id="table:users"]') as HTMLElement

    fireEvent.pointerDown(node, { button: 0, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(window, { clientX: 260, clientY: 230 })
    fireEvent.pointerUp(window)

    // Screen delta divided by zoom (1 here) applied to the node's stored world position.
    expect(onPin).toHaveBeenCalledWith('table:users', { x: 160, y: 90 })
  })

  it('converts the drag through the current zoom rather than using raw screen pixels', () => {
    act(() => useDatabaseCanvasStore.setState({ viewport: { x: 0, y: 0, zoom: 2 } }))
    const onPin = renderCanvas()
    const node = document.querySelector('[data-node-id="table:users"]') as HTMLElement

    fireEvent.pointerDown(node, { button: 0, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(window, { clientX: 260, clientY: 200 })
    fireEvent.pointerUp(window)

    expect(onPin).toHaveBeenCalledWith('table:users', { x: 130, y: 60 })
  })

  it('treats a press without travel as a click, not a pin', () => {
    const onPin = renderCanvas()
    const node = document.querySelector('[data-node-id="table:users"]') as HTMLElement

    fireEvent.pointerDown(node, { button: 0, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(window, { clientX: 201, clientY: 201 })
    fireEvent.pointerUp(window)

    expect(onPin).not.toHaveBeenCalled()
  })

  it('offers a control to release a pinned table back to automatic layout', () => {
    const onPin = renderCanvas(vi.fn(), { pinned: true })
    fireEvent.click(screen.getByRole('button', { name: 'Release pinned position' }))
    expect(onPin).toHaveBeenCalledWith('table:users', undefined)
  })

  it('stops driving the canvas once unmounted mid-drag', () => {
    const onPin = vi.fn()
    const { unmount } = render(
      <SchemaCanvas
        tables={tables}
        groups={[{ id: 'public', label: 'public', tableIds: ['table:users'], issueCount: 0 }]}
        edges={[]}
        selection={new Set()}
        onSelect={vi.fn()}
        hideUnrelated={false}
        onHideUnrelatedChange={vi.fn()}
        nHop={1}
        onNHopChange={vi.fn()}
        grouped={false}
        onGroupedChange={vi.fn()}
        loading={false}
        layoutPending={false}
        onPinPosition={onPin}
        onSelectEdge={vi.fn()}
        selectedEdgeIds={new Set()}
        framingKey="test"
        onRevealHandled={vi.fn()}
      />,
    )
    const node = document.querySelector('[data-node-id="table:users"]') as HTMLElement
    fireEvent.pointerDown(node, { button: 0, clientX: 200, clientY: 200 })
    unmount()

    // The old handlers were only removed on pointerup, so a gesture interrupted by an unmount left
    // a listener attached to `window` for the life of the session.
    fireEvent.pointerMove(window, { clientX: 400, clientY: 400 })
    fireEvent.pointerUp(window)
    expect(onPin).not.toHaveBeenCalled()
  })
})
