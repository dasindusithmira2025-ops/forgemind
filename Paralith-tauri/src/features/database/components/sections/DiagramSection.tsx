import { useEffect, useMemo } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useDatabaseStore } from '../../databaseStore'
import { buildTableNodeViews, groupTableViews } from '../../databaseSelectors'
import { useDatabaseCanvasStore } from '../canvas/databaseCanvasStore'
import { SchemaCanvas } from '../canvas/SchemaCanvas'
import type { CanvasEdgeRef, DatabaseEdge } from '../../databaseTypes'

/**
 * The Diagram section. This is the only component that triggers layout recomputation
 * (`recomputeLayout`, which internally calls `layoutClient.computeLayoutAsync`) — it does so from
 * an effect keyed on `(designRevisionId or snapshotId, table/edge fingerprint)`, never inside a
 * render body, and `SchemaCanvas`/`TableNode` only read the already-computed positions from
 * `useDatabaseCanvasStore`. This is the structural property `largeSchema.bench.test.ts` verifies.
 */
export function DiagramSection() {
  const schemaLoad = useDatabaseStore((state) => state.schemaLoad)
  const schemaPage = useDatabaseStore((state) => state.schemaPage)
  const loadSchema = useDatabaseStore((state) => state.loadSchema)
  const selection = useDatabaseStore((state) => state.selection)
  const selectObjects = useDatabaseStore((state) => state.selectObjects)
  const filters = useDatabaseStore((state) => state.filters)
  const pinnedPositions = useDatabaseStore((state) => state.pinnedPositions)
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)
  const activeLayer = useDatabaseStore((state) => state.activeLayer)

  const recomputeLayout = useDatabaseCanvasStore((state) => state.recomputeLayout)
  const layoutPending = useDatabaseCanvasStore((state) => state.layoutPending)

  useEffect(() => {
    if (schemaLoad.status === 'idle' && activeSourceId) void loadSchema()
  }, [schemaLoad.status, activeSourceId, loadSchema])

  const pinnedIds = useMemo(() => new Set(Object.keys(pinnedPositions)), [pinnedPositions])
  const tables = useMemo(() => buildTableNodeViews(schemaPage, pinnedIds), [schemaPage, pinnedIds])
  const groups = useMemo(() => groupTableViews(tables), [tables])
  const canvasEdges: CanvasEdgeRef[] = useMemo(
    () => (schemaPage?.edges ?? [])
      .filter((edge): edge is DatabaseEdge => edge.edgeType === 'REFERENCES')
      .map((edge) => ({ id: edge.id, from: edge.sourceObjectId, to: edge.targetObjectId })),
    [schemaPage],
  )

  const fingerprint = useMemo(
    () => `${activeSourceId ?? ''}:${activeLayer}:${schemaPage?.snapshot?.fingerprint ?? tables.length}`,
    [activeSourceId, activeLayer, schemaPage, tables.length],
  )

  useEffect(() => {
    if (tables.length === 0) return
    void recomputeLayout(
      tables.map((table) => ({ id: table.id, w: 220, h: 140, group: table.groupId })),
      canvasEdges,
      pinnedPositions,
      fingerprint,
    )
  }, [fingerprint, tables, canvasEdges, pinnedPositions, recomputeLayout])

  if (schemaLoad.status === 'error') {
    return (
      <div className="db-section-error">
        <AlertTriangle size={18} />
        <span>{schemaLoad.errorMessage ?? 'Failed to load the schema graph.'}</span>
        <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => void loadSchema()}>Retry</Button>
      </div>
    )
  }

  return (
    <SchemaCanvas
      tables={tables}
      groups={groups}
      edges={canvasEdges}
      selection={new Set(selection.tableIds)}
      onSelect={(id, additive) => selectObjects([id], { additive, focusedId: id })}
      hideUnrelated={filters.hideUnrelated}
      nHop={filters.nHop ?? 1}
      loading={schemaLoad.status === 'loading' && tables.length === 0}
      layoutPending={layoutPending}
    />
  )
}
