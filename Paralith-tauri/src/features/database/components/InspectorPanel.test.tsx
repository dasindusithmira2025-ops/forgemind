import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useDatabaseStore } from '../databaseStore'
import type { DatabaseObjectDetail, DatabaseTable } from '../databaseTypes'
import { InspectorPanel } from './InspectorPanel'

afterEach(() => useDatabaseStore.getState().reset())

function emptyTable(id: string, layer: DatabaseTable['meta']['layer'] = 'declared'): DatabaseTable {
  return {
    meta: { identity: { id, logicalKey: 'orders', qualifiedName: 'orders', previousIds: [] }, sourceId: 's1', layer, confidence: 1, provenanceIds: [], discoveredAt: '', observedAt: '', updatedAt: '', contentFingerprint: 'f' },
    namespaceId: 'ns1',
    name: 'orders',
    columnIds: [],
    foreignKeyIds: [],
    uniqueConstraintIds: [],
    checkConstraintIds: [],
    indexIds: [],
  }
}

function emptyDetail(table: DatabaseTable): DatabaseObjectDetail {
  return {
    table,
    columns: [],
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    incomingForeignKeys: [],
    usage: [],
    migrations: [],
    issues: [],
    provenance: [],
  }
}

function openInspector(table: DatabaseTable, detail: DatabaseObjectDetail) {
  useDatabaseStore.setState({
    selection: { tableIds: [table.meta.identity.id], columnIds: [], relationshipIds: [], namespaceIds: [], focusedId: table.meta.identity.id },
    objectDetails: { [table.meta.identity.id]: detail },
    objectDetailLoad: { [table.meta.identity.id]: { status: 'ready' } },
  })
  render(<InspectorPanel />)
}

function openTab(label: string) {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

describe('InspectorPanel selection states', () => {
  it('shows a neutral prompt when nothing is selected', () => {
    render(<InspectorPanel />)
    expect(screen.getByText('Select a table to inspect it.')).toBeInTheDocument()
  })

  it('collapses to a summary card when multiple objects are selected', () => {
    useDatabaseStore.setState({ selection: { tableIds: ['a', 'b'], columnIds: [], relationshipIds: [], namespaceIds: [] } })
    render(<InspectorPanel />)
    expect(screen.getByText('2 objects selected')).toBeInTheDocument()
  })
})

describe('InspectorPanel per-tab empty states (UI-SPEC.md §4)', () => {
  it('Columns: "No columns declared"', () => {
    const table = emptyTable('t1', 'proposed')
    openInspector(table, emptyDetail(table))
    openTab('Columns')
    expect(screen.getByText('No columns declared')).toBeInTheDocument()
  })

  it('Relations (Declared layer): "No relationships." without the Design-mode CTA', () => {
    const table = emptyTable('t1', 'declared')
    openInspector(table, emptyDetail(table))
    openTab('Relations')
    expect(screen.getByText('No relationships.')).toBeInTheDocument()
  })

  it('Relations (Proposed layer): includes the "Add one from Design mode." CTA copy', () => {
    const table = emptyTable('t1', 'proposed')
    openInspector(table, emptyDetail(table))
    openTab('Relations')
    expect(screen.getByText(/Add one from Design mode\./)).toBeInTheDocument()
  })

  it('Constraints: "No constraints beyond the primary key"', () => {
    const table = emptyTable('t1')
    openInspector(table, emptyDetail(table))
    openTab('Constraints')
    expect(screen.getByText('No constraints beyond the primary key')).toBeInTheDocument()
  })

  it('Indexes: "No indexes declared"', () => {
    const table = emptyTable('t1')
    openInspector(table, emptyDetail(table))
    openTab('Indexes')
    expect(screen.getByText('No indexes declared')).toBeInTheDocument()
  })

  it('Usage: the best-effort disclaimer copy, never implying exhaustive analysis', () => {
    const table = emptyTable('t1')
    openInspector(table, emptyDetail(table))
    openTab('Usage')
    expect(screen.getByText('No usage evidence yet. Usage tracking is best-effort and file-scoped.')).toBeInTheDocument()
  })

  it('History: "No migration history found for this object"', () => {
    const table = emptyTable('t1')
    openInspector(table, emptyDetail(table))
    openTab('History')
    expect(screen.getByText('No migration history found for this object')).toBeInTheDocument()
  })

  it('Source: "No static source — this object exists only in Observed/Proposed"', () => {
    const table = emptyTable('t1')
    openInspector(table, emptyDetail(table))
    openTab('Source')
    expect(screen.getByText('No static source — this object exists only in Observed/Proposed')).toBeInTheDocument()
  })

  it('Health: success-tone "No issues detected for this object" (not neutral)', () => {
    const table = emptyTable('t1')
    openInspector(table, emptyDetail(table))
    openTab('Health')
    const empty = screen.getByText('No issues detected for this object')
    expect(empty.closest('.db-inspector-empty-state')).toHaveClass('success')
  })

  it('Definition: warning-tone "No definition recorded" for a dangling reference with no columns/FKs/comment', () => {
    const table = emptyTable('t1')
    openInspector(table, emptyDetail(table))
    const empty = screen.getByText('No definition recorded')
    expect(empty.closest('.db-inspector-empty-state')).toHaveClass('warning')
  })
})
