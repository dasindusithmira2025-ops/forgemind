import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Network, Search, ShieldCheck } from 'lucide-react'
import { useDatabaseStore } from '../../databaseStore'
import { SectionError } from '../SectionError'
import { StatusBadge, type BadgeTone } from '../StatusBadge'
import type { DatabaseIssue, DatabaseIssueSeverity, SemanticId } from '../../databaseTypes'

const SEVERITY_TONE: Record<DatabaseIssueSeverity, BadgeTone> = {
  critical: 'danger',
  error: 'danger',
  warning: 'warning',
  info: 'neutral',
}

/** Severity order for ranking: the most serious finding is the one a developer should see first. */
const SEVERITY_RANK: Record<DatabaseIssueSeverity, number> = { critical: 0, error: 1, warning: 2, info: 3 }

/**
 * Health: deterministic findings, each anchored to the semantic objects it is about.
 *
 * Every finding carries the object ids the check ran against, which is what makes "Inspect" and
 * "Show on diagram" real navigation rather than a decorative button — they resolve through the same
 * selection the Diagram, Explorer and Inspector all share.
 */
export function HealthSection() {
  const load = useDatabaseStore((state) => state.issuesLoad)
  const issues = useDatabaseStore((state) => state.issues)
  const loadIssues = useDatabaseStore((state) => state.loadIssues)
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)
  const schemaPage = useDatabaseStore((state) => state.schemaPage)
  const schemaLoad = useDatabaseStore((state) => state.schemaLoad)
  const loadSchema = useDatabaseStore((state) => state.loadSchema)
  const selection = useDatabaseStore((state) => state.selection)
  const selectObjects = useDatabaseStore((state) => state.selectObjects)
  const revealObject = useDatabaseStore((state) => state.revealObject)

  const [severityFilter, setSeverityFilter] = useState<DatabaseIssueSeverity | 'all'>('all')

  useEffect(() => {
    if (load.status === 'idle' && activeSourceId) void loadIssues()
  }, [load.status, activeSourceId, loadIssues])

  // Findings name objects by id; resolving them to table names needs the graph loaded.
  useEffect(() => {
    if (schemaLoad.status === 'idle' && activeSourceId) void loadSchema()
  }, [schemaLoad.status, activeSourceId, loadSchema])

  const tableNames = useMemo(() => {
    const names = new Map<SemanticId, string>()
    for (const object of schemaPage?.objects ?? []) {
      if (object.kind === 'table') names.set(object.value.meta.identity.id, object.value.name)
    }
    return names
  }, [schemaPage])

  const open = useMemo(() => issues.filter((issue) => issue.status === 'open'), [issues])
  const counts = useMemo(() => {
    const result: Partial<Record<DatabaseIssueSeverity, number>> = {}
    for (const issue of open) result[issue.severity] = (result[issue.severity] ?? 0) + 1
    return result
  }, [open])

  const visible = useMemo(() => {
    const filtered = severityFilter === 'all' ? open : open.filter((issue) => issue.severity === severityFilter)
    return [...filtered].sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity])
  }, [open, severityFilter])

  if (load.status === 'loading' && issues.length === 0) {
    return <div className="code-explorer-skeleton">{Array.from({ length: 6 }).map((_, index) => <span key={index} />)}</div>
  }

  if (load.status === 'error') {
    return <SectionError load={load} fallback="Failed to load health issues." onRetry={() => void loadIssues()} />
  }

  if (open.length === 0) {
    return (
      <div className="db-health-empty success">
        <CheckCircle2 size={22} />
        <span>No deterministic issues detected in this schema.</span>
        <p className="db-inspector-list-secondary">
          Health runs static checks over the extracted graph — missing primary keys, broken
          references, foreign keys without a supporting index, type mismatches and duplicate indexes.
        </p>
      </div>
    )
  }

  return (
    <div className="db-health">
      <div className="db-health-toolbar" role="group" aria-label="Filter findings by severity">
        <button
          type="button"
          className={severityFilter === 'all' ? 'is-active' : ''}
          onClick={() => setSeverityFilter('all')}
        >
          All <span>{open.length}</span>
        </button>
        {(['critical', 'error', 'warning', 'info'] as DatabaseIssueSeverity[]).map((severity) => (
          counts[severity] ? (
            <button
              key={severity}
              type="button"
              className={severityFilter === severity ? 'is-active' : ''}
              onClick={() => setSeverityFilter(severity)}
            >
              {severity} <span>{counts[severity]}</span>
            </button>
          ) : null
        ))}
      </div>

      <ul className="db-health-list">
        {visible.map((issue) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            tableNames={tableNames}
            selected={issue.semanticObjectIds.some((id) => selection.tableIds.includes(id))}
            onInspect={(id) => selectObjects([id], { focusedId: id })}
            onShowOnDiagram={(id) => revealObject(id, 'diagram')}
          />
        ))}
      </ul>
    </div>
  )
}

function IssueRow({ issue, tableNames, selected, onInspect, onShowOnDiagram }: {
  issue: DatabaseIssue
  tableNames: Map<SemanticId, string>
  selected: boolean
  onInspect: (id: SemanticId) => void
  onShowOnDiagram: (id: SemanticId) => void
}) {
  // The first object id a check reports is the object the finding is about; the rest are context.
  const primaryId = issue.semanticObjectIds[0]
  const affected = issue.semanticObjectIds
    .map((id) => tableNames.get(id))
    .filter((name): name is string => Boolean(name))
  // Only a table id can be shown on the diagram; a finding about a column or index resolves to no
  // node, so the action is not offered rather than offered and silently doing nothing.
  const diagramTargetId = issue.semanticObjectIds.find((id) => tableNames.has(id))

  return (
    <li className={`db-health-issue ${selected ? 'is-active' : ''}`}>
      <div className="db-health-issue-head">
        <StatusBadge tone={SEVERITY_TONE[issue.severity]} icon={<ShieldCheck size={12} />}>{issue.severity}</StatusBadge>
        <strong>{issue.title}</strong>
        <span className="db-health-issue-code mono">{issue.code.replace(/_/g, ' ')}</span>
      </div>
      <p className="db-health-issue-explanation">{issue.explanation}</p>
      {affected.length > 0 && (
        <p className="db-health-issue-objects mono">{affected.join(' · ')}</p>
      )}
      <div className="db-health-issue-actions">
        {primaryId && (
          <button type="button" className="db-empty-link" onClick={() => onInspect(primaryId)}>
            <Search size={12} /> Inspect
          </button>
        )}
        {diagramTargetId && (
          <button type="button" className="db-empty-link" onClick={() => onShowOnDiagram(diagramTargetId)}>
            <Network size={12} /> Show on diagram
          </button>
        )}
      </div>
    </li>
  )
}
