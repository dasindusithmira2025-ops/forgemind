import { useCallback, useEffect, useMemo, useState } from 'react'
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, ExternalLink, FolderOpen, Key, Network, X } from 'lucide-react'
import { ErrorNotice } from '../../../components/ui/ErrorNotice'
import { useDatabaseStore } from '../databaseStore'
import { INSPECTOR_TABS, type DatabaseObjectDetail, type ForeignKey, type InspectorTabId, type SemanticId } from '../databaseTypes'
import { relationCardinality } from '../relationSemantics'
import { StatusBadge } from './StatusBadge'

const TAB_LABELS: Record<InspectorTabId, string> = {
  definition: 'Definition',
  columns: 'Columns',
  relations: 'Relations',
  constraints: 'Constraints',
  indexes: 'Indexes',
  usage: 'Usage',
  history: 'History',
  source: 'Source',
  health: 'Health',
}

const ADAPTER_LABEL: Record<string, string> = {
  prisma: 'Prisma',
  drizzle: 'Drizzle',
  raw_sql: 'Raw SQL',
  sqlite: 'SQLite',
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
}

/**
 * Right rail — the exhaustive view of whatever is currently selected.
 *
 * Selection is the store's one semantic selection, so Diagram, Explorer and Health all drive the
 * same panel with the same object ids. Nothing here is derived from a screen: every field comes
 * from `database_get_object` or the loaded graph.
 */
export function InspectorPanel() {
  const selection = useDatabaseStore((state) => state.selection)
  const objectDetails = useDatabaseStore((state) => state.objectDetails)
  const objectDetailLoad = useDatabaseStore((state) => state.objectDetailLoad)
  const loadObjectDetail = useDatabaseStore((state) => state.loadObjectDetail)
  const selectObjects = useDatabaseStore((state) => state.selectObjects)
  const selectRelationship = useDatabaseStore((state) => state.selectRelationship)
  const revealObject = useDatabaseStore((state) => state.revealObject)
  const [tab, setTab] = useState<InspectorTabId>('definition')

  const focusedId = selection.focusedId
  const isRelationSelection = selection.relationshipIds.length > 0
  const multiSelected = !isRelationSelection && selection.tableIds.length > 1

  useEffect(() => {
    if (focusedId) void loadObjectDetail(focusedId)
  }, [focusedId, loadObjectDetail])

  // A relationship selection loads both endpoints so the panel can name them.
  const relatedId = isRelationSelection ? selection.tableIds.find((id) => id !== focusedId) : undefined
  useEffect(() => {
    if (relatedId) void loadObjectDetail(relatedId)
  }, [relatedId, loadObjectDetail])

  if (selection.tableIds.length === 0) {
    return (
      <aside className="db-inspector" aria-label="Inspector">
        <div className="db-inspector-empty">
          <p>Select a table to inspect it.</p>
          <p className="db-inspector-list-secondary">
            Its columns, relationships, constraints, indexes, source location and health all appear here.
          </p>
        </div>
      </aside>
    )
  }

  if (isRelationSelection && focusedId) {
    return (
      <RelationshipInspector
        edgeId={selection.relationshipIds[0]}
        fromId={focusedId}
        toId={relatedId}
        onClear={() => selectObjects([])}
        onOpenTable={(id) => selectObjects([id], { focusedId: id })}
      />
    )
  }

  if (multiSelected) {
    return (
      <aside className="db-inspector" aria-label="Inspector">
        <header className="db-inspector-header">
          <strong>{selection.tableIds.length} objects selected</strong>
          <button type="button" aria-label="Clear selection" onClick={() => selectObjects([])}><X size={14} /></button>
        </header>
        <p className="db-inspector-multi-note">Bulk actions apply to all selected objects. Select one object to see its full detail.</p>
      </aside>
    )
  }

  if (!focusedId) {
    return (
      <aside className="db-inspector" aria-label="Inspector">
        <div className="db-inspector-empty">Select a table to inspect it.</div>
      </aside>
    )
  }
  const load = objectDetailLoad[focusedId]
  const detail = objectDetails[focusedId]

  return (
    <aside className="db-inspector" aria-label="Inspector">
      <header className="db-inspector-header">
        <div className="db-inspector-title">
          <strong title={detail?.table.meta.identity.qualifiedName}>{detail?.table.name ?? 'Loading…'}</strong>
          {detail && <span className="db-inspector-list-secondary mono">{detail.table.meta.identity.qualifiedName}</span>}
        </div>
        <div className="db-inspector-header-actions">
          <button
            type="button"
            aria-label="Show on diagram"
            title="Show on diagram"
            onClick={() => revealObject(focusedId, 'diagram')}
          >
            <Network size={14} />
          </button>
          <button type="button" aria-label="Clear selection" onClick={() => selectObjects([])}><X size={14} /></button>
        </div>
      </header>
      <div className="db-inspector-tabs" role="tablist" aria-label="Inspector sections">
        {INSPECTOR_TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            id={`db-inspector-tab-${item}`}
            aria-selected={tab === item}
            aria-controls="db-inspector-panel"
            tabIndex={tab === item ? 0 : -1}
            className={tab === item ? 'is-active' : ''}
            onClick={() => setTab(item)}
            onKeyDown={(event) => {
              const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
              if (delta === 0) return
              event.preventDefault()
              const index = INSPECTOR_TABS.indexOf(item)
              const next = INSPECTOR_TABS[(index + delta + INSPECTOR_TABS.length) % INSPECTOR_TABS.length]
              setTab(next)
              document.getElementById(`db-inspector-tab-${next}`)?.focus()
            }}
          >
            {TAB_LABELS[item]}
            <TabCount tab={item} detail={detail} />
          </button>
        ))}
      </div>
      <div className="db-inspector-body" role="tabpanel" id="db-inspector-panel" aria-labelledby={`db-inspector-tab-${tab}`} tabIndex={0}>
        {load?.status === 'loading' && !detail && <div className="db-inspector-skeleton">{Array.from({ length: 5 }).map((_, index) => <span key={index} />)}</div>}
        {load?.status === 'error' && <ErrorNotice message={load.errorMessage ?? 'Failed to load object.'} onRetry={() => void loadObjectDetail(focusedId)} />}
        {detail && (
          <>
            {tab === 'definition' && <DefinitionTab detail={detail} />}
            {tab === 'columns' && <ColumnsTab detail={detail} />}
            {tab === 'relations' && (
              <RelationsTab
                detail={detail}
                onJump={(id) => selectObjects([id], { focusedId: id })}
                onSelectRelation={(key) =>
                  selectRelationship(`fk-edge:${key.meta.identity.id}`, {
                    from: key.tableId,
                    to: key.referencedTableId,
                  })
                }
              />
            )}
            {tab === 'constraints' && <ConstraintsTab detail={detail} />}
            {tab === 'indexes' && <IndexesTab detail={detail} />}
            {tab === 'usage' && <UsageTab detail={detail} />}
            {tab === 'history' && <HistoryTab detail={detail} />}
            {tab === 'source' && <SourceTab detail={detail} />}
            {tab === 'health' && <HealthTab detail={detail} />}
          </>
        )}
      </div>
    </aside>
  )
}

type Detail = DatabaseObjectDetail

/** A count badge on the tabs that have one, so the developer can see where the content is. */
function TabCount({ tab, detail }: { tab: InspectorTabId; detail?: Detail }) {
  if (!detail) return null
  const count =
    tab === 'columns' ? detail.columns.length
      : tab === 'relations' ? detail.foreignKeys.length + detail.incomingForeignKeys.length
        : tab === 'constraints' ? detail.uniqueConstraints.length + detail.checkConstraints.length + (detail.primaryKey ? 1 : 0)
          : tab === 'indexes' ? detail.indexes.length
            : tab === 'usage' ? detail.usage.length
              : tab === 'history' ? detail.migrations.length
                : tab === 'health' ? detail.issues.length
                  : 0
  if (count === 0) return null
  return <span className="db-inspector-tab-count">{count}</span>
}

/** Resolve a table's display name from the loaded graph — the same semantic objects the canvas uses. */
function useTableNames(): Map<SemanticId, string> {
  const schemaPage = useDatabaseStore((state) => state.schemaPage)
  return useMemo(() => {
    const names = new Map<SemanticId, string>()
    for (const object of schemaPage?.objects ?? []) {
      if (object.kind === 'table') names.set(object.value.meta.identity.id, object.value.name)
    }
    return names
  }, [schemaPage])
}

function useColumnNames(): Map<SemanticId, string> {
  const schemaPage = useDatabaseStore((state) => state.schemaPage)
  return useMemo(() => {
    const names = new Map<SemanticId, string>()
    for (const object of schemaPage?.objects ?? []) {
      if (object.kind === 'column') names.set(object.value.meta.identity.id, object.value.name)
    }
    return names
  }, [schemaPage])
}

function DefinitionTab({ detail }: { detail: Detail }) {
  const { table } = detail
  const sources = useDatabaseStore((state) => state.sources)
  const source = sources.find((candidate) => candidate.id === table.meta.sourceId)
  const namespaceName = useNamespaceName(table.namespaceId)
  const adapters = source?.adapterIds.map((id) => ADAPTER_LABEL[id] ?? id).join(' · ')

  if (table.foreignKeyIds.length === 0 && table.columnIds.length === 0 && !table.comment) {
    // A table with no columns, no keys and no comment is a dangling reference — an FK naming a
    // table the extractor never found. That is a defect worth flagging, not an ordinary empty tab.
    return <div className="db-inspector-empty-state warning">No definition recorded</div>
  }

  return (
    <dl className="db-inspector-dl">
      <div><dt>Name</dt><dd className="mono">{table.name}</dd></div>
      <div><dt>Qualified</dt><dd className="mono" title={table.meta.identity.qualifiedName}>{table.meta.identity.qualifiedName}</dd></div>
      {table.mappedName && table.mappedName !== table.name && (
        <div><dt>Maps to</dt><dd className="mono">{table.mappedName}</dd></div>
      )}
      <div><dt>Kind</dt><dd>Table</dd></div>
      <div><dt>Schema</dt><dd className="mono">{namespaceName ?? '—'}</dd></div>
      {source && <div><dt>Database</dt><dd>{source.displayName}</dd></div>}
      {adapters && <div><dt>Adapter</dt><dd>{adapters}</dd></div>}
      {source?.ownerProjectId && source.ownerProjectId !== '.' && (
        <div><dt>Owner</dt><dd className="mono">{source.ownerProjectId}</dd></div>
      )}
      <div>
        <dt>Layer</dt>
        <dd><StatusBadge tone={table.meta.layer === 'declared' ? 'accent' : table.meta.layer === 'observed' ? 'neutral' : 'pending'}>{table.meta.layer}</StatusBadge></dd>
      </div>
      <div><dt>Columns</dt><dd>{detail.columns.length}</dd></div>
      <div><dt>Relations</dt><dd>{detail.foreignKeys.length} out · {detail.incomingForeignKeys.length} in</dd></div>
      {/* Confidence is only worth showing when it is not certainty. */}
      {table.meta.confidence < 1 && <div><dt>Confidence</dt><dd>{Math.round(table.meta.confidence * 100)}%</dd></div>}
      {detail.provenance.length > 0 && (
        <div>
          <dt>Provenance</dt>
          <dd title={detail.provenance.map((item) => `${item.sourceKind} (${item.certainty})`).join('\n')}>
            {detail.provenance[0].sourceKind} · {detail.provenance[0].certainty}
          </dd>
        </div>
      )}
      {table.comment && <div><dt>Comment</dt><dd>{table.comment}</dd></div>}
    </dl>
  )
}

function useNamespaceName(namespaceId: SemanticId): string | undefined {
  const schemaPage = useDatabaseStore((state) => state.schemaPage)
  return useMemo(() => {
    for (const object of schemaPage?.objects ?? []) {
      if (object.kind === 'namespace' && object.value.meta.identity.id === namespaceId) return object.value.name
    }
    return undefined
  }, [schemaPage, namespaceId])
}

function ColumnsTab({ detail }: { detail: Detail }) {
  if (detail.columns.length === 0) return <div className="db-inspector-empty-state">No columns declared</div>
  const pkColumnIds = new Set(detail.primaryKey?.columnIds ?? [])
  const fkColumnIds = new Set(detail.foreignKeys.flatMap((key) => key.columnIds))
  const uniqueColumnIds = new Set(
    detail.uniqueConstraints.filter((constraint) => constraint.columnIds.length === 1).flatMap((constraint) => constraint.columnIds),
  )

  return (
    <ul className="db-inspector-list db-inspector-columns">
      {[...detail.columns].sort((left, right) => left.ordinal - right.ordinal).map((column) => {
        const id = column.meta.identity.id
        return (
          <li key={id}>
            <div className="db-inspector-column-main">
              {pkColumnIds.has(id) && <Key size={11} className="db-col-icon is-pk" aria-label="Primary key" />}
              {!pkColumnIds.has(id) && fkColumnIds.has(id) && <ArrowRight size={11} className="db-col-icon is-fk" aria-label="Foreign key" />}
              <span className="mono">{column.name}</span>
              {uniqueColumnIds.has(id) && !pkColumnIds.has(id) && <span className="db-col-badge is-unique" title="Unique">UQ</span>}
            </div>
            <div className="db-inspector-column-meta">
              <span className="mono">{column.nativeType || column.dataType.family}</span>
              {/* Nullability is stated both ways: silence about it is ambiguous. */}
              <span>{column.nullable ? 'null' : 'not null'}</span>
              {column.default && <span title={`default ${column.default.normalized}`}>= {column.default.normalized}</span>}
              {column.identityGeneration && <span>{column.identityGeneration.replace('_', ' ')}</span>}
              {column.generated && <span title={column.generated.normalized}>generated</span>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Relationships, both directions. Clicking an edge on the canvas is a pointer-only affordance, so
 * the same relationship is selectable from here with the keyboard — the decorative SVG overlay
 * stays `aria-hidden` rather than becoming a set of unlabelled focus stops.
 */
function RelationsTab({ detail, onJump, onSelectRelation }: {
  detail: Detail
  onJump: (id: string) => void
  onSelectRelation: (key: ForeignKey) => void
}) {
  const tableNames = useTableNames()
  const columnNames = useColumnNames()
  const outgoing = detail.foreignKeys
  const incoming = detail.incomingForeignKeys

  if (outgoing.length === 0 && incoming.length === 0) {
    const showCta = detail.table.meta.layer === 'proposed'
    return (
      <div className="db-inspector-empty-state">
        No relationships.{showCta ? ' Add one from Design mode.' : ''}
      </div>
    )
  }

  const columnList = (ids: SemanticId[]) => ids.map((id) => columnNames.get(id) ?? '…').join(', ')

  return (
    <div className="db-inspector-relations">
      {outgoing.length > 0 && (
        <section>
          <h4>References <span className="db-inspector-list-secondary">{outgoing.length}</span></h4>
          <ul className="db-inspector-list">
            {outgoing.map((key) => (
              <li key={key.meta.identity.id}>
                <button type="button" className="db-inspector-relation" onClick={() => onJump(key.referencedTableId)}>
                  <span className="db-inspector-relation-cols mono">{columnList(key.columnIds) || detail.table.name}</span>
                  <span className="db-inspector-relation-card">{relationCardinality(key, detail)}</span>
                  <span className="db-inspector-relation-target mono">
                    {tableNames.get(key.referencedTableId) ?? 'unresolved table'}
                    {key.referencedColumnIds.length > 0 && `.${columnList(key.referencedColumnIds)}`}
                  </span>
                  <ChevronRight size={12} />
                </button>
                <span className="db-inspector-relation-footer">
                  {(key.onDelete !== 'no_action' || key.onUpdate !== 'no_action') && (
                    <span className="db-inspector-list-secondary">
                      on delete {key.onDelete.replace('_', ' ')} · on update {key.onUpdate.replace('_', ' ')}
                    </span>
                  )}
                  <button type="button" className="db-empty-link" onClick={() => onSelectRelation(key)}>
                    Select relationship
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {incoming.length > 0 && (
        <section>
          <h4>Referenced by <span className="db-inspector-list-secondary">{incoming.length}</span></h4>
          <ul className="db-inspector-list">
            {incoming.map((key) => (
              <li key={key.meta.identity.id}>
                <button type="button" className="db-inspector-relation" onClick={() => onJump(key.tableId)}>
                  <ArrowLeft size={11} />
                  <span className="db-inspector-relation-target mono">
                    {tableNames.get(key.tableId) ?? 'unresolved table'}
                    {key.columnIds.length > 0 && `.${columnList(key.columnIds)}`}
                  </span>
                  <ChevronRight size={12} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ConstraintsTab({ detail }: { detail: Detail }) {
  const columnNames = useColumnNames()
  const columnList = (ids: SemanticId[]) => ids.map((id) => columnNames.get(id) ?? '…').join(', ')
  const hasAny = detail.primaryKey || detail.uniqueConstraints.length > 0 || detail.checkConstraints.length > 0 || detail.foreignKeys.length > 0
  if (!hasAny) return <div className="db-inspector-empty-state">No constraints declared</div>

  return (
    <ul className="db-inspector-list">
      {detail.primaryKey && (
        <li>
          <StatusBadge tone="accent">PK</StatusBadge>
          <span className="mono">{columnList(detail.primaryKey.columnIds) || detail.primaryKey.name}</span>
        </li>
      )}
      {detail.uniqueConstraints.map((constraint) => (
        <li key={constraint.meta.identity.id}>
          <StatusBadge tone="neutral">UNIQUE</StatusBadge>
          <span className="mono">{columnList(constraint.columnIds) || constraint.name}</span>
        </li>
      ))}
      {detail.foreignKeys.map((key) => (
        <li key={key.meta.identity.id}>
          <StatusBadge tone="neutral">FK</StatusBadge>
          <span className="mono">{columnList(key.columnIds) || key.name}</span>
        </li>
      ))}
      {detail.checkConstraints.map((constraint) => (
        <li key={constraint.meta.identity.id}>
          <StatusBadge tone="neutral">CHECK</StatusBadge>
          <span className="mono" title={constraint.expression.normalized}>{constraint.expression.normalized}</span>
        </li>
      ))}
    </ul>
  )
}

function IndexesTab({ detail }: { detail: Detail }) {
  const columnNames = useColumnNames()
  if (detail.indexes.length === 0) return <div className="db-inspector-empty-state">No indexes declared</div>
  // Which foreign keys already have a supporting index — the same relationship Health reports on.
  const indexPrefixes = new Set(
    detail.indexes.map((index) => index.keys[0]?.columnId).filter((id): id is SemanticId => Boolean(id)),
  )
  return (
    <ul className="db-inspector-list">
      {detail.indexes.map((index) => (
        <li key={index.meta.identity.id}>
          <div className="db-inspector-column-main">
            <span className="mono">{index.name}</span>
            {index.unique && <StatusBadge tone="neutral">unique</StatusBadge>}
          </div>
          <span className="db-inspector-list-secondary mono">
            {index.keys.map((key) => (key.columnId ? columnNames.get(key.columnId) ?? '…' : key.expression?.normalized ?? '…')).join(', ')}
            {index.keys[0]?.columnId && indexPrefixes.has(index.keys[0].columnId) && detail.foreignKeys.some((key) => key.columnIds[0] === index.keys[0].columnId)
              ? ' · supports a foreign key'
              : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}

function UsageTab({ detail }: { detail: Detail }) {
  if (detail.usage.length === 0) return <div className="db-inspector-empty-state">No usage evidence yet. Usage tracking is best-effort and file-scoped.</div>
  return (
    <ul className="db-inspector-list">
      {detail.usage.map((ref) => (
        <li key={ref.id}>
          <span>{ref.access}</span>
          <span className="db-inspector-list-secondary mono">{ref.relativePath}{ref.span ? `:${ref.span.startLine}` : ''}</span>
        </li>
      ))}
    </ul>
  )
}

function HistoryTab({ detail }: { detail: Detail }) {
  if (detail.migrations.length === 0) return <div className="db-inspector-empty-state">No migration history found for this object</div>
  return (
    <ul className="db-inspector-list">
      {detail.migrations.map((migration) => (
        <li key={migration.meta.identity.id}>
          <span className="mono">{migration.name}</span>
          <span className="db-inspector-list-secondary">{migration.appliedState.replace('_', ' ')}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Where this object is defined in the repository, plus the two navigation actions Paralith can
 * genuinely perform from here. The Database Studio is its own route, outside the workspace shell
 * that hosts the Monaco editor, so there is no in-app editor tab to open — rather than fake one,
 * this uses the same `openPath`/`revealItemInDir` pair `FileExplorer` already uses.
 */
function SourceTab({ detail }: { detail: Detail }) {
  const projectRootPath = useDatabaseStore((state) => state.projectRootPath)
  const [actionError, setActionError] = useState<string | undefined>()
  const excerpt = detail.sourceExcerpt

  const absolutePath = useCallback(
    (relativePath: string) => {
      if (!projectRootPath) return undefined
      const root = projectRootPath.replace(/[\\/]+$/, '')
      const separator = root.includes('\\') ? '\\' : '/'
      return `${root}${separator}${relativePath.split('/').join(separator)}`
    },
    [projectRootPath],
  )

  if (!excerpt) {
    return (
      <div className="db-inspector-empty-state">
        No repository source for this object — it exists only in the Observed or Proposed layer.
      </div>
    )
  }

  const absolute = absolutePath(excerpt.relativePath)

  return (
    <div className="db-inspector-source-tab">
      <dl className="db-inspector-dl">
        <div><dt>File</dt><dd className="mono" title={excerpt.relativePath}>{excerpt.relativePath}</dd></div>
        {detail.provenance[0] && <div><dt>Extractor</dt><dd>{detail.provenance[0].extractorVersion}</dd></div>}
      </dl>
      <div className="db-inspector-source-actions">
        <button
          type="button"
          className="db-empty-link"
          disabled={!absolute}
          title={absolute ? 'Open in your default editor' : 'Project root is not resolved yet'}
          onClick={() => { setActionError(undefined); void openPath(absolute!).catch((error) => setActionError(String(error))) }}
        >
          <ExternalLink size={12} /> Open file
        </button>
        <button
          type="button"
          className="db-empty-link"
          disabled={!absolute}
          onClick={() => { setActionError(undefined); void revealItemInDir(absolute!).catch((error) => setActionError(String(error))) }}
        >
          <FolderOpen size={12} /> Reveal
        </button>
      </div>
      {actionError && <div className="db-inline-error" role="alert">{actionError}</div>}
      <pre className="db-inspector-source">{excerpt.text}</pre>
    </div>
  )
}

function HealthTab({ detail }: { detail: Detail }) {
  if (detail.issues.length === 0) return <div className="db-inspector-empty-state success"><CheckCircle2 size={13} /> No issues detected for this object</div>
  return (
    <ul className="db-inspector-list">
      {detail.issues.map((issue) => (
        <li key={issue.id}>
          <StatusBadge tone={issue.severity === 'critical' || issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'neutral'}>{issue.severity}</StatusBadge>
          <div>
            <span>{issue.title}</span>
            <p className="db-inspector-list-secondary">{issue.explanation}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Selecting the relationship itself: what it joins, on which columns, and what it does on delete. */
function RelationshipInspector({ edgeId, fromId, toId, onClear, onOpenTable }: {
  edgeId: string
  fromId: SemanticId
  toId?: SemanticId
  onClear: () => void
  onOpenTable: (id: SemanticId) => void
}) {
  const objectDetails = useDatabaseStore((state) => state.objectDetails)
  const tableNames = useTableNames()
  const columnNames = useColumnNames()
  const detail = objectDetails[fromId]
  const keys = detail?.foreignKeys.filter((key) => key.referencedTableId === toId) ?? []

  return (
    <aside className="db-inspector" aria-label="Inspector">
      <header className="db-inspector-header">
        <div className="db-inspector-title">
          <strong>Relationship</strong>
          <span className="db-inspector-list-secondary mono">
            {tableNames.get(fromId) ?? '…'} → {toId ? tableNames.get(toId) ?? '…' : '…'}
          </span>
        </div>
        <div className="db-inspector-header-actions">
          <button type="button" aria-label="Clear selection" onClick={onClear}><X size={14} /></button>
        </div>
      </header>
      <div className="db-inspector-body">
        {keys.length === 0 ? (
          <div className="db-inspector-empty-state">
            Loading the relationship’s definition…
          </div>
        ) : (
          <ul className="db-inspector-list">
            {keys.map((key) => (
              <li key={key.meta.identity.id}>
                <div className="db-inspector-column-main">
                  <span className="mono">
                    {key.columnIds.map((id) => columnNames.get(id) ?? '…').join(', ')}
                  </span>
                  <span className="db-inspector-relation-card">{detail ? relationCardinality(key, detail) : ''}</span>
                </div>
                <span className="db-inspector-list-secondary mono">
                  {toId ? tableNames.get(toId) ?? '…' : '…'}
                  {key.referencedColumnIds.length > 0 && `.${key.referencedColumnIds.map((id) => columnNames.get(id) ?? '…').join(', ')}`}
                </span>
                <span className="db-inspector-list-secondary">
                  on delete {key.onDelete.replace('_', ' ')} · on update {key.onUpdate.replace('_', ' ')}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="db-inspector-source-actions">
          <button type="button" className="db-empty-link" onClick={() => onOpenTable(fromId)}>
            Inspect {tableNames.get(fromId) ?? 'source table'}
          </button>
          {toId && (
            <button type="button" className="db-empty-link" onClick={() => onOpenTable(toId)}>
              Inspect {tableNames.get(toId) ?? 'target table'}
            </button>
          )}
        </div>
        <p className="db-inspector-list-secondary mono" title={edgeId}>{edgeId}</p>
      </div>
    </aside>
  )
}
