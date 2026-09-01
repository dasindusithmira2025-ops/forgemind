/**
 * Decisions: why the project is shaped the way it is.
 *
 * There is no decision registry behind this surface and there must not be one. A decision is an
 * ordinary Memory entry of type `decision`, with the same revisions, evidence and supersession
 * relations as everything else — this file is a reading of that data, not a second store. If a
 * rationale is not recorded, the surface says so rather than composing one.
 */
import { ArrowDown, GitBranch, History } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useMemoryStore } from '../memoryStore'
import { qualityLabel, qualityTone, relativeAge, sourceLabel } from '../memoryPresentation'
import type { MemoryDetail } from '../memoryTypes'

/** A decision's headline state, in the words a reader uses rather than the quality ladder's. */
function decisionState(quality: string, stale: boolean): string {
  if (quality === 'superseded') return 'Superseded'
  if (quality === 'deprecated') return 'No longer applies'
  if (stale) return 'Needs review'
  if (quality === 'canonical' || quality === 'verified') return 'Active'
  return 'Proposed'
}

/** Relations that record one decision replacing another, in both directions. */
function lineageOf(detail: MemoryDetail) {
  const supersedes = detail.relations.filter((relation) => relation.relationType === 'supersedes')
  const supersededBy = detail.relations.filter(
    (relation) => relation.relationType === 'superseded_by',
  )
  return { supersedes, supersededBy }
}

export function MemoryDecisions() {
  const items = useMemoryStore((state) => state.items)
  const detail = useMemoryStore((state) => state.detail)
  const activeId = useMemoryStore((state) => state.activeId)
  const history = useMemoryStore((state) => state.history)
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)

  const decisions = items
    .filter((item) => item.memoryType === 'decision')
    .sort((a, b) => {
      const stateRank = Number(a.quality === 'superseded') - Number(b.quality === 'superseded')
      return stateRank || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    })
  const selected = detail?.memoryType === 'decision' ? detail : undefined
  const lineage = selected ? lineageOf(selected) : { supersedes: [], supersededBy: [] }

  return (
    <section className="memory-decisions" aria-label="Project decisions">
      <div className="memory-decisions-body">
        <nav className="memory-decisions-list" aria-label="Decision list">
          <h3 className="section-label">Decisions</h3>
          {decisions.length === 0 ? (
            <p className="memory-empty-lead">
              No decisions are recorded yet. A decision is a Memory entry of type
              <code> decision</code> — capture one and its rationale, evidence and lineage appear
              here.
            </p>
          ) : (
            <ul>
              {decisions.map((decision) => (
                <li key={decision.id}>
                  <button
                    type="button"
                    className={decision.id === activeId ? 'is-active' : ''}
                    onClick={() => void open(decision.id)}
                  >
                    <span>{decision.title}</span>
                    <em>
                      {decisionState(decision.quality, Boolean(decision.staleReason))} ·{' '}
                      {relativeAge(decision.updatedAt)}
                    </em>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <article className="memory-decision-detail" aria-label="Selected decision">
          {!selected ? (
            <div className="memory-empty-state">
              <GitBranch size={15} aria-hidden />
              <h3>Select a decision</h3>
              <p>Each one records what was chosen, what it rests on, and what it replaced.</p>
            </div>
          ) : (
            <>
              <header>
                <div className="memory-decision-state">
                  <span className={`memory-quality-badge is-${qualityTone(selected.quality)}`}>
                    {decisionState(selected.quality, Boolean(selected.staleReason))}
                  </span>
                  <span className="memory-decision-quality">{qualityLabel(selected.quality)}</span>
                  <span className="memory-decision-quality">
                    revision {selected.revisionNumber}
                  </span>
                  <span className="memory-editor-spacer" />
                  <Button variant="ghost" onClick={() => void setView('all')}>
                    Open in Knowledge
                  </Button>
                </div>
                <h2>{selected.title}</h2>
                {selected.staleReason && (
                  <p className="memory-health-warning">{selected.staleReason}</p>
                )}
              </header>

              <section className="memory-decision-section">
                <h3>Rationale</h3>
                {selected.body.trim() ? (
                  <pre className="memory-decision-body">{selected.body}</pre>
                ) : (
                  <p className="memory-empty-lead">
                    No rationale is recorded for this decision.
                  </p>
                )}
              </section>

              {(lineage.supersedes.length > 0 || lineage.supersededBy.length > 0) && (
                <section className="memory-decision-section">
                  <h3>What this replaced</h3>
                  <ul className="memory-decision-lineage">
                    {lineage.supersededBy.map((relation) => (
                      <li key={relation.id}>
                        <span className="memory-lineage-state">Replaced by</span>
                        <button type="button" onClick={() => void open(relation.toItemId)}>
                          {relation.toTitle}
                        </button>
                      </li>
                    ))}
                    {lineage.supersedes.length > 0 && lineage.supersededBy.length > 0 && (
                      <li className="is-arrow" aria-hidden>
                        <ArrowDown size={12} />
                      </li>
                    )}
                    {lineage.supersedes.map((relation) => (
                      <li key={relation.id} className="is-older">
                        <span className="memory-lineage-state">Supersedes</span>
                        <button type="button" onClick={() => void open(relation.toItemId)}>
                          {relation.toTitle}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="memory-decision-section">
                <h3>Evidence</h3>
                {selected.sources.length === 0 ? (
                  <p className="memory-empty-lead">
                    No provenance is attached — this decision is recorded but not yet backed.
                  </p>
                ) : (
                  <ul className="memory-decision-evidence">
                    {selected.sources.map((source) => (
                      <li key={source.id}>
                        <code>{sourceLabel(source)}</code>
                        {source.excerpt && <span>{source.excerpt}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="memory-decision-section">
                <h3>Affected knowledge</h3>
                {selected.relations.length === 0 ? (
                  <p className="memory-empty-lead">
                    Nothing is linked to this decision yet.
                  </p>
                ) : (
                  <ul className="memory-decision-relations">
                    {selected.relations.map((relation) => (
                      <li key={relation.id}>
                        <span>{relation.relationType.replace(/_/g, ' ')}</span>
                        <button type="button" onClick={() => void open(relation.toItemId)}>
                          {relation.toTitle}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {history.length > 1 && (
                <section className="memory-decision-section">
                  <h3>How the wording changed</h3>
                  <ol className="memory-lineage">
                    {history.slice(0, 6).map((revision, index) => (
                      <li key={revision.id} className={index === 0 ? 'is-current' : ''}>
                        <div>
                          <span className="memory-lineage-state">
                            <History size={11} aria-hidden />
                            {index === 0 ? 'Current' : 'Earlier'}
                          </span>
                          <span className="memory-lineage-title">{revision.title}</span>
                          <span className="memory-lineage-meta">
                            rev {revision.revisionNumber} · {relativeAge(revision.createdAt)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}
        </article>
      </div>
    </section>
  )
}
