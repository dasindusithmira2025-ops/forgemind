/**
 * Review: everything the automation could not decide on its own.
 *
 * Not a generic approvals dashboard. Sections are ordered by the risk of leaving them alone — a
 * canonical contradiction first, a routine candidate last — because that ordering *is* the product
 * decision, and a surface sorted by recency would bury the first under the second.
 *
 * Bulk actions exist for candidates and nowhere else. Accepting eighteen deterministic API
 * discoveries one at a time is the form-heavy workflow this system exists to avoid; resolving
 * eighteen contradictions in one click is eighteen judgements nobody made.
 */
import { AlertTriangle, Check, FileWarning, GitBranch, Layers, RefreshCw, X } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useIntelligenceStore } from '../intelligenceStore'
import { useMemoryStore } from '../memoryStore'
import {
  CONFLICT_CLASS_LABELS,
  CONFLICT_RESOLUTIONS,
  type ConflictResolution,
  type ReviewGroup,
  type ReviewItem,
} from '../intelligenceTypes'

function RiskBadge({ risk }: { risk: ReviewItem['riskClass'] }) {
  return <span className={`memory-review-risk is-${risk}`}>{risk}</span>
}

/** A candidate row: the statement, why it is waiting, and what it rests on. */
function CandidateRow({ item }: { item: ReviewItem }) {
  const selected = useIntelligenceStore((state) => state.selected)
  const deciding = useIntelligenceStore((state) => state.deciding)
  const toggle = useIntelligenceStore((state) => state.toggleSelected)
  const decide = useIntelligenceStore((state) => state.decide)
  const candidate = item.candidate
  if (!candidate) return null
  const busy = deciding.includes(candidate.id)

  return (
    <li className="memory-review-item">
      <div className="memory-review-head">
        <input
          type="checkbox"
          checked={selected.includes(candidate.id)}
          onChange={() => toggle(candidate.id)}
          aria-label={`Select ${candidate.statement}`}
        />
        <span className="memory-review-title">{candidate.statement}</span>
        <RiskBadge risk={candidate.riskClass} />
        <span className="memory-review-spacer" />
        <span className="memory-review-origin">{candidate.origin.replace(/_/g, ' ')}</span>
        <span className="memory-review-confidence">{Math.round(candidate.confidence * 100)}%</span>
      </div>
      {candidate.decisionReason && (
        <p className="memory-review-reason">{candidate.decisionReason}</p>
      )}
      {candidate.evidence.length > 0 ? (
        <ul className="memory-review-evidence">
          {candidate.evidence.slice(0, 4).map((evidence) => (
            <li key={`${evidence.path}-${evidence.kind}`}>
              <code>{evidence.path}</code>
              <span>{evidence.kind}</span>
            </li>
          ))}
          {candidate.evidence.length > 4 && (
            <li className="memory-review-more">
              and {candidate.evidence.length - 4} more
            </li>
          )}
        </ul>
      ) : (
        <p className="memory-review-noevidence">
          <FileWarning size={12} /> No evidence is attached.
        </p>
      )}
      <div className="memory-review-actions">
        <Button
          variant="secondary"
          icon={<Check size={13} />}
          disabled={busy}
          onClick={() => void decide('accept', [candidate.id])}
        >
          Accept
        </Button>
        <Button
          variant="ghost"
          icon={<X size={13} />}
          disabled={busy}
          onClick={() => void decide('reject', [candidate.id])}
        >
          Reject
        </Button>
      </div>
    </li>
  )
}

/** A contradiction: both sides shown side by side, with resolutions that never delete either. */
function ConflictRow({ item }: { item: ReviewItem }) {
  const resolve = useIntelligenceStore((state) => state.resolveConflict)
  const deciding = useIntelligenceStore((state) => state.deciding)
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)
  const conflict = item.conflict
  if (!conflict) return null
  const busy = deciding.includes(conflict.id)

  const side = (label: string, value: string, itemId: string | null) => (
    <div className="memory-review-side">
      <span className="memory-review-side-value">{value}</span>
      {itemId ? (
        <button
          type="button"
          className="memory-review-side-link"
          onClick={() => {
            void open(itemId)
            void setView('knowledge')
          }}
        >
          {label}
        </button>
      ) : (
        <span className="memory-review-side-link is-plain">{label}</span>
      )}
    </div>
  )

  return (
    <li className="memory-review-item is-conflict">
      <div className="memory-review-head">
        <AlertTriangle size={13} className="memory-review-icon" />
        <span className="memory-review-title">
          {conflict.subject} — {conflict.predicate.replace(/_/g, ' ')}
        </span>
        <span className={`memory-review-class is-${conflict.classification}`}>
          {CONFLICT_CLASS_LABELS[conflict.classification]}
        </span>
        <span className="memory-review-spacer" />
        <span className="memory-review-confidence">{Math.round(conflict.confidence * 100)}%</span>
      </div>
      <div className="memory-review-sides">
        {side(conflict.leftLabel, conflict.leftValue, conflict.leftItemId)}
        <span className="memory-review-versus">vs</span>
        {side(conflict.rightLabel, conflict.rightValue, conflict.rightItemId)}
      </div>
      {conflict.detail && <p className="memory-review-reason">{conflict.detail}</p>}
      <div className="memory-review-actions">
        {CONFLICT_RESOLUTIONS.map((option) => (
          <Button
            key={option.value}
            variant="ghost"
            disabled={busy}
            title={option.hint}
            onClick={() => void resolve(conflict.id, option.value as ConflictResolution)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <p className="memory-review-note">Nothing here deletes the losing record.</p>
    </li>
  )
}

/** A memory row — stale canonical knowledge, or knowledge with no provenance. */
function MemoryIssueRow({ item }: { item: ReviewItem }) {
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)
  return (
    <li className="memory-review-item">
      <div className="memory-review-head">
        <span className="memory-review-title">
          {item.itemId ? (
            <button
              type="button"
              className="memory-review-side-link"
              onClick={() => {
                void open(item.itemId as string)
                void setView('knowledge')
              }}
            >
              {item.title}
            </button>
          ) : (
            item.title
          )}
        </span>
        <RiskBadge risk={item.riskClass} />
      </div>
      <p className="memory-review-reason">{item.detail}</p>
    </li>
  )
}

function Group({ group }: { group: ReviewGroup }) {
  const selected = useIntelligenceStore((state) => state.selected)
  const selectGroup = useIntelligenceStore((state) => state.selectGroup)
  const decide = useIntelligenceStore((state) => state.decide)
  const candidateIds = group.items
    .map((item) => item.candidate?.id)
    .filter((id): id is string => Boolean(id))
  const chosen = candidateIds.filter((id) => selected.includes(id))

  return (
    <section className="memory-review-group" aria-label={group.label}>
      <header className="memory-review-group-head">
        <h3>{group.label}</h3>
        <span className="memory-review-count">{group.items.length}</span>
        <span className="memory-review-spacer" />
        {group.bulkActionable && candidateIds.length > 1 && (
          <>
            <Button variant="ghost" onClick={() => selectGroup(candidateIds)}>
              {chosen.length === candidateIds.length ? 'Clear' : 'Select all'}
            </Button>
            {chosen.length > 0 && (
              <>
                <Button
                  variant="secondary"
                  icon={<Check size={13} />}
                  onClick={() => void decide('accept', chosen)}
                >
                  Accept {chosen.length}
                </Button>
                <Button variant="ghost" onClick={() => void decide('reject', chosen)}>
                  Reject {chosen.length}
                </Button>
              </>
            )}
          </>
        )}
      </header>
      <ul className="memory-review-list">
        {group.items.map((item) =>
          item.conflict ? (
            <ConflictRow key={item.id} item={item} />
          ) : item.candidate ? (
            <CandidateRow key={item.id} item={item} />
          ) : (
            <MemoryIssueRow key={`${item.section}-${item.id}`} item={item} />
          ),
        )}
      </ul>
    </section>
  )
}

export function MemoryReview() {
  const review = useIntelligenceStore((state) => state.review)
  const loading = useIntelligenceStore((state) => state.reviewLoading)
  const refresh = useIntelligenceStore((state) => state.refreshReview)

  return (
    <section className="memory-review" aria-label="Knowledge review">
      <div className="memory-activity-bar">
        <p>
          What the automation could not decide alone. High-risk knowledge and contradictions always
          wait for a person; routine structural facts were already recorded.
        </p>
        <Button
          variant="secondary"
          icon={<RefreshCw size={13} />}
          onClick={() => void refresh()}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>
      <div className="memory-activity-body">
        {loading && !review && <p className="memory-context-status">Loading review queue…</p>}
        {review && review.total === 0 && (
          <p className="memory-context-empty">
            <Layers size={13} /> Nothing is waiting. New knowledge appears here when the automation
            finds something it should not decide on its own.
          </p>
        )}
        {review?.sections.map((group) => (
          <Group key={group.section} group={group} />
        ))}
        {review?.truncated && (
          <p className="memory-context-status">
            <GitBranch size={12} /> Showing the highest-risk items only; resolve some to see the
            rest.
          </p>
        )}
      </div>
    </section>
  )
}
