import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronRight, X } from 'lucide-react'
import { ErrorNotice } from '../../../components/ui/ErrorNotice'
import { useDatabaseStore } from '../databaseStore'
import { INSPECTOR_TABS, type InspectorTabId } from '../databaseTypes'
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

/**
 * Right rail — one object selected at a time (last-selected wins on multi-select). Tabs are
 * always visible, never hidden when empty (UI-SPEC.md §4), each rendering its own scoped empty
 * state.
 */
export function InspectorPanel() {
  const selection = useDatabaseStore((state) => state.selection)
  const objectDetails = useDatabaseStore((state) => state.objectDetails)
  const objectDetailLoad = useDatabaseStore((state) => state.objectDetailLoad)
  const loadObjectDetail = useDatabaseStore((state) => state.loadObjectDetail)
  const selectObjects = useDatabaseStore((state) => state.selectObjects)
  const [tab, setTab] = useState<InspectorTabId>('definition')

  const focusedId = selection.focusedId
  const multiSelected = selection.tableIds.length > 1

  useEffect(() => {
    if (focusedId) void loadObjectDetail(focusedId)
  }, [focusedId, loadObjectDetail])

  if (selection.tableIds.length === 0) {
    return (
      <aside className="db-inspector" aria-label="Inspector">
        <div className="db-inspector-empty">Select a table to inspect it.</div>
      </aside>
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

  if (!focusedId) return null
  const load = objectDetailLoad[focusedId]
  const detail = objectDetails[focusedId]

  return (
    <aside className="db-inspector" aria-label="Inspector">
      <header className="db-inspector-header">
        <strong title={detail?.table.meta.identity.qualifiedName}>{detail?.table.name ?? 'Loading…'}</strong>
        <button type="button" aria-label="Clear selection" onClick={() => selectObjects([])}><X size={14} /></button>
      </header>
      <nav className="db-inspector-tabs" aria-label="Inspector sections">
        {INSPECTOR_TABS.map((item) => (
          <button key={item} type="button" className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>
            {TAB_LABELS[item]}
          </button>
        ))}
      </nav>
      <div className="db-inspector-body">
        {load?.status === 'loading' && !detail && <div className="db-inspector-skeleton">{Array.from({ length: 5 }).map((_, index) => <span key={index} />)}</div>}
        {load?.status === 'error' && <ErrorNotice message={load.errorMessage ?? 'Failed to load object.'} onRetry={() => void loadObjectDetail(focusedId)} />}
        {detail && (
          <>
            {tab === 'definition' && <DefinitionTab detail={detail} />}
            {tab === 'columns' && <ColumnsTab detail={detail} />}
            {tab === 'relations' && <RelationsTab detail={detail} onJump={(id) => selectObjects([id], { focusedId: id })} />}
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

type Detail = NonNullable<ReturnType<typeof useDatabaseStore.getState>['objectDetails'][string]>

function DefinitionTab({ detail }: { detail: Detail }) {
  const { table } = detail
  if (table.foreignKeyIds.length === 0 && table.columnIds.length === 0 && !table.comment) {
    // A dangling reference (e.g. an FK pointing at a table that failed to resolve) is the only
    // real "no definition" case — shown with a warning tone, never a blank panel.
    return <div className="db-inspector-empty-state warning">No definition recorded</div>
  }
  return (
    <dl className="db-inspector-dl">
      <div><dt>Kind</dt><dd>Table</dd></div>
      <div><dt>Qualified name</dt><dd className="mono">{table.meta.identity.qualifiedName}</dd></div>
      <div><dt>Layer</dt><dd><StatusBadge tone={table.meta.layer === 'declared' ? 'accent' : table.meta.layer === 'observed' ? 'neutral' : 'pending'}>{table.meta.layer}</StatusBadge></dd></div>
      {table.meta.confidence < 1 && <div><dt>Confidence</dt><dd>{Math.round(table.meta.confidence * 100)}%</dd></div>}
      {table.comment && <div><dt>Comment</dt><dd>{table.comment}</dd></div>}
    </dl>
  )
}

function ColumnsTab({ detail }: { detail: Detail }) {
  if (detail.columns.length === 0) return <div className="db-inspector-empty-state">No columns declared</div>
  return (
    <ul className="db-inspector-list">
      {detail.columns.map((column) => (
        <li key={column.meta.identity.id}>
          <span className="mono">{column.name}</span>
          <span className="db-inspector-list-secondary">{column.nativeType}{column.nullable ? '' : ' · not null'}</span>
        </li>
      ))}
    </ul>
  )
}

function RelationsTab({ detail, onJump }: { detail: Detail; onJump: (id: string) => void }) {
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
  return (
    <ul className="db-inspector-list">
      {outgoing.map((fk) => (
        <li key={fk.meta.identity.id}>
          <button type="button" className="db-inspector-jump" onClick={() => onJump(fk.referencedTableId)}>
            → {fk.meta.identity.qualifiedName} <ChevronRight size={12} />
          </button>
        </li>
      ))}
      {incoming.map((fk) => (
        <li key={fk.meta.identity.id}>
          <button type="button" className="db-inspector-jump" onClick={() => onJump(fk.tableId)}>
            ← {fk.meta.identity.qualifiedName} <ChevronRight size={12} />
          </button>
        </li>
      ))}
    </ul>
  )
}

function ConstraintsTab({ detail }: { detail: Detail }) {
  const constraints = [...detail.uniqueConstraints, ...detail.checkConstraints, ...(detail.primaryKey ? [detail.primaryKey] : [])]
  if (constraints.length === 0) return <div className="db-inspector-empty-state">No constraints beyond the primary key</div>
  return <ul className="db-inspector-list">{constraints.map((constraint) => <li key={constraint.meta.identity.id}>{constraint.name ?? constraint.meta.identity.qualifiedName}</li>)}</ul>
}

function IndexesTab({ detail }: { detail: Detail }) {
  if (detail.indexes.length === 0) return <div className="db-inspector-empty-state">No indexes declared</div>
  return (
    <ul className="db-inspector-list">
      {detail.indexes.map((index) => (
        <li key={index.meta.identity.id}>
          <span className="mono">{index.name}</span>
          {index.unique && <StatusBadge tone="neutral">unique</StatusBadge>}
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
  return <ul className="db-inspector-list">{detail.migrations.map((migration) => <li key={migration.meta.identity.id}>{migration.name}</li>)}</ul>
}

function SourceTab({ detail }: { detail: Detail }) {
  if (!detail.sourceExcerpt) return <div className="db-inspector-empty-state">No static source — this object exists only in Observed/Proposed</div>
  return <pre className="db-inspector-source">{detail.sourceExcerpt.text}</pre>
}

function HealthTab({ detail }: { detail: Detail }) {
  if (detail.issues.length === 0) return <div className="db-inspector-empty-state success"><CheckCircle2 size={13} /> No issues detected for this object</div>
  return (
    <ul className="db-inspector-list">
      {detail.issues.map((issue) => (
        <li key={issue.id}>
          <StatusBadge tone={issue.severity === 'critical' || issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'neutral'}>{issue.severity}</StatusBadge>
          <span>{issue.title}</span>
        </li>
      ))}
    </ul>
  )
}
