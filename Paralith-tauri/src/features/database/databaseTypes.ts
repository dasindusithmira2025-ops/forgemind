/**
 * Database Studio wire + view types (WP3).
 *
 * The `Database*` interfaces below mirror `.jcode/dbstudio/CONTRACTS.md` §1-§11 field-for-field
 * (camelCase, per the contract's serde rule) so `api.ts` can deserialize real Tauri responses
 * without a translation layer once WP2/WP4 land the backend commands. Nothing here is invented:
 * every shape traces to a named CONTRACTS.md struct/enum. FE-only view types (LOD render
 * descriptors, canvas positions, load-state wrappers) are kept in a clearly separate section and
 * are never sent to or read as if they came from the backend.
 *
 * The store treats all of this as a projection/cache — see `databaseStore.ts` and UI-SPEC.md §7.
 */

// ---------------------------------------------------------------------------------------------
// §1 Shared primitives, identity, provenance
// ---------------------------------------------------------------------------------------------

export type SemanticId = string
export type SnapshotId = string
export type DesignId = string
export type RevisionId = string
export type DbProjectId = string

export interface SemanticIdentity {
  id: SemanticId
  logicalKey: string
  qualifiedName: string
  previousIds: SemanticId[]
}

export type DatabaseLayer = 'declared' | 'observed' | 'proposed'
export type DatabaseEngine = 'postgres' | 'mysql' | 'mariadb' | 'sqlite' | 'unknown'
export type DatabaseAdapterId = 'prisma' | 'drizzle' | 'raw_sql' | 'sqlite' | 'postgres' | 'mysql'
export type EvidenceCertainty = 'exact' | 'heuristic'

export interface DatabaseObjectMeta {
  identity: SemanticIdentity
  sourceId: string
  layer: DatabaseLayer
  snapshotId?: SnapshotId
  designRevisionId?: RevisionId
  confidence: number
  provenanceIds: string[]
  discoveredAt: string
  observedAt: string
  updatedAt: string
  contentFingerprint: string
}

// ---------------------------------------------------------------------------------------------
// §2 Canonical semantic object model
// ---------------------------------------------------------------------------------------------

export interface DatabaseSource {
  id: string
  repositoryId: string
  logicalKey: string
  displayName: string
  engine: DatabaseEngine
  adapterIds: DatabaseAdapterId[]
  ownerProjectId?: DbProjectId
  consumerProjectIds: DbProjectId[]
  environmentIds: string[]
  evidenceIds: string[]
  confidence: number
  discoveredAt: string
  updatedAt: string
}

export type DatabaseEvidenceKind =
  | 'orm_schema' | 'orm_import' | 'migration_directory' | 'sql_ddl' | 'environment_reference'
  | 'compose_service' | 'connection_config' | 'sqlite_file' | 'code_usage' | 'explicit_profile'

export interface DatabaseSourceEvidence {
  id: string
  repositoryId: string
  projectId?: DbProjectId
  adapterId: DatabaseAdapterId
  evidenceKind: DatabaseEvidenceKind
  relativePath: string
  symbolOrKey?: string
  safeValueFingerprint?: string
  sourceHint?: string
  ownerSignal: number
  consumerSignal: number
  certainty: EvidenceCertainty
  confidence: number
  contentSha256: string
  extractorVersion: string
  discoveredAt: string
}

export type DatabaseEnvironmentKind = 'local' | 'development' | 'test' | 'staging' | 'production' | 'unknown'

export interface DatabaseEnvironment {
  meta: DatabaseObjectMeta
  name: string
  kind: DatabaseEnvironmentKind
  connectionProfileId?: string
  isDefault: boolean
}

export interface DatabaseNamespace {
  meta: DatabaseObjectMeta
  name: string
  catalogName?: string
  owner?: string
  comment?: string
}

export interface DatabaseTable {
  meta: DatabaseObjectMeta
  namespaceId: SemanticId
  name: string
  mappedName?: string
  comment?: string
  columnIds: SemanticId[]
  primaryKeyId?: SemanticId
  foreignKeyIds: SemanticId[]
  uniqueConstraintIds: SemanticId[]
  checkConstraintIds: SemanticId[]
  indexIds: SemanticId[]
}

export type DatabaseTypeFamily =
  | 'boolean' | 'integer' | 'decimal' | 'float' | 'text' | 'binary' | 'date' | 'time'
  | 'date_time' | 'json' | 'uuid' | 'enum' | 'geometry' | 'custom'

export interface DatabaseDataType {
  family: DatabaseTypeFamily
  length?: number
  precision?: number
  scale?: number
  arrayDimensions: number
  unsigned: boolean
}

export interface DatabaseExpression {
  normalized: string
  dialect?: string
}

export type IdentityGeneration = 'always' | 'by_default' | 'auto_increment'

export interface DatabaseColumn {
  meta: DatabaseObjectMeta
  tableId: SemanticId
  name: string
  mappedName?: string
  ordinal: number
  dataType: DatabaseDataType
  nativeType: string
  nullable: boolean
  default?: DatabaseExpression
  generated?: DatabaseExpression
  identityGeneration?: IdentityGeneration
  enumId?: SemanticId
  comment?: string
}

export interface PrimaryKey {
  meta: DatabaseObjectMeta
  tableId: SemanticId
  name?: string
  columnIds: SemanticId[]
  clustered?: boolean
}

export type ReferentialAction = 'no_action' | 'restrict' | 'cascade' | 'set_null' | 'set_default'

export interface ForeignKey {
  meta: DatabaseObjectMeta
  tableId: SemanticId
  name?: string
  columnIds: SemanticId[]
  referencedTableId: SemanticId
  referencedColumnIds: SemanticId[]
  onDelete: ReferentialAction
  onUpdate: ReferentialAction
  deferrable?: boolean
}

export interface UniqueConstraint {
  meta: DatabaseObjectMeta
  tableId: SemanticId
  name?: string
  columnIds: SemanticId[]
  nullsDistinct?: boolean
}

export interface CheckConstraint {
  meta: DatabaseObjectMeta
  tableId: SemanticId
  name?: string
  expression: DatabaseExpression
  enforced?: boolean
}

export type SortDirection = 'asc' | 'desc'
export type NullsOrder = 'first' | 'last'

export interface IndexKey {
  columnId?: SemanticId
  expression?: DatabaseExpression
  direction?: SortDirection
  nulls?: NullsOrder
}

export interface DatabaseIndex {
  meta: DatabaseObjectMeta
  tableId: SemanticId
  name: string
  unique: boolean
  method?: string
  keys: IndexKey[]
  includedColumnIds: SemanticId[]
  predicate?: DatabaseExpression
}

export interface DatabaseEnumValue {
  name: string
  ordinal: number
  mappedName?: string
}

export interface DatabaseEnum {
  meta: DatabaseObjectMeta
  namespaceId: SemanticId
  name: string
  values: DatabaseEnumValue[]
}

export interface DatabaseView {
  meta: DatabaseObjectMeta
  namespaceId: SemanticId
  name: string
  materialized: boolean
  definitionFingerprint: string
  columnIds: SemanticId[]
  dependencyIds: SemanticId[]
}

export type MigrationAppliedState = 'declared_only' | 'applied' | 'missing' | 'diverged' | 'unknown'
export type DatabaseChangeKind = 'add' | 'drop' | 'rename' | 'alter' | 'move' | 'reorder' | 'data_migration_required'

export interface DatabaseMigration {
  meta: DatabaseObjectMeta
  sourceId: string
  name: string
  relativePath: string
  sequence?: number
  checksum: string
  parentMigrationIds: SemanticId[]
  operationKinds: DatabaseChangeKind[]
  appliedState: MigrationAppliedState
}

export interface OrmFieldMapping {
  fieldName: string
  columnId?: SemanticId
  mappedName?: string
}

export interface OrmModel {
  meta: DatabaseObjectMeta
  adapterId: DatabaseAdapterId
  projectId: DbProjectId
  relativePath: string
  symbol: string
  mappedTableId?: SemanticId
  fieldMappings: OrmFieldMapping[]
}

export type DatabaseAccessKind = 'import' | 'read' | 'write' | 'read_write' | 'definition' | 'migration'

export interface SourceSpan {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export interface DatabaseUsageReference {
  id: string
  sourceId: string
  projectId: DbProjectId
  semanticObjectId?: SemanticId
  relativePath: string
  symbol?: string
  span?: SourceSpan
  access: DatabaseAccessKind
  certainty: EvidenceCertainty
  confidence: number
  contentSha256: string
  observedAt: string
}

export type DatabaseSnapshotStatus = 'building' | 'ready' | 'failed' | 'superseded'

export interface DatabaseSnapshot {
  id: SnapshotId
  sourceId: string
  layer: DatabaseLayer
  adapterId: DatabaseAdapterId
  gitRevision?: string
  parentSnapshotId?: SnapshotId
  fingerprint: string
  objectCount: number
  edgeCount: number
  extractorVersion: string
  createdAt: string
  completedAt?: string
  status: DatabaseSnapshotStatus
}

export type DatabaseDesignStatus = 'draft' | 'approved' | 'rejected' | 'archived'
export type DatabaseActor =
  | { kind: 'human'; userId: string }
  | { kind: 'agent'; sessionId: string; agentId?: string }
  | { kind: 'system' }

export interface DatabaseDesign {
  id: DesignId
  sourceId: string
  name: string
  status: DatabaseDesignStatus
  baseSnapshotId?: SnapshotId
  baseRevisionId?: RevisionId
  headRevisionId: RevisionId
  revisionNumber: number
  createdBy: DatabaseActor
  createdAt: string
  updatedAt: string
  approvedRevisionId?: RevisionId
}

export type DatabaseDesignRevisionState = 'draft' | 'approved' | 'rejected' | 'archived'

export interface DatabaseDesignRevision {
  id: RevisionId
  designId: DesignId
  parentRevisionId?: RevisionId
  mergeParentRevisionId?: RevisionId
  revisionNumber: number
  state: DatabaseDesignRevisionState
  graphFingerprint: string
  operationIds: string[]
  createdBy: DatabaseActor
  createdAt: string
  decisionBy?: DatabaseActor
  decisionAt?: string
  decisionReason?: string
}

export interface DatabaseColumnPatch {
  name?: string
  dataType?: DatabaseDataType
  nativeType?: string
  nullable?: boolean
  /** Outer `undefined` = "no change to default"; inner `null` (via `hasDefault:false`) = "clear the default". */
  default?: { hasDefault: boolean; value?: DatabaseExpression }
}

/** Tagged union — exhaustively switchable client-side per UI-SPEC.md §10 item 2. */
export type DatabaseDesignOperationKind =
  | { kind: 'add_namespace'; namespace: DatabaseNamespace }
  | { kind: 'add_table'; table: DatabaseTable }
  | { kind: 'rename_table'; tableId: SemanticId; newName: string }
  | { kind: 'drop_table'; tableId: SemanticId }
  | { kind: 'add_column'; tableId: SemanticId; column: DatabaseColumn }
  | { kind: 'alter_column'; columnId: SemanticId; patch: DatabaseColumnPatch }
  | { kind: 'drop_column'; columnId: SemanticId }
  | { kind: 'add_primary_key'; key: PrimaryKey }
  | { kind: 'add_foreign_key'; key: ForeignKey }
  | { kind: 'add_unique_constraint'; constraint: UniqueConstraint }
  | { kind: 'add_check_constraint'; constraint: CheckConstraint }
  | { kind: 'add_index'; index: DatabaseIndex }
  | { kind: 'drop_object'; objectId: SemanticId }

export interface DatabaseDesignOperation {
  id: string
  designId: DesignId
  baseRevisionId: RevisionId
  resultRevisionId: RevisionId
  sequence: number
  operation: DatabaseDesignOperationKind
  actor: DatabaseActor
  createdAt: string
}

export type DatabaseIssueCode =
  | 'drift' | 'missing_primary_key' | 'broken_reference' | 'duplicate_identity'
  | 'unsafe_change' | 'unresolved_evidence' | 'unsupported_feature' | 'connection_unavailable'
export type DatabaseIssueSeverity = 'info' | 'warning' | 'error' | 'critical'
export type DatabaseIssueStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed'

export interface DatabaseIssue {
  id: string
  sourceId: string
  snapshotId?: SnapshotId
  designRevisionId?: RevisionId
  semanticObjectIds: SemanticId[]
  code: DatabaseIssueCode
  severity: DatabaseIssueSeverity
  title: string
  explanation: string
  evidenceIds: string[]
  status: DatabaseIssueStatus
  detectedAt: string
  resolvedAt?: string
}

// ---------------------------------------------------------------------------------------------
// §2.1 Typed edges
// ---------------------------------------------------------------------------------------------

export type DatabaseEdgeType =
  | 'CONTAINS' | 'HAS_COLUMN' | 'PRIMARY_KEY' | 'REFERENCES' | 'INDEXES' | 'MAPS_TO'
  | 'DECLARED_BY' | 'CREATED_BY_MIGRATION' | 'OWNED_BY' | 'USED_BY' | 'READ_BY' | 'WRITTEN_BY' | 'DEPENDS_ON'

export interface DatabaseEdge {
  id: string
  sourceObjectId: SemanticId
  targetObjectId: SemanticId
  edgeType: DatabaseEdgeType
  snapshotId?: SnapshotId
  designRevisionId?: RevisionId
  confidence: number
  provenanceIds: string[]
  createdAt: string
}

// ---------------------------------------------------------------------------------------------
// §3 Comparisons
// ---------------------------------------------------------------------------------------------

export type DatabaseComparisonMode =
  | { mode: 'declared_observed_drift'; declaredSnapshotId: SnapshotId; observedSnapshotId: SnapshotId }
  | { mode: 'declared_proposed_delta'; declaredSnapshotId: SnapshotId; proposedRevisionId: RevisionId }
  | { mode: 'design_revisions'; leftRevisionId: RevisionId; rightRevisionId: RevisionId }

export interface DatabaseChange {
  kind: DatabaseChangeKind
  objectId?: SemanticId
  beforeFingerprint?: string
  afterFingerprint?: string
  breaking: boolean
  destructive: boolean
  summary: string
}

export interface DatabaseDiff {
  id: string
  sourceId: string
  mode: DatabaseComparisonMode
  changes: DatabaseChange[]
  fingerprint: string
  createdAt: string
}

// ---------------------------------------------------------------------------------------------
// §6 Design concurrency token
// ---------------------------------------------------------------------------------------------

export interface DesignConcurrencyToken {
  expectedHeadRevisionId: RevisionId
  expectedRevisionNumber: number
}

export interface DatabaseDesignStaleRevisionErrorDetails {
  designId: DesignId
  expectedHeadRevisionId: RevisionId
  actualHeadRevisionId: RevisionId
  expectedRevisionNumber: number
  actualRevisionNumber: number
}

// ---------------------------------------------------------------------------------------------
// §8 Tauri command request/response shapes
// ---------------------------------------------------------------------------------------------

export interface DiscoverDatabaseSourcesRequest { projectId: DbProjectId; force: boolean }
export interface DiscoverDatabaseSourcesResponse { sources: DatabaseSource[]; issues: DatabaseIssue[]; scanId: string }
export interface ListDatabaseSourcesRequest { projectId: DbProjectId }
export interface GetDatabaseSourceRequest { projectId: DbProjectId; sourceId: string }
export interface DatabaseSourceDetail { source: DatabaseSource; evidence: DatabaseSourceEvidence[]; environments: DatabaseEnvironment[] }

/** Mirrors §4's `DatabaseObject` enum exactly, so a schema page can carry mixed-kind rows. */
export type DatabaseGraphObject =
  | { kind: 'environment'; environment: DatabaseEnvironment }
  | { kind: 'namespace'; namespace: DatabaseNamespace }
  | { kind: 'table'; table: DatabaseTable }
  | { kind: 'column'; column: DatabaseColumn }
  | { kind: 'primary_key'; primaryKey: PrimaryKey }
  | { kind: 'foreign_key'; foreignKey: ForeignKey }
  | { kind: 'unique_constraint'; constraint: UniqueConstraint }
  | { kind: 'check_constraint'; constraint: CheckConstraint }
  | { kind: 'index'; index: DatabaseIndex }
  | { kind: 'enum'; enumObject: DatabaseEnum }
  | { kind: 'view'; view: DatabaseView }
  | { kind: 'migration'; migration: DatabaseMigration }
  | { kind: 'orm_model'; ormModel: OrmModel }

export interface DatabaseViewportRequest { x: number; y: number; zoom: number }
export interface GetDatabaseSchemaRequest {
  projectId: DbProjectId
  sourceId: string
  layer: DatabaseLayer
  snapshotId?: SnapshotId
  designRevisionId?: RevisionId
  lod: number
  viewport?: DatabaseViewportRequest
}
export interface DatabaseGraphPage {
  snapshot?: DatabaseSnapshot
  objects: DatabaseGraphObject[]
  edges: DatabaseEdge[]
  issues: DatabaseIssue[]
  continuation?: string
}

export interface GetDatabaseObjectRequest { projectId: DbProjectId; sourceId: string; objectId: SemanticId; snapshotId?: SnapshotId; designRevisionId?: RevisionId }
export interface DatabaseObjectDetail {
  table: DatabaseTable
  columns: DatabaseColumn[]
  primaryKey?: PrimaryKey
  foreignKeys: ForeignKey[]
  uniqueConstraints: UniqueConstraint[]
  checkConstraints: CheckConstraint[]
  indexes: DatabaseIndex[]
  incomingForeignKeys: ForeignKey[]
  usage: DatabaseUsageReference[]
  migrations: DatabaseMigration[]
  issues: DatabaseIssue[]
  sourceExcerpt?: { relativePath: string; text: string }
}

export interface CompareDatabaseRequest { projectId: DbProjectId; mode: DatabaseComparisonMode }
export interface ListDatabaseMigrationsRequest { projectId: DbProjectId; sourceId: string; snapshotId?: SnapshotId }
export interface ListDatabaseUsageRequest { projectId: DbProjectId; sourceId: string; objectId: SemanticId; limit?: number; continuation?: string }
export interface DatabaseUsagePage { refs: DatabaseUsageReference[]; continuation?: string }
export interface ListDatabaseIssuesRequest { projectId: DbProjectId; sourceId: string; status?: DatabaseIssueStatus; severity?: DatabaseIssueSeverity }
export interface IntrospectSqliteFileRequest { projectId: DbProjectId; sourceId: string; projectRelativePath: string; explicitUserConsent: true }

export type CreateDatabaseDraftBase = { kind: 'snapshot'; snapshotId: SnapshotId } | { kind: 'revision'; revisionId: RevisionId }
export interface CreateDatabaseDraftRequest { projectId: DbProjectId; sourceId: string; name: string; base: CreateDatabaseDraftBase }
export interface DatabaseDesignBundle { design: DatabaseDesign; revision: DatabaseDesignRevision; objects: DatabaseTable[]; edges: DatabaseEdge[]; issues: DatabaseIssue[] }
export interface ListDatabaseDesignsRequest { projectId: DbProjectId; sourceId: string }
export interface GetDatabaseDesignRequest { projectId: DbProjectId; designId: DesignId; revisionId?: RevisionId }
export interface ApplyDatabaseDesignOperationRequest { projectId: DbProjectId; designId: DesignId; token: DesignConcurrencyToken; operation: DatabaseDesignOperationKind }
export interface DatabaseDesignMutationResult { design: DatabaseDesign; revision: DatabaseDesignRevision; token: DesignConcurrencyToken }
export interface DecideDatabaseDesignRequest { projectId: DbProjectId; designId: DesignId; token: DesignConcurrencyToken; reason?: string }

export interface DatabaseLayoutPosition { x: number; y: number }
export interface DatabaseLayout {
  id: string
  sourceId: string
  snapshotId?: SnapshotId
  designRevisionId?: RevisionId
  layoutKind: string
  semanticLod: number
  layoutFingerprint: string
  viewport: DatabaseViewportRequest
  positions: Record<SemanticId, DatabaseLayoutPosition>
  updatedAt: string
}
export interface SaveDatabaseLayoutRequest {
  projectId: DbProjectId
  sourceId: string
  snapshotId?: SnapshotId
  designRevisionId?: RevisionId
  layout: Pick<DatabaseLayout, 'layoutKind' | 'semanticLod' | 'viewport' | 'positions'>
  expectedLayoutFingerprint?: string
}

export interface DatabaseContextBudget { maxObjects: number; maxEdges: number; maxUsageRefs: number; maxIssues: number; maxEstimatedTokens: number }
export interface BuildDatabaseContextPackRequest { projectId: DbProjectId; sourceId: string; focus: SemanticId[]; budget?: Partial<DatabaseContextBudget> }
export interface DatabaseContextOmissions { namespaceSummaries: Array<{ namespaceId: SemanticId; omittedCount: number }> }
export interface DatabaseContextObject { object: DatabaseTable | DatabaseColumn; kind: string }
export interface DatabaseGraphReference { layer: DatabaseLayer; snapshotId?: SnapshotId; designRevisionId?: RevisionId }
export interface DatabaseContextPack {
  source: DatabaseSource
  reference: DatabaseGraphReference
  focusObjectIds: SemanticId[]
  objects: DatabaseContextObject[]
  edges: DatabaseEdge[]
  usageRefs: DatabaseUsageReference[]
  issues: DatabaseIssue[]
  omitted: DatabaseContextOmissions
  fingerprint: string
}

export type DatabaseZoomTier = 'overview' | 'relationships' | 'keys' | 'detail'

export interface DatabaseCanvasSelectionWire {
  primaryObjectId?: SemanticId
  objectIds: SemanticId[]
  edgeIds: string[]
  namespaceIds: SemanticId[]
}
export interface DatabaseCanvasViewportWire {
  visibleObjectIds: SemanticId[]
  visibleNamespaceIds: SemanticId[]
  centerObjectId?: SemanticId
  zoomTier: DatabaseZoomTier
}
export interface DatabaseCanvasContext {
  projectId: DbProjectId
  sourceId: string
  layer: DatabaseLayer
  snapshotId?: SnapshotId
  designRevisionId?: RevisionId
  selection: DatabaseCanvasSelectionWire
  viewport: DatabaseCanvasViewportWire
  comparison?: DatabaseComparisonMode
  semanticLod: number
  capturedAt: string
}
export interface PublishDatabaseCanvasStateRequest { projectId: DbProjectId; context: DatabaseCanvasContext }
export interface DatabaseCanvasStateReceipt { fingerprint: string; capturedAt: string }

export type DatabaseExecutionMode = 'design_only' | 'implement_design'
export interface ImplementDatabaseDesignRequest { projectId: DbProjectId; designId: DesignId; approvedRevisionId: RevisionId; executionMode: DatabaseExecutionMode }
export interface DatabaseImplementationRun { runId: string; designId: DesignId; targetRevisionId: RevisionId; phase: string; completed: number; total: number }

// ---------------------------------------------------------------------------------------------
// Events (payload shapes only; subscription lives in `native/events.ts`-style helpers if wired)
// ---------------------------------------------------------------------------------------------

export interface DatabaseSourcesChangedEvent { projectId: DbProjectId; scanId: string; changedSourceIds: string[]; removedSourceIds: string[] }
export interface DatabaseSnapshotUpdatedEvent { projectId: DbProjectId; sourceId: string; layer: DatabaseLayer; snapshotId: SnapshotId; changedObjectIds: SemanticId[]; removedObjectIds: SemanticId[] }
export interface DatabaseDesignUpdatedEvent { projectId: DbProjectId; designId: DesignId; headRevisionId: RevisionId; revisionNumber: number; changedObjectIds: SemanticId[]; actor: DatabaseActor }
export interface DatabaseLayoutUpdatedEvent { projectId: DbProjectId; sourceId: string; snapshotId?: SnapshotId; designRevisionId?: RevisionId; layoutFingerprint: string }
export interface DatabaseIssuesUpdatedEvent { projectId: DbProjectId; sourceId: string; openCountsBySeverity: Record<DatabaseIssueSeverity, number> }
export interface DatabaseImplementationProgressEvent { projectId: DbProjectId; runId: string; targetRevisionId: RevisionId; phase: string; completed: number; total: number; message: string }

// ---------------------------------------------------------------------------------------------
// Typed API error (per CONTRACTS.md §6, e.g. DATABASE_DESIGN_STALE_REVISION)
// ---------------------------------------------------------------------------------------------

export interface DatabaseApiError {
  code: string
  message: string
  recoverable: boolean
  details?: Record<string, unknown>
}

export function isDatabaseStaleRevisionError(error: unknown): error is DatabaseApiError & { details: DatabaseDesignStaleRevisionErrorDetails } {
  return Boolean(error) && typeof error === 'object' && (error as DatabaseApiError).code === 'DATABASE_DESIGN_STALE_REVISION'
}

// =================================================================================================
// FE-only view types. These never round-trip to the backend; they are UI-side derivations.
// =================================================================================================

/** Follows `RepositoryLoadState`'s idle/loading/ready/error discipline exactly (UI-SPEC.md §1 item 6). */
export interface DatabaseLoadState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  errorCode?: string
  errorMessage?: string
}

export type DatabaseSectionId = 'overview' | 'diagram' | 'explorer' | 'migrations' | 'changes' | 'health' | 'connections'

export interface DatabaseSectionDef {
  id: DatabaseSectionId
  label: string
}

export const DATABASE_SECTIONS: DatabaseSectionDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'diagram', label: 'Diagram' },
  { id: 'explorer', label: 'Explorer' },
  { id: 'migrations', label: 'Migrations' },
  { id: 'changes', label: 'Changes' },
  { id: 'health', label: 'Health' },
  { id: 'connections', label: 'Connections' },
]

export type InspectorTabId =
  | 'definition' | 'columns' | 'relations' | 'constraints' | 'indexes' | 'usage' | 'history' | 'source' | 'health'

export const INSPECTOR_TABS: InspectorTabId[] = [
  'definition', 'columns', 'relations', 'constraints', 'indexes', 'usage', 'history', 'source', 'health',
]

/** §6 selection shape — exactly what UI-SPEC.md §6 defines, kept as the FE session-truth shape. */
export interface DatabaseSelection {
  tableIds: SemanticId[]
  columnIds: SemanticId[]
  relationshipIds: SemanticId[]
  focusedId?: SemanticId
}

export function emptyDatabaseSelection(): DatabaseSelection {
  return { tableIds: [], columnIds: [], relationshipIds: [] }
}

export type DatabaseGroupByOption = 'namespace' | 'domain' | 'source'

export interface DatabaseCanvasFilters {
  search?: string
  hideUnrelated: boolean
  nHop?: number
  groupBy?: DatabaseGroupByOption
}

/** UI-SPEC.md §6 `DatabaseCanvasState` — what `selectCanvasState()` produces for the (WP4-owned) bridge. */
export interface DatabaseCanvasState {
  projectId: DbProjectId
  activeDatabaseSourceId?: string
  activeSchemaId?: string
  activeDesignId?: DesignId
  activeRevisionId?: RevisionId
  selection: DatabaseSelection
  viewport: { x: number; y: number; zoom: number; lod: DatabaseSemanticLod }
  visibleTableIds: SemanticId[]
  filters: DatabaseCanvasFilters
}

export type DatabaseSemanticLod = 'far' | 'medium' | 'near'

/** A canvas node's world-space geometry, keyed by semantic id. Positions are data, not library state. */
export interface CanvasNodeRect {
  id: SemanticId
  x: number
  y: number
  w: number
  h: number
  groupId: string
}

export interface CanvasEdgeRef {
  id: string
  from: SemanticId
  to: SemanticId
}

/** What `TableNode`'s parent resolves a visible id to before mounting — proves LOD0 never mounts a full card. */
export type CanvasRenderKind = 'domain-aggregate' | 'table-card'

export interface CanvasRenderDescriptor {
  id: SemanticId
  kind: CanvasRenderKind
  groupId: string
}

export interface DatabaseTableNodeView {
  id: SemanticId
  qualifiedName: string
  name: string
  groupId: string
  groupLabel: string
  columns: Array<{ id: SemanticId; name: string; typeLabel: string; isPrimaryKey: boolean; isForeignKey: boolean; nullable: boolean }>
  issueCount: number
  pinned: boolean
}

export interface DatabaseNamespaceGroupView {
  id: string
  label: string
  tableIds: SemanticId[]
  issueCount: number
}
