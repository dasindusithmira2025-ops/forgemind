/**
 * Context surface: what an agent would actually receive, and why.
 *
 * This is deliberately not a preview of a prompt. It shows the pack's *structure* — sections in
 * the order the compiler spends its budget, every entry's reasons and token cost, the candidates
 * that were cut and whether budget or policy cut them, and the contradictions the compiler found
 * but refused to resolve. A context an engineer cannot interrogate is one they cannot fix.
 */
import { useState } from 'react'
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useMemoryStore } from '../memoryStore'
import { CONTEXT_BUDGETS } from '../memoryTypes'
import { qualityHint, qualityTone } from '../memoryPresentation'
import type { ContextEntry, ContextPack } from '../memoryTypes'

function percent(pack: ContextPack): number {
  if (pack.budgetTokens <= 0) return 0
  return Math.min(100, Math.round((pack.usedTokens / pack.budgetTokens) * 100))
}

function EntryRow({ entry }: { entry: ContextEntry }) {
  const [expanded, setExpanded] = useState(false)
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)
  const sourceType = entry.sourceType ?? 'memory'

  return (
    <li className={`memory-context-entry${entry.stale ? ' is-stale' : ''}`}>
      <div className="memory-context-entry-head">
        {sourceType === 'memory' ? (
          <button
            type="button"
            className="memory-context-title"
            onClick={() => {
              void open(entry.itemId)
              void setView('document')
            }}
          >
            {entry.title}
          </button>
        ) : (
          <span className="memory-context-title">{entry.title}</span>
        )}
        <span
          className={`memory-quality-dot is-${qualityTone(entry.quality)}`}
          title={qualityHint(entry.quality)}
        />
        {entry.stale && (
          <span className="memory-context-flag" title="This memory is flagged for verification">
            <AlertTriangle size={11} /> unverified
          </span>
        )}
        <span className="memory-context-tokens">{entry.tokens} tok</span>
        <button
          type="button"
          className="memory-context-why"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          Why?
        </button>
      </div>
      {expanded && (
        <ul className="memory-context-reasons">
          <li>
            <span className="memory-context-source">{sourceType}</span>
            <span>{entry.sourceUris?.[0] ?? entry.sourceId ?? 'Persisted source identity'}</span>
            <span className="memory-context-weight">
              {entry.confidence == null ? '' : `${Math.round(entry.confidence * 100)}%`}
            </span>
          </li>
          {entry.reasons.map((reason, index) => (
            <li key={`${reason.source}-${index}`}>
              <span className={`memory-context-source is-${reason.source}`}>{reason.source}</span>
              <span>{reason.detail}</span>
              <span className="memory-context-weight">+{reason.weight.toFixed(2)}</span>
            </li>
          ))}
          <li className="memory-context-total">
            <span>score</span>
            <span />
            <span className="memory-context-weight">{entry.score.toFixed(2)}</span>
          </li>
        </ul>
      )}
    </li>
  )
}

export function MemoryContext() {
  const task = useMemoryStore((state) => state.contextTask)
  const budget = useMemoryStore((state) => state.contextBudget)
  const pack = useMemoryStore((state) => state.contextPack)
  const loading = useMemoryStore((state) => state.contextLoading)
  const setTask = useMemoryStore((state) => state.setContextTask)
  const setBudget = useMemoryStore((state) => state.setContextBudget)
  const compile = useMemoryStore((state) => state.compileContext)
  const activeTitle = useMemoryStore((state) => state.detail?.title)
  const [showDebug, setShowDebug] = useState(false)

  return (
    <div className="memory-context">
      <form
        className="memory-context-bar"
        onSubmit={(event) => {
          event.preventDefault()
          void compile()
        }}
      >
        <label className="memory-context-task">
          <span className="sr-only">Task</span>
          <input
            value={task}
            placeholder="What is the agent about to do?"
            onChange={(event) => setTask(event.target.value)}
          />
        </label>
        <label className="memory-context-budget">
          <span>Budget</span>
          <select value={budget} onChange={(event) => setBudget(event.target.value)}>
            {CONTEXT_BUDGETS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} · {option.tokens.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary" icon={<Sparkles size={13} />} disabled={loading}>
          Compile
        </Button>
      </form>

      {activeTitle && (
        <p className="memory-context-focus">
          Focused on <strong>{activeTitle}</strong> — it is passed to the compiler as an explicit
          inclusion.
        </p>
      )}

      <div className="memory-context-body">
        {loading && (
          <p className="memory-context-status" role="status">
            <Loader2 size={14} className="spin" /> Compiling…
          </p>
        )}

        {!pack && !loading && (
          <p className="memory-context-empty">
            Describe a task and compile to see exactly which memories an agent would receive, what
            each one costs, and why the compiler chose it.
          </p>
        )}

        {pack && (
          <>
            <div className="memory-context-meter">
              <div className="memory-context-meter-track">
                <div className="memory-context-meter-fill" style={{ width: `${percent(pack)}%` }} />
              </div>
              <span>
                {pack.usedTokens.toLocaleString()} / {pack.budgetTokens.toLocaleString()} tokens ·{' '}
                {pack.candidatesConsidered} candidates considered · {pack.elapsedMs}ms
              </span>
            </div>

            {pack.conflicts.length > 0 && (
              <div className="memory-context-conflicts">
                <h3>
                  <AlertTriangle size={13} /> Contradictions in this context
                </h3>
                <ul>
                  {pack.conflicts.map((conflict) => (
                    <li key={`${conflict.leftItemId}-${conflict.rightItemId}`}>
                      <strong>{conflict.leftTitle}</strong> contradicts{' '}
                      <strong>{conflict.rightTitle}</strong>. Both were included — resolve this in
                      Memory rather than leaving the agent to choose.
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {pack.sections.length === 0 && (
              <p className="memory-context-empty">
                Nothing in this project matched. The agent would start with no prior knowledge.
              </p>
            )}

            {pack.sections.map((section) => (
              <section key={section.kind} className="memory-context-section">
                <h3>
                  {section.label}
                  <span>{section.entries.length}</span>
                </h3>
                <ul>
                  {section.entries.map((entry) => (
                    <EntryRow key={entry.itemId} entry={entry} />
                  ))}
                </ul>
              </section>
            ))}

            <div className="memory-context-debug">
              <button
                type="button"
                aria-expanded={showDebug}
                onClick={() => setShowDebug((value) => !value)}
              >
                {pack.rejected.length} candidate{pack.rejected.length === 1 ? '' : 's'} not included
              </button>
              {showDebug && (
                <ul>
                  {pack.rejected.map((rejection) => (
                    <li key={rejection.itemId}>
                      <span>{rejection.title}</span>
                      <span className={`memory-context-cut is-${rejection.reason}`}>
                        {rejection.reason === 'budget' ? 'cut for budget' : rejection.reason}
                      </span>
                      <span className="memory-context-weight">{rejection.score.toFixed(2)}</span>
                    </li>
                  ))}
                  {pack.rejected.length === 0 && (
                    <li className="memory-context-none">
                      Everything retrieved fitted in the budget.
                    </li>
                  )}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
