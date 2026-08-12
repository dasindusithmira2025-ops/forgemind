import { useEffect, useMemo, useRef } from 'react'
import { useDatabaseStore } from '../../databaseStore'
import { SectionError } from '../SectionError'
import { buildTableNodeViews, groupTableViews } from '../../databaseSelectors'
import { useDatabaseCanvasStore } from '../canvas/databaseCanvasStore'
import { NODE_WIDTH, estimateTableNodeHeight } from '../canvas/nodeMetrics'
import { SchemaCanvas } from '../canvas/SchemaCanvas'
import type { CanvasEdgeRef, DatabaseEdge, DatabaseZoomTier } from '../../databaseTypes'
import { LayerUnavailableNotice } from './LayerUnavailableNotice'
import { layerUnavailableReason } from './layerAvailability'

/** The canvas' visual detail tiers map onto the backend's numeric semantic LOD. */
const ZOOM_TIER_BY_LOD: Record<string, DatabaseZoomTier> = {
  far: 'overview',
  medium: 'keys',
  near: 'detail',
}

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
  const setHideUnrelated = useDatabaseStore((state) => state.setHideUnrelated)
  const setNHop = useDatabaseStore((state) => state.setNHop)
  const setGroupBy = useDatabaseStore((state) => state.setGroupBy)
  const pinnedPositions = useDatabaseStore((state) => state.pinnedPositions)
  const setPinnedPosition = useDatabaseStore((state) => state.setPinnedPosition)
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)
  const activeLayer = useDatabaseStore((state) => state.activeLayer)
  const selectRelationship = useDatabaseStore((state) => state.selectRelationship)
  const revealTarget = useDatabaseStore((state) => state.revealTarget)
  const clearRevealTarget = useDatabaseStore((state) => state.clearRevealTarget)

  const recomputeLayout = useDatabaseCanvasStore((state) => state.recomputeLayout)
  const layoutPending = useDatabaseCanvasStore((state) => state.layoutPending)
  const canvasLod = useDatabaseCanvasStore((state) => state.lod)
  const publishCanvasState = useDatabaseStore((state) => state.publishCanvasState)
  const setSemanticLod = useDatabaseStore((state) => state.setSemanticLod)
  const publishTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (schemaLoad.status === 'idle' && activeSourceId) void loadSchema()
  }, [schemaLoad.status, activeSourceId, loadSchema])

  const pinnedIds = useMemo(() => new Set(Object.keys(pinnedPositions)), [pinnedPositions])
  const selectedEdgeIds = useMemo(() => new Set(selection.relationshipIds), [selection.relationshipIds])
  const tables = useMemo(() => buildTableNodeViews(schemaPage, pinnedIds), [schemaPage, pinnedIds])
  const groups = useMemo(() => groupTableViews(tables), [tables])
  const canvasEdges: CanvasEdgeRef[] = useMemo(
    () => (schemaPage?.edges ?? [])
      .filter((edge): edge is DatabaseEdge => edge.edgeType === 'REFERENCES')
      .map((edge) => ({ id: edge.id, from: edge.sourceObjectId, to: edge.targetObjectId })),
    [schemaPage],
  )

  // Pinned positions are layout *input*, so they belong in the fingerprint: without them a pin
  // would be recorded but never applied, because the recompute would be skipped as a no-op.
  const pinnedFingerprint = useMemo(
    () => Object.entries(pinnedPositions)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, position]) => `${id}@${Math.round(position.x)},${Math.round(position.y)}`)
      .join('|'),
    [pinnedPositions],
  )

  // Graph identity *without* pinned positions: this is what decides whether the viewport should be
  // re-framed. Including pins here would re-frame the canvas every time a card is dragged.
  const framingKey = useMemo(
    () => `${activeSourceId ?? ''}:${activeLayer}:${schemaPage?.snapshot?.fingerprint ?? tables.length}`,
    [activeSourceId, activeLayer, schemaPage?.snapshot?.fingerprint, tables.length],
  )

  const fingerprint = useMemo(
    () => `${framingKey}:${pinnedFingerprint}`,
    [framingKey, pinnedFingerprint],
  )

  useEffect(() => {
    if (tables.length === 0) return
    void recomputeLayout(
      tables.map((table) => ({ id: table.id, w: NODE_WIDTH, h: estimateTableNodeHeight(table.columns.length), group: table.groupId })),
      canvasEdges,
      pinnedPositions,
      fingerprint,
    )
  }, [fingerprint, tables, canvasEdges, pinnedPositions, recomputeLayout])

  // Zooming in asks the backend for more of the graph rather than rendering detail it never sent.
  useEffect(() => {
    setSemanticLod(canvasLod === 'far' ? 0 : canvasLod === 'medium' ? 2 : 3)
  }, [canvasLod, setSemanticLod])

  // Publish the semantic canvas state (selection + what is on screen) so an agent asked to act on
  // "these tables" receives exactly the objects the developer is looking at. Debounced, because
  // selection and zoom change far more often than an agent reads them.
  useEffect(() => {
    if (!activeSourceId || tables.length === 0) return
    clearTimeout(publishTimer.current)
    publishTimer.current = setTimeout(() => {
      void publishCanvasState(
        ZOOM_TIER_BY_LOD[canvasLod] ?? 'keys',
        tables.map((table) => table.id),
      )
    }, 250)
    return () => clearTimeout(publishTimer.current)
  }, [activeSourceId, tables, selection, canvasLod, publishCanvasState])

  if (schemaLoad.status === 'error') {
    // An empty Observed/Proposed layer is a missing prerequisite, not a failure and not an empty
    // database. Showing a blank canvas for it would state something false.
    if (layerUnavailableReason(activeLayer, schemaLoad)) return <LayerUnavailableNotice layer={activeLayer} />
    return <SectionError load={schemaLoad} fallback="Failed to load the schema graph." onRetry={() => void loadSchema()} />
  }

  return (
    <SchemaCanvas
      tables={tables}
      groups={groups}
      edges={canvasEdges}
      selection={new Set(selection.tableIds)}
      onSelect={(id, additive) => selectObjects([id], { additive, focusedId: id })}
      hideUnrelated={filters.hideUnrelated}
      onHideUnrelatedChange={setHideUnrelated}
      nHop={filters.nHop ?? 1}
      onNHopChange={setNHop}
      grouped={filters.groupBy !== 'none'}
      onGroupedChange={(value) => setGroupBy(value ? 'namespace' : 'none')}
      loading={schemaLoad.status === 'loading' && tables.length === 0}
      layoutPending={layoutPending}
      onPinPosition={setPinnedPosition}
      onSelectEdge={selectRelationship}
      selectedEdgeIds={selectedEdgeIds}
      framingKey={framingKey}
      revealTarget={revealTarget?.section === 'diagram' ? revealTarget : undefined}
      onRevealHandled={clearRevealTarget}
    />
  )
}
