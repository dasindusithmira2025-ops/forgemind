/**
 * Overview: a project-intelligence briefing over existing Memory data.
 *
 * The surface intentionally synthesizes only from loaded stores: deterministic project facts,
 * persisted memories, timeline rows, review counts, and health counts. It never manufactures
 * product health scores or example knowledge when a project is empty.
 */
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Network,
  RefreshCw,
  ScanSearch,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useMemoryStore } from '../memoryStore'
import { useIntelligenceStore } from '../intelligenceStore'
import {
  TIMELINE_LABELS,
  dimensionLabel,
  type ProjectFact,
  type TimelineEntry,
  type UnderstandingGroup,
} from '../intelligenceTypes'
import { qualityLabel, relativeAge } from '../memoryPresentation'
import type { MemorySummary } from '../memoryTypes'

const CURRENT_QUALITIES = new Set(['working', 'observed', 'supported', 'verified', 'canonical'])
const ARCHITECTURE_TYPES = new Set([
  'component',
  'convention',
  'constraint',
  'requirement',
  'security',
  'performance',
])
const CHANGE_KINDS = new Set<TimelineEntry['kind']>([
  'candidate_accepted',
  'quality_changed',
  'marked_stale',
  'conflict_opened',
  'conflict_resolved',
  'understanding_updated',
])

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

function factText(fact: ProjectFact): string {
  return fact.detail ? `${fact.value} ${fact.detail}` : fact.value
}

function qualityCount(items: MemorySummary[], quality: string): number {
  return items.filter((item) => item.quality === quality).length
}

function currentCount(items: MemorySummary[]): number {
  return items.filter((item) => CURRENT_QUALITIES.has(item.quality) && !item.staleReason).length
}

function importantSystems(items: MemorySummary[]): MemorySummary[] {
  return items
    .filter((item) => ARCHITECTURE_TYPES.has(item.memoryType) && item.quality !== 'superseded')
    .sort((a, b) => b.importance - a.importance || b.confidence - a.confidence)
    .slice(0, 7)
}

function recentCurrent(items: MemorySummary[]): MemorySummary[] {
  return items
    .filter((item) => CURRENT_QUALITIES.has(item.quality))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 5)
}

function changedUnderstanding(timeline: TimelineEntry[]): TimelineEntry[] {
  return timeline.filter((entry) => CHANGE_KINDS.has(entry.kind)).slice(0, 5)
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
  const review = useIntelligenceStore((state) => state.review)
  const timeline = useIntelligenceStore((state) => state.timeline)
  const items = useMemoryStore((state) => state.items)
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)

  const analyzed = (understanding?.revision ?? 0) > 0
  const allFacts = useMemo(
    () => (understanding?.groups ?? []).flatMap((group) => group.facts),
    [understanding],
  )
  const primaryFacts = allFacts.slice(0, 5)
  const recentlyLearned = useMemo(() => recentCurrent(items), [items])
  const changes = useMemo(() => changedUnderstanding(timeline), [timeline])
  const systems = useMemo(() => importantSystems(items), [items])
  const stale = health?.stale ?? items.filter((item) => item.staleReason).length
  const superseded =
    health?.byQuality.find(([quality]) => quality === 'superseded')?.[1] ??
    qualityCount(items, 'superseded')
  const needsReview = review?.total ?? 0

  return (
    <section className="memory-overview" aria-label="Project understanding">
      <div className="memory-overview-command">
        <div>
          <span className="section-label">Project understanding</span>
          <h2>
            {primaryFacts.length > 0
              ? primaryFacts.slice(0, 3).map(factText).join(' · ')
              : 'Paralith is building an understanding of this project.'}
          </h2>
          {analyzed && (
            <p>
              Revision {understanding?.revision} · {understanding?.filesScanned.toLocaleString()}{' '}
              files scanned
              {understanding?.generatedAt ? ` · ${relativeAge(understanding.generatedAt)}` : ''}
            </p>
          )}
        </div>
        <div className="memory-overview-actions">
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
            This Project has not been read yet. Paralith is building an understanding of this
            project. Knowledge will appear here as the analyzer observes files, agents finish work,
            or you capture Memory manually.
          </p>
        )}

        <section className="memory-overview-state" aria-label="Knowledge state">
          <div>
            <span>{currentCount(items).toLocaleString()}</span>
            <strong>Current knowledge</strong>
          </div>
          <div>
            <span>{stale.toLocaleString()}</span>
            <strong>Stale</strong>
          </div>
          <div>
            <span>{superseded.toLocaleString()}</span>
            <strong>Superseded</strong>
          </div>
          <button type="button" onClick={() => void setView('review')}>
            <span>{needsReview.toLocaleString()}</span>
            <strong>Needs review</strong>
          </button>
          <button type="button" onClick={() => void setView('activity')}>
            <span>{timeline.length.toLocaleString()}</span>
            <strong>Recent changes</strong>
          </button>
        </section>

        <div className="memory-overview-briefing">
          <section className="memory-overview-panel" aria-label="Recently learned">
            <h3>Recently learned</h3>
            {recentlyLearned.length === 0 ? (
              <p className="memory-context-empty">No current knowledge has been recorded yet.</p>
            ) : (
              <ul className="memory-overview-list">
                {recentlyLearned.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        void open(item.id)
                        void setView('knowledge')
                      }}
                    >
                      <span>{item.title}</span>
                      <em>
                        {qualityLabel(item.quality)} · {relativeAge(item.updatedAt)}
                      </em>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="memory-overview-panel is-change" aria-label="Changed understanding">
            <h3>Changed understanding</h3>
            {changes.length === 0 ? (
              <p className="memory-context-empty">No recent knowledge transitions are loaded.</p>
            ) : (
              <ul className="memory-overview-list">
                {changes.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      disabled={!entry.itemId}
                      onClick={() => {
                        if (!entry.itemId) return
                        void open(entry.itemId)
                        void setView('knowledge')
                      }}
                    >
                      <span>{entry.itemTitle ?? entry.summary}</span>
                      <em>
                        {TIMELINE_LABELS[entry.kind]} · {relativeAge(entry.at)}
                      </em>
                      {entry.detail && <small>{entry.detail}</small>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {(needsReview > 0 || stale > 0 || (health?.contradictedClaims ?? 0) > 0) && (
          <section className="memory-overview-attention" aria-label="Needs attention">
            <AlertTriangle size={14} aria-hidden />
            <div>
              <h3>Needs attention</h3>
              <p>
                {needsReview > 0 && `${needsReview} review item${needsReview === 1 ? '' : 's'}`}
                {needsReview > 0 && stale > 0 ? ' · ' : ''}
                {stale > 0 && `${stale} stale memor${stale === 1 ? 'y' : 'ies'}`}
                {(health?.contradictedClaims ?? 0) > 0 &&
                  ` · ${health?.contradictedClaims} contradicted claim${
                    health?.contradictedClaims === 1 ? '' : 's'
                  }`}
              </p>
            </div>
            <Button variant="secondary" onClick={() => void setView('review')}>
              Review
            </Button>
          </section>
        )}

        <section className="memory-overview-architecture" aria-label="Architecture snapshot">
          <div>
            <span className="section-label">Architecture snapshot</span>
            <h3>Systems and constraints Memory currently knows</h3>
          </div>
          <Button variant="ghost" icon={<Network size={13} />} onClick={() => void setView('graph')}>
            Open graph
          </Button>
          {systems.length === 0 ? (
            <p className="memory-context-empty">
              No architecture or component memories are available yet.
            </p>
          ) : (
            <ul>
              {systems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void open(item.id)
                      void setView('knowledge')
                    }}
                  >
                    <GitBranch size={12} aria-hidden />
                    <span>{item.title}</span>
                    <em>{item.memoryType}</em>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {understanding?.groups.map((group) => (
          <Group key={group.dimension} group={group} />
        ))}
      </div>
    </section>
  )
}
