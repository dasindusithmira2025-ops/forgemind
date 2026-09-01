/**
 * Brain Home: the briefing.
 *
 * In ten seconds it should answer: what is this project, what does Paralith currently understand,
 * what changed recently, what systems exist, and does anything need me. Then it gets out of the way
 * and offers the one thing a developer actually wants, which is to ask a question.
 *
 * Deliberately not an analytics dashboard. Every number is a real count with somewhere to go, and
 * nothing is synthesized. The surface composes only from loaded stores — deterministic project
 * facts, persisted memories, timeline rows, review counts, and the systems Brain derived from
 * accepted knowledge — and when a project is empty it says so rather than showing example
 * knowledge. The analyzer's raw inventory and the health counts are real and useful, but they are
 * reference material rather than the briefing, so they sit behind a disclosure.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  Layers,
  Network,
  RefreshCw,
  ScanSearch,
  Search,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useMemoryStore } from '../memoryStore'
import { useIntelligenceStore } from '../intelligenceStore'
import { useBrainStore } from '../brainStore'
import {
  TIMELINE_LABELS,
  dimensionLabel,
  type ProjectFact,
  type TimelineEntry,
  type UnderstandingGroup,
} from '../intelligenceTypes'
import { knowledgeGroupLabel, qualityLabel, relativeAge, supersessionPair } from '../memoryPresentation'
import { curateGraph, graphBounds, layoutGraph, VIEW_SIZE } from '../memoryGraphLayout'
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

/** How many nodes the architecture snapshot draws. Small enough to read at a glance. */
const SNAPSHOT_NODES = 10

/** How far apart the snapshot pushes the shared layout so labels do not collide in a short strip. */
const SNAPSHOT_SPREAD = 2.6

/** Roughly the aspect of the snapshot box. The viewBox is widened to match it so the drawing
 * fills the height instead of shrinking to a speck in the middle of a wide box. */
const SNAPSHOT_ASPECT = 2.5

/** Rendered height of the snapshot box, in CSS pixels. Must match `.memory-snapshot-svg`. */
const SNAPSHOT_HEIGHT = 300

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
      <h4>
        <span>{dimensionLabel(group.dimension)}</span>
        <span className="memory-count tnum">{group.facts.length}</span>
      </h4>
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
    .slice(0, 8)
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

/**
 * One recorded change to what the project believes.
 *
 * A supersession is drawn as a lineage — the old truth, an arrow, the new one — because that
 * transition is the single most distinctive thing this system records. The arrow is only drawn
 * when the recorded event actually names both sides; anything else renders as written.
 */
function ChangeRow({ entry }: { entry: TimelineEntry }) {
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)
  const pair = supersessionPair(entry.summary)
  const go = () => {
    if (!entry.itemId) return
    void open(entry.itemId)
    void setView('all')
  }

  return (
    <li className="memory-change">
      <button type="button" disabled={!entry.itemId} onClick={go}>
        {pair ? (
          <span className="memory-change-lineage">
            <span className="memory-change-from">{pair.from}</span>
            <ArrowRight size={12} aria-hidden />
            <span className="memory-change-to">{pair.to}</span>
          </span>
        ) : (
          <span className="memory-change-title">{entry.itemTitle ?? entry.summary}</span>
        )}
        <span className="memory-change-meta">
          {TIMELINE_LABELS[entry.kind]} · {relativeAge(entry.at)}
        </span>
        {entry.detail && <span className="memory-change-detail">{entry.detail}</span>}
      </button>
    </li>
  )
}

/** A small, real slice of the knowledge graph — the systems with the most connections. */
function ArchitectureSnapshot() {
  const graph = useMemoryStore((state) => state.graph)
  const setGraphControls = useMemoryStore((state) => state.setGraphControls)
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)

  // The shared layout packs nodes for a canvas that can be panned and zoomed. A fixed 260px strip
  // cannot be, so the snapshot spreads the same positions apart: the arrangement is still the real
  // one, it just stops the labels landing on top of each other.
  const nodes = useMemo(() => {
    if (!graph) return []
    const placed = layoutGraph(curateGraph(graph, SNAPSHOT_NODES))
    const centre = VIEW_SIZE / 2
    return placed.map((node) => ({
      ...node,
      x: centre + (node.x - centre) * SNAPSHOT_SPREAD,
      y: centre + (node.y - centre) * SNAPSHOT_SPREAD,
    }))
  }, [graph])
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node] as const)), [nodes])
  const edges = useMemo(
    () =>
      (graph?.edges ?? []).filter((edge) => byId.has(edge.source) && byId.has(edge.target)),
    [graph, byId],
  )
  // The layout's coordinate space is sized for the full graph; a dozen nodes occupy a fraction of
  // it. Framing the drawn bounds is what stops the snapshot rendering as a speck in a large box.
  const view = useMemo(() => {
    const bounds = graphBounds(nodes)
    if (!bounds) return null
    const pad = 40
    const height = bounds.height + pad * 2
    const width = Math.max(bounds.width + pad * 2, height * SNAPSHOT_ASPECT)
    return {
      box: `${bounds.x + bounds.width / 2 - width / 2} ${bounds.y - pad} ${width} ${height}`,
      // Label size is in user units, which the viewBox scales. Dividing it back out is what keeps
      // the text at a readable 11px however large the drawing's own coordinate space is.
      fontSize: (11 * height) / SNAPSHOT_HEIGHT,
    }
  }, [nodes])

  return (
    <section className="memory-snapshot" aria-label="Architecture snapshot">
      <header>
        <h3>Architecture snapshot</h3>
        <Button
          variant="ghost"
          icon={<Network size={13} />}
          onClick={() => {
            void setGraphControls({ focusItemId: undefined })
            void setView('map')
          }}
        >
          Open intelligence map
        </Button>
      </header>
      {nodes.length === 0 ? (
        <p className="memory-empty-lead">
          No connected knowledge to draw yet. Relationships appear here as memories link to or
          relate to one another.
        </p>
      ) : (
        <svg
          className="memory-snapshot-svg"
          viewBox={view?.box}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Architecture snapshot, ${nodes.length} of the most connected systems`}
        >
          {edges.map((edge) => {
            const from = byId.get(edge.source)
            const to = byId.get(edge.target)
            if (!from || !to) return null
            return (
              <line
                key={edge.id}
                className={`memory-graph-edge is-${edge.kind}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
            )
          })}
          {nodes.map((node) => (
            <g
              key={node.id}
              className={`memory-graph-node is-${node.kind}${node.quality ? ` q-${node.quality}` : ''}`}
              role={node.itemId ? 'button' : undefined}
              tabIndex={node.itemId ? 0 : undefined}
              aria-label={node.label}
              onClick={() => {
                if (!node.itemId) return
                void open(node.itemId)
                void setView('all')
              }}
              onKeyDown={(event) => {
                if (!node.itemId) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  void open(node.itemId)
                  void setView('all')
                }
              }}
            >
              <circle cx={node.x} cy={node.y} r={node.r} />
              <text
                x={node.x}
                y={node.y + node.r + (view?.fontSize ?? 11) * 1.4}
                textAnchor="middle"
                style={{ fontSize: view?.fontSize, strokeWidth: ((view?.fontSize ?? 11) * 3) / 11 }}
              >
                {node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label}
              </text>
              <title>{node.label}</title>
            </g>
          ))}
        </svg>
      )}
    </section>
  )
}

export function BrainHome({ projectName }: { projectName?: string } = {}) {
  const understanding = useIntelligenceStore((state) => state.understanding)
  const loading = useIntelligenceStore((state) => state.understandingLoading)
  const analyzing = useIntelligenceStore((state) => state.analyzing)
  const analyze = useIntelligenceStore((state) => state.analyzeProject)
  const refresh = useIntelligenceStore((state) => state.refreshUnderstanding)
  const health = useIntelligenceStore((state) => state.health)
  const openSearch = useIntelligenceStore((state) => state.openSearch)
  const review = useIntelligenceStore((state) => state.review)
  const timeline = useIntelligenceStore((state) => state.timeline)
  const items = useMemoryStore((state) => state.items)
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)
  const memoryProjectId = useMemoryStore((state) => state.projectId)
  const graph = useMemoryStore((state) => state.graph)
  const refreshGraph = useMemoryStore((state) => state.refreshGraph)
  const openReview = useMemoryStore((state) => state.openReview)
  const brainSystems = useBrainStore((state) => state.systems)
  const question = useBrainStore((state) => state.question)
  const setQuestion = useBrainStore((state) => state.setQuestion)
  const ask = useBrainStore((state) => state.ask)
  const asking = useBrainStore((state) => state.asking)
  const selectSystem = useBrainStore((state) => state.selectSystem)

  // The snapshot draws from the same graph payload the Graph surface uses, fetched once. Guarded
  // on `graph` so re-entering Overview does not refetch what is already loaded, and keyed on the
  // Project id because this effect runs before the parent's load: without the id in the deps the
  // first fetch would be discarded by the load token it raced and never retried.
  useEffect(() => {
    if (!graph && memoryProjectId) void refreshGraph()
  }, [graph, refreshGraph, memoryProjectId])

  const analyzed = (understanding?.revision ?? 0) > 0
  const allFacts = useMemo(
    () => (understanding?.groups ?? []).flatMap((group) => group.facts),
    [understanding],
  )
  const primaryFacts = allFacts.slice(0, 6)
  const recentlyLearned = useMemo(() => recentCurrent(items), [items])
  const changes = useMemo(() => changedUnderstanding(timeline), [timeline])
  const systems = useMemo(() => importantSystems(items), [items])
  const stale = health?.stale ?? items.filter((item) => item.staleReason).length
  const superseded =
    health?.byQuality.find(([quality]) => quality === 'superseded')?.[1] ??
    qualityCount(items, 'superseded')
  const needsReview = review?.total ?? 0
  const contradicted = health?.contradictedClaims ?? 0
  const attention = needsReview > 0 || stale > 0 || contradicted > 0

  return (
    <section className="memory-overview" aria-label="Project understanding">
      <header className="memory-brief">
        <div className="memory-brief-text">
          <span className="section-label">Project understanding</span>
          <h2>{projectName || 'This project'}</h2>
          <p className="memory-brief-facts">
            {primaryFacts.length > 0
              ? primaryFacts.map(factText).join(' · ')
              : 'Paralith has not worked out what this project is built from yet.'}
          </p>
          {analyzed && (
            <p className="memory-brief-meta">
              Revision {understanding?.revision} · {understanding?.filesScanned.toLocaleString()}{' '}
              files scanned
              {understanding?.generatedAt ? ` · ${relativeAge(understanding.generatedAt)}` : ''}
            </p>
          )}
        </div>
        <div className="memory-brief-actions">
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
      </header>

      {/* The one action Home actually wants to offer. Placed above the counts because "ask it
          something" beats "read four numbers" as the next thing a developer does. */}
      <form
        className="brain-home-ask"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          if (!question.trim()) return
          void setView('ask')
          void ask()
        }}
      >
        <Search size={14} aria-hidden />
        <input
          type="search"
          value={question}
          placeholder="Ask anything about this project…"
          aria-label="Ask Brain a question about this project"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={asking || !question.trim()}>
          Ask Brain
          <CornerDownLeft size={13} aria-hidden />
        </Button>
      </form>

      <div className="memory-scroll">
        <div className="memory-state-band" role="group" aria-label="Knowledge state">
          <div>
            <span className="tnum">{currentCount(items).toLocaleString()}</span>
            <strong>Current</strong>
          </div>
          <button type="button" onClick={openReview}>
            <span className="tnum">{needsReview.toLocaleString()}</span>
            <strong>Needs review</strong>
          </button>
          <div>
            <span className="tnum">{stale.toLocaleString()}</span>
            <strong>Stale</strong>
          </div>
          <div>
            <span className="tnum">{superseded.toLocaleString()}</span>
            <strong>Superseded</strong>
          </div>
        </div>

        {!analyzed && !loading && (
          <p className="memory-empty-lead">
            This Project has not been read yet. Knowledge will appear here as the analyzer observes
            files, agents finish work, or you capture Memory manually.
          </p>
        )}

        <div className="memory-brief-columns">
          <div className="memory-brief-main">
            <section className="memory-panel" aria-label="Recently learned">
              <h3>Recently learned</h3>
              {recentlyLearned.length === 0 ? (
                <p className="memory-empty-lead">No current knowledge has been recorded yet.</p>
              ) : (
                <ul className="memory-quiet-list">
                  {recentlyLearned.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          void open(item.id)
                          void setView('all')
                        }}
                      >
                        <span>{item.title}</span>
                        <em>
                          {knowledgeGroupLabel(item.memoryType)} · {qualityLabel(item.quality)} ·{' '}
                          {relativeAge(item.updatedAt)}
                        </em>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="memory-panel" aria-label="Understanding changed">
              <h3>Understanding changed</h3>
              {changes.length === 0 ? (
                <p className="memory-empty-lead">
                  Nothing has been superseded or re-verified in this window.
                </p>
              ) : (
                <ul className="memory-change-list">
                  {changes.map((entry) => (
                    <ChangeRow key={entry.id} entry={entry} />
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="memory-brief-aside">
            <section
              className={`memory-attention${attention ? ' is-open' : ''}`}
              aria-label="Needs attention"
            >
              <h3>Needs attention</h3>
              {attention ? (
                <>
                  <ul className="memory-attention-list">
                    {needsReview > 0 && (
                      <li>
                        <AlertTriangle size={12} aria-hidden />
                        {needsReview} knowledge item{needsReview === 1 ? '' : 's'} waiting for a
                        decision
                      </li>
                    )}
                    {stale > 0 && (
                      <li>
                        <AlertTriangle size={12} aria-hidden />
                        {stale} memor{stale === 1 ? 'y' : 'ies'} a source change put in question
                      </li>
                    )}
                    {contradicted > 0 && (
                      <li>
                        <AlertTriangle size={12} aria-hidden />
                        {contradicted} contradicted claim{contradicted === 1 ? '' : 's'}
                      </li>
                    )}
                  </ul>
                  <Button variant="secondary" onClick={openReview}>
                    Review it
                  </Button>
                </>
              ) : (
                <p className="memory-empty-lead">Project knowledge is current.</p>
              )}
            </section>

            {/* The systems Brain derived from accepted knowledge, not a guess at an architecture.
                Falls back to the architectural memories themselves while entity attribution is
                still empty, so a young project shows what it has rather than nothing. */}
            <section className="memory-panel" aria-label="Important systems">
              <h3>Important systems</h3>
              {brainSystems.length > 0 ? (
                <ul className="memory-systems">
                  {brainSystems.slice(0, 8).map((system) => (
                    <li key={system.id}>
                      <button
                        type="button"
                        onClick={() => {
                          selectSystem(system.id)
                          void setView('systems')
                        }}
                      >
                        <span>
                          <Layers size={11} aria-hidden /> {system.name}
                        </span>
                        <em>
                          {system.knowledgeCount} item{system.knowledgeCount === 1 ? '' : 's'}
                          {system.staleCount > 0 ? ` · ${system.staleCount} stale` : ''}
                        </em>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : systems.length === 0 ? (
                <p className="memory-empty-lead">
                  No architecture or component knowledge is recorded yet.
                </p>
              ) : (
                <ul className="memory-systems">
                  {systems.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          void open(item.id)
                          void setView('all')
                        }}
                      >
                        <span>{item.title}</span>
                        <em>{knowledgeGroupLabel(item.memoryType)}</em>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <ArchitectureSnapshot />
          </aside>
        </div>

        {/* Reference material, not the briefing. Real, navigable, and one disclosure away —
            a developer opening Brain to understand a project should not first have to read a
            health table and an analyzer inventory. */}
        <details className="brain-detail-disclosure">
          <summary>
            Technical detail
            <span className="memory-empty-lead">
              Knowledge health and everything the analyzer detected
            </span>
          </summary>

        {health && health.metrics.length > 0 && (
          <section className="memory-panel" aria-label="Knowledge health section">
            <h3>Knowledge health</h3>
            {/* Each count is a button because each is a query. A number with no click-through
                would be a score, and this product does not have scores. */}
            <div className="memory-health" role="group" aria-label="Knowledge health">
              {health.metrics.map((metric) => (
                <button
                  key={metric.key}
                  type="button"
                  className={`memory-health-metric is-${metric.severity}${
                    metric.count === 0 ? ' is-empty' : ''
                  }`}
                  onClick={() => void openSearch(metric.query)}
                  title={`Search: ${metric.query}`}
                >
                  <span className="memory-health-count tnum">{metric.count}</span>
                  <span className="memory-health-label">{metric.label}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {(understanding?.groups.length ?? 0) > 0 && (
          <section className="memory-detected" aria-label="Detected project facts">
            <h3>
              <span>What the analyzer detected</span>
              <span className="memory-count tnum">{allFacts.length}</span>
            </h3>
            {/* Columns rather than one long stack: these are reference material a reader scans,
                and each fact keeps its own evidence behind a disclosure so the section stays a
                summary until someone asks it a question. */}
            <div className="memory-detected-body">
              {understanding?.groups.map((group) => (
                <Group key={group.dimension} group={group} />
              ))}
            </div>
          </section>
        )}
        </details>
      </div>
    </section>
  )
}
