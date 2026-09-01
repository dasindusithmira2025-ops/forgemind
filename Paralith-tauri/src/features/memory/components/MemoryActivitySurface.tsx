/**
 * Activity: what happened, in two readings of the same question.
 *
 * "Changes" is how the project's understanding evolved — the reading a developer wants. "Automation"
 * is what the lifecycle actually ran, including the work that changed nothing and the work that
 * failed, which is the reading that makes the first one auditable. They read from different tables
 * and neither is a summary of the other, so they are segments of one surface rather than two
 * top-level modes competing for the same slot in the navigation.
 */
import { useMemoryStore, type ActivityTab } from '../memoryStore'
import { MemoryActivity } from './MemoryActivity'
import { MemoryTimeline } from './MemoryTimeline'

const TABS: { value: ActivityTab; label: string; hint: string }[] = [
  { value: 'changes', label: 'Changes', hint: 'How this project’s knowledge changed' },
  { value: 'automation', label: 'Automation', hint: 'What the knowledge lifecycle ran' },
]

export function MemoryActivitySurface() {
  const tab = useMemoryStore((state) => state.activityTab)
  const setTab = useMemoryStore((state) => state.setActivityTab)

  return (
    <section className="memory-activity-surface" aria-label="Knowledge activity">
      {/* Toggle buttons rather than tabs: an ARIA tablist promises tabpanels, and the two readings
          swap the whole surface rather than switching between two labelled panels. */}
      <div className="memory-segment" role="group" aria-label="Activity reading">
        {TABS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={tab === option.value}
            className={tab === option.value ? 'is-active' : ''}
            title={option.hint}
            onClick={() => void setTab(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {tab === 'changes' ? <MemoryTimeline /> : <MemoryActivity />}
    </section>
  )
}
