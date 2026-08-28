import { GitBranch, History, Link2 } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useMemoryStore } from '../memoryStore'
import { qualityLabel, relativeAge, sourceLabel } from '../memoryPresentation'

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
  const selectedDecision = detail?.memoryType === 'decision' ? detail : undefined

  return (
    <section className="memory-decisions" aria-label="Project decisions">
      <header className="memory-activity-bar">
        <p>
          Decisions are normal Memory entries with decision type, evidence, revisions, and
          supersession relations. No separate decision registry is shown here.
        </p>
        {selectedDecision && (
          <Button variant="ghost" onClick={() => void setView('knowledge')}>
            Open in Knowledge
          </Button>
        )}
      </header>

      <div className="memory-decisions-body">
        <nav className="memory-decisions-list" aria-label="Decision list">
          {decisions.length === 0 ? (
            <p className="memory-context-empty">
              No decisions are recorded for this project yet.
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
                      {qualityLabel(decision.quality)} · {relativeAge(decision.updatedAt)}
                    </em>
                    {decision.staleReason && <small>{decision.staleReason}</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <article className="memory-decision-detail" aria-label="Selected decision">
          {!selectedDecision ? (
            <div className="memory-editor is-empty">
              <GitBranch size={22} aria-hidden />
              <p>Select a decision to inspect why the project is this way.</p>
            </div>
          ) : (
            <>
              <header>
                <span className="section-label">Decision</span>
                <h2>{selectedDecision.title}</h2>
                <p>
                  {qualityLabel(selectedDecision.quality)} · revision{' '}
                  {selectedDecision.revisionNumber}
                  {selectedDecision.staleReason ? ` · ${selectedDecision.staleReason}` : ''}
                </p>
              </header>

              <section>
                <h3>Current statement</h3>
                <pre className="memory-decision-body">{selectedDecision.body}</pre>
              </section>

              <section>
                <h3>Evidence</h3>
                {selectedDecision.sources.length === 0 ? (
                  <p className="memory-context-empty">
                    No provenance is attached to this decision.
                  </p>
                ) : (
                  <ul className="memory-decision-evidence">
                    {selectedDecision.sources.map((source) => (
                      <li key={source.id}>
                        <code>{sourceLabel(source)}</code>
                        {source.excerpt && <span>{source.excerpt}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3>Decision lifecycle</h3>
                {history.length === 0 && selectedDecision.relations.length === 0 ? (
                  <p className="memory-context-empty">
                    No earlier revision or supersession relation is recorded.
                  </p>
                ) : (
                  <ul className="memory-decision-lineage">
                    {history.slice(0, 6).map((revision, index) => (
                      <li key={revision.id}>
                        <History size={12} aria-hidden />
                        <span>
                          rev {revision.revisionNumber} · {revision.title}
                        </span>
                        {index === 0 && <em>current</em>}
                      </li>
                    ))}
                    {selectedDecision.relations
                      .filter((relation) => relation.relationType.includes('supersed'))
                      .map((relation) => (
                        <li key={relation.id}>
                          <Link2 size={12} aria-hidden />
                          <span>
                            {relation.relationType.replace(/_/g, ' ')} · {relation.toTitle}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </section>

              <section>
                <h3>Affected knowledge</h3>
                {selectedDecision.relations.length === 0 ? (
                  <p className="memory-context-empty">
                    No typed relationships are attached.
                  </p>
                ) : (
                  <ul className="memory-decision-relations">
                    {selectedDecision.relations.map((relation) => (
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
            </>
          )}
        </article>
      </div>
    </section>
  )
}
