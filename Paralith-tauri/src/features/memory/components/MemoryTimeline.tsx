/**
 * Timeline: how what this Project knows has changed.
 *
 * Deliberately not the job feed. Automation answers "what did the lifecycle run"; this answers
 * "how did our understanding evolve". Mixing job retries in here would bury a decision record
 * under transient noise, so the two read from different tables.
 *
 * The default reading is filtered to events that changed what the project believes. Bookkeeping —
 * a document re-saved, a claim's status edited, a candidate declined — is still recorded and one
 * click away, but it is the kind of row that, left in by default, makes a real supersession
 * impossible to find. Nothing is dropped from the data; only from the first screen.
 *
 * Every row is a real recorded event. Nothing is synthesized to fill the feed.
 */
import { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useIntelligenceStore } from '../intelligenceStore'
import { useMemoryStore } from '../memoryStore'
import { supersessionPair } from '../memoryPresentation'
import { TIMELINE_LABELS, type TimelineEntry, type TimelineKind } from '../intelligenceTypes'

/** Filterable kinds, grouped the way a reader thinks about them rather than alphabetically. */
const KIND_FILTERS: { value: TimelineKind; label: string }[] = [
  { value: 'memory_created', label: 'Created' },
  { value: 'memory_revised', label: 'Revised' },
  { value: 'candidate_accepted', label: 'Learned' },
  { value: 'verified', label: 'Verified' },
  { value: 'marked_stale', label: 'Stale' },
  { value: 'quality_changed', label: 'Quality' },
  { value: 'conflict_opened', label: 'Conflicts' },
  { value: 'conflict_resolved', label: 'Resolved' },
  { value: 'handoff_recorded', label: 'Handoffs' },
  { value: 'understanding_updated', label: 'Re-reads' },
]

/**
 * Bookkeeping kinds: real events, but ones that record housekeeping rather than a change in what
 * the project believes. Hidden by default and never dropped.
 */
const BOOKKEEPING = new Set<TimelineKind>([
  'memory_revised',
  'claim_changed',
  'candidate_rejected',
])

const WINDOWS: { days: number; label: string }[] = [
  { days: 0, label: 'All time' },
  { days: 1, label: '24 hours' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
]

function dayOf(entry: TimelineEntry): string {
  const parsed = new Date(entry.at)
  return Number.isNaN(parsed.getTime()) ? entry.at.slice(0, 10) : parsed.toLocaleDateString()
}

function timeOf(entry: TimelineEntry): string {
  const parsed = new Date(entry.at)
  return Number.isNaN(parsed.getTime())
    ? entry.at
    : parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function Row({ entry }: { entry: TimelineEntry }) {
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)
  const pair = supersessionPair(entry.summary)
  const title = entry.itemTitle ?? entry.summary

  return (
    <li className={`memory-timeline-row is-${entry.kind}`}>
      <time className="memory-timeline-time" dateTime={entry.at}>
        {timeOf(entry)}
      </time>
      <span className={`memory-timeline-kind is-${entry.kind}`}>{TIMELINE_LABELS[entry.kind]}</span>
      <div className="memory-timeline-body">
        {entry.itemId ? (
          <button
            type="button"
            className="memory-timeline-title"
            onClick={() => {
              void open(entry.itemId as string)
              void setView('all')
            }}
          >
            {title}
          </button>
        ) : (
          <span className="memory-timeline-title is-plain">{title}</span>
        )}
        {/* A recorded supersession names both sides; showing the replacement is what makes the
            row worth reading. Drawn only when the event actually says so. */}
        {pair && !entry.itemTitle && <span className="memory-timeline-replaced">{pair.to}</span>}
        {entry.detail && <span className="memory-timeline-detail">{entry.detail}</span>}
      </div>
      <span className="memory-timeline-actor">{entry.actor}</span>
    </li>
  )
}

export function MemoryTimeline() {
  const timeline = useIntelligenceStore((state) => state.timeline)
  const loading = useIntelligenceStore((state) => state.timelineLoading)
  const filters = useIntelligenceStore((state) => state.timelineFilters)
  const actors = useIntelligenceStore((state) => state.actors)
  const setFilters = useIntelligenceStore((state) => state.setTimelineFilters)
  const refresh = useIntelligenceStore((state) => state.refreshTimeline)
  const showAll = useIntelligenceStore((state) => state.timelineShowAll)
  const setShowAll = useIntelligenceStore((state) => state.setTimelineShowAll)

  const visible = useMemo(
    () => (showAll ? timeline : timeline.filter((entry) => !BOOKKEEPING.has(entry.kind))),
    [timeline, showAll],
  )
  const hidden = timeline.length - visible.length

  // Day grouping is a rendering concern, so it is derived here rather than shaped by the backend:
  // the same rows serve a filtered read and an item-scoped one.
  const days = useMemo(() => {
    const grouped: { day: string; entries: TimelineEntry[] }[] = []
    for (const entry of visible) {
      const day = dayOf(entry)
      const last = grouped[grouped.length - 1]
      if (last && last.day === day) last.entries.push(entry)
      else grouped.push({ day, entries: [entry] })
    }
    return grouped
  }, [visible])

  const toggleKind = (kind: TimelineKind) =>
    void setFilters({
      kinds: filters.kinds.includes(kind)
        ? filters.kinds.filter((known) => known !== kind)
        : [...filters.kinds, kind],
    })

  return (
    <section className="memory-timeline" aria-label="Knowledge timeline">
      <div className="memory-activity-bar">
        <p>How this Project&rsquo;s understanding changed. What the lifecycle ran is on Automation.</p>
        <Button
          variant="secondary"
          icon={<RefreshCw size={13} />}
          onClick={() => void refresh()}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      <div className="memory-timeline-filters" role="group" aria-label="Timeline filters">
        <label className="memory-inline-select">
          <span>Window</span>
          <select
            value={filters.windowDays}
            onChange={(event) => void setFilters({ windowDays: Number(event.target.value) })}
          >
            {WINDOWS.map((option) => (
              <option key={option.days} value={option.days}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="memory-inline-select">
          <span>Actor</span>
          <select
            value={filters.actor ?? ''}
            onChange={(event) => void setFilters({ actor: event.target.value || undefined })}
          >
            <option value="">Anyone</option>
            {actors.map((actor) => (
              <option key={actor} value={actor}>
                {actor}
              </option>
            ))}
          </select>
        </label>
        <div className="memory-chip-toggles">
          {KIND_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filters.kinds.includes(option.value)}
              className={filters.kinds.includes(option.value) ? 'is-active' : ''}
              onClick={() => toggleKind(option.value)}
            >
              {option.label}
            </button>
          ))}
          <span className="memory-graph-divider" />
          <button
            type="button"
            aria-pressed={showAll}
            className={showAll ? 'is-active' : ''}
            title="Include revisions, claim edits and declined candidates"
            onClick={() => setShowAll(!showAll)}
          >
            Bookkeeping
          </button>
        </div>
      </div>

      <div className="memory-scroll">
        {loading && timeline.length === 0 && (
          <p className="memory-inline-status">Loading timeline…</p>
        )}
        {!loading && visible.length === 0 && (
          <p className="memory-empty-lead">
            Nothing in this window. Knowledge events appear here as memories are written, verified,
            flagged, or learned.
          </p>
        )}
        {days.map((group) => (
          <div key={group.day} className="memory-timeline-day">
            <h3>{group.day}</h3>
            <ul className="memory-timeline-list">
              {group.entries.map((entry) => (
                <Row key={entry.id} entry={entry} />
              ))}
            </ul>
          </div>
        ))}
        {hidden > 0 && (
          <button type="button" className="memory-more" onClick={() => setShowAll(true)}>
            {hidden} bookkeeping event{hidden === 1 ? '' : 's'} hidden · show them
          </button>
        )}
      </div>
    </section>
  )
}
