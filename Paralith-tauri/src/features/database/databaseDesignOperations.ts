import type { DatabaseColumn, DatabaseDesignOperationKind, DatabaseTable } from './databaseTypes'

/**
 * Pure reducer applying one typed `DatabaseDesignOperationKind` to a Proposed graph. This is what
 * powers the optimistic-apply preview (UI-SPEC.md §5.1): the UI never assembles or sends a raw
 * object graph, it always applies one of these typed operations, both locally (optimistically) and
 * as the payload sent to `database_apply_design_operation`.
 *
 * Only the mutations needed for the operations WP3 exposes in V1 design mode are implemented here;
 * unhandled kinds are a documented no-op rather than a silent graph corruption, since the backend
 * remains authoritative and any operation this reducer does not understand yet will still round-trip
 * correctly once the confirmed revision returns from the server.
 */
export interface ProposedGraph {
  tables: Record<string, DatabaseTable>
  columns: Record<string, DatabaseColumn>
}

export function applyDesignOperation(graph: ProposedGraph, operation: DatabaseDesignOperationKind): ProposedGraph {
  switch (operation.kind) {
    case 'add_table':
      return { ...graph, tables: { ...graph.tables, [operation.table.meta.identity.id]: operation.table } }

    case 'rename_table': {
      const existing = graph.tables[operation.tableId]
      if (!existing) return graph
      // The synthetic Proposed id is never recomputed on rename (CONTRACTS.md §1.1) — only
      // `name`/`qualifiedName` change. `id`, `logicalKey`, and every downstream reference stay
      // byte-identical, which is what keeps selection and pinned layout positions valid.
      const renamed: DatabaseTable = {
        ...existing,
        name: operation.newName,
        meta: { ...existing.meta, identity: { ...existing.meta.identity, qualifiedName: operation.newName } },
      }
      return { ...graph, tables: { ...graph.tables, [operation.tableId]: renamed } }
    }

    case 'drop_table': {
      const next = { ...graph.tables }
      delete next[operation.tableId]
      return { ...graph, tables: next }
    }

    case 'add_column':
      return { ...graph, columns: { ...graph.columns, [operation.column.meta.identity.id]: operation.column } }

    case 'alter_column': {
      const existing = graph.columns[operation.columnId]
      if (!existing) return graph
      const patch = operation.patch
      const next: DatabaseColumn = {
        ...existing,
        name: patch.name ?? existing.name,
        dataType: patch.dataType ?? existing.dataType,
        nativeType: patch.nativeType ?? existing.nativeType,
        nullable: patch.nullable ?? existing.nullable,
        default: patch.default ? (patch.default.hasDefault ? patch.default.value : undefined) : existing.default,
      }
      return { ...graph, columns: { ...graph.columns, [operation.columnId]: next } }
    }

    case 'drop_column': {
      const next = { ...graph.columns }
      delete next[operation.columnId]
      return { ...graph, columns: next }
    }

    // AddNamespace/AddPrimaryKey/AddForeignKey/AddUniqueConstraint/AddCheckConstraint/AddIndex/
    // DropObject affect object kinds this reducer's `ProposedGraph` does not model (edges/constraints
    // live server-side and are read back on confirm); returning the graph unchanged here is correct
    // because the store's optimistic overlay only needs table/column previews per UI-SPEC.md §5.1 —
    // it never renders a fabricated FK/index before the backend confirms one.
    default:
      return graph
  }
}
