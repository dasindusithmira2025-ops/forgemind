/**
 * Overview: what Paralith has worked out about this Project, and how healthy its knowledge is.
 *
 * Every fact carries the files that prove it. Nothing here is inferred by a model — the analyzer
 * reads manifests, configuration, and directory shape, and an unsupported architectural claim
 * cannot be represented.
 *
 * Every health number is a query, not a score. Clicking one runs it in Search.
 */
import { useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, ScanSearch } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useIntelligenceStore } from '../intelligenceStore'
import { dimensionLabel, type ProjectFact, type UnderstandingGroup } from '../intelligenceTypes'

function FactRow({ fact }: { fact: ProjectFact }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="memory-overview-fact">
      <button
        type="button"
        className="memory-overview-fact-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        <span className="memory-overview-value">{fact.value}</span>
        {fact.detail && <span className="memory-overview-detail">{fact.detail}</span>}
        <span className="memory-overview-spacer" />
        <span className="memory-overview-confidence">{Math.round(fact.confidence * 100)}%</span>
        <span className="memory-overview-evidence-count">
          {fact.evidence.length} source{fact.evidence.length === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <ul className="memory-overview-evidence">
          {fact.evidence.map((evidence) => (
            <li key={`${evidence.path}-${evidence.kind}`}>
              <code>{evidence.path}</code>
              <span>{evidence.kind}</span>
              {evidence.excerpt && <em>{evidence.excerpt}</em>}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function Group({ group }: { group: UnderstandingGroup }) {
  return (
    <section className="memory-overview-group" aria-label={dimensionLabel(group.dimension)}>
      <h3>
        {dimensionLabel(group.dimension)}
        <span>{group.facts.length}</span>
      </h3>
      <ul className="memory-overview-facts">
        {group.facts.map((fact) => (
          <FactRow key={`${fact.dimension}-${fact.value}`} fact={fact} />
        ))}
      </ul>
    </section>
  )
}

export function MemoryOverview() {
  const understanding = useIntelligenceStore((state) => state.understanding)
  const loading = useIntelligenceStore((state) => state.understandingLoading)
  const analyzing = useIntelligenceStore((state) => state.analyzing)
  const analyze = useIntelligenceStore((state) => state.analyzeProject)
  const refresh = useIntelligenceStore((state) => state.refreshUnderstanding)
  const health = useIntelligenceStore((state) => state.health)
  const setQuery = useIntelligenceStore((state) => state.setQuery)
  const runSearch = useIntelligenceStore((state) => state.runSearch)

  const analyzed = (understanding?.revision ?? 0) > 0

  return (
    <section className="memory-overview" aria-label="Project understanding">
      <div className="memory-activity-bar">
        <p>
          What this repository is, read off the repository. Every fact lists the files behind it.
        </p>
        <Button
          variant="ghost"
          icon={<RefreshCw size={13} />}
          onClick={() => void refresh()}
          disabled={loading}
        >
          Refresh
        </Button>
        <Button
          variant="secondary"
          icon={<ScanSearch size={13} />}
          onClick={() => void analyze()}
          disabled={analyzing}
        >
          Re-read project
        </Button>
      </div>

      <div className="memory-activity-body">
        {health && health.metrics.length > 0 && (
          <div className="memory-overview-health" role="group" aria-label="Knowledge health">
            {health.metrics.map((metric) => (
              <button
                key={metric.key}
                type="button"
                className={`memory-overview-metric is-${metric.severity}${
                  metric.count === 0 ? ' is-empty' : ''
                }`}
                onClick={() => {
                  setQuery(metric.query)
                  void runSearch(metric.query)
                }}
                title={`Search: ${metric.query}`}
              >
                <span className="memory-overview-metric-count">{metric.count}</span>
                <span className="memory-overview-metric-label">{metric.label}</span>
              </button>
            ))}
          </div>
        )}

        {!analyzed && !loading && (
          <p className="memory-context-empty">
            This Project has not been read yet. Analysis runs automatically when a Project is opened
            or a manifest changes — or start one now with <strong>Re-read project</strong>.
          </p>
        )}

        {analyzed && (
          <p className="memory-overview-meta">
            Revision {understanding?.revision} · {understanding?.filesScanned.toLocaleString()} files
            scanned
            {understanding?.generatedAt
              ? ` · ${new Date(understanding.generatedAt).toLocaleString()}`
              : ''}
          </p>
        )}

        {understanding?.groups.map((group) => (
          <Group key={group.dimension} group={group} />
        ))}
      </div>
    </section>
  )
}
