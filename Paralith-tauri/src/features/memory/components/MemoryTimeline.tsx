/**
 * Timeline: how what this Project knows has changed.
 *
 * Deliberately not the job feed. Activity answers "what is the automation doing"; Timeline answers
 * "how did our knowledge evolve". Mixing job retries in here would bury a decision record under
 * transient noise, so the two surfaces stay separate and read from different tables.
 *
 * Every row is a real recorded event. Nothing is synthesized to fill the feed.
 */
import { useMemo } from 'react'
import { History, RefreshCw } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useIntelligenceStore } from '../intelligenceStore'
import { useMemoryStore } from '../memoryStore'
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
              void setView('document')
            }}
          >
            {entry.itemTitle ?? entry.summary}
          </button>
        ) : (
          <span className="memory-timeline-title is-plain">{entry.summary}</span>
        )}
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

  // Day grouping is a rendering concern, so it is derived here rather than shaped by the backend:
  // the same rows serve a filtered read and an item-scoped one.
  const days = useMemo(() => {
    const grouped: { day: string; entries: TimelineEntry[] }[] = []
    for (const entry of timeline) {
      const day = dayOf(entry)
      const last = grouped[grouped.length - 1]
      if (last && last.day === day) last.entries.push(entry)
      else grouped.push({ day, entries: [entry] })
    }
    return grouped
  }, [timeline])

  const toggleKind = (kind: TimelineKind) =>
    void setFilters({
      kinds: filters.kinds.includes(kind)
        ? filters.kinds.filter((known) => known !== kind)
        : [...filters.kinds, kind],
    })

  return (
    <section className="memory-timeline" aria-label="Knowledge timeline">
      <div className="memory-activity-bar">
        <p>How this Project&rsquo;s knowledge changed. Job retries stay on Activity.</p>
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
        <label className="memory-timeline-select">
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
        <label className="memory-timeline-select">
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
        <div className="memory-timeline-kinds">
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
        </div>
      </div>

      <div className="memory-activity-body">
        {loading && timeline.length === 0 && (
          <p className="memory-context-status">Loading timeline…</p>
        )}
        {!loading && timeline.length === 0 && (
          <p className="memory-context-empty">
            <History size={13} /> Nothing in this window. Knowledge events appear here as memories
            are written, verified, flagged, or learned.
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
      </div>
    </section>
  )
}
