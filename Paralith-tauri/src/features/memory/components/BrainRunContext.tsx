/**
 * What one agent run actually knew.
 *
 * Context used to be a mode inside the Memory workspace, where it compiled a *hypothetical* pack
 * for a task you typed. That answered "what would an agent get", which is a different and much
 * less useful question than "what did this agent get, and does it explain what it did". So it moved
 * here, beside the run.
 *
 * Everything shown is read back from the immutable per-attempt record the scheduler persisted
 * before execution — the same bytes the adapter handed the provider. Nothing is recompiled: a
 * debugger that recompiles is showing today's answer to yesterday's question.
 *
 * The excluded list is the point of the surface. "It was never retrieved" and "it was retrieved and
 * cut for budget" are different problems with different fixes, and a context inspector that only
 * shows what made it in cannot tell you which one you have.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Ban, Check, Layers } from 'lucide-react'
import { ErrorNotice } from '../../../components/ui/ErrorNotice'
import { asNativeError } from '../../../native/commands'
import { brainApi } from '../api'
import type { CompiledContextPack } from '../brainTypes'
import type { ContextEntry } from '../memoryTypes'

/** Turn the compiler's structured reasons into one readable line. Never invented: each reason is
 * a `{source, detail, weight}` the compiler recorded while selecting the entry. */
function reasonText(entry: ContextEntry): string {
  return entry.reasons.map((reason) => `${reason.source}: ${reason.detail}`).join(' · ')
}

/** Why a candidate did not make the pack, in the user's words rather than the enum's. */
const REJECTION_LABELS: Record<string, string> = {
  budget: 'Cut for budget',
  superseded: 'Superseded',
  deprecated: 'Deprecated',
  stale: 'Stale',
}

export function BrainRunContext({
  projectId,
  agentRunId,
  agentName,
  taskTitle,
}: {
  projectId: string
  agentRunId: string
  agentName?: string
  taskTitle?: string
}) {
  const [record, setRecord] = useState<CompiledContextPack | null>()
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setRecord(undefined)
    setError('')
    void brainApi
      .runContext(projectId, agentRunId)
      .then((value) => {
        if (live) setRecord(value)
      })
      .catch((caught) => {
        if (live) setError(asNativeError(caught).message)
      })
    return () => {
      live = false
    }
  }, [projectId, agentRunId])

  if (error) return <ErrorNotice message={error} />
  if (record === undefined) return <p className="memory-inline-status">Reading delivered context…</p>
  if (record === null) {
    return (
      <div className="memory-empty-state">
        <Layers size={20} aria-hidden />
        <h3>No context was delivered to this run</h3>
        <p>
          A context pack is recorded when an attempt reaches execution. This run either has not
          started or ended before one was compiled.
        </p>
      </div>
    )
  }

  const { pack } = record
  const used = pack.budgetTokens > 0 ? Math.min(1, pack.usedTokens / pack.budgetTokens) : 0
  const included = pack.sections.reduce((total, section) => total + section.entries.length, 0)

  return (
    <section className="brain-run-context" aria-label="What this agent knew">
      <header>
        <span className="section-label">What this agent knew</span>
        <p className="memory-empty-lead">
          {agentName ? `${agentName} · ` : ''}
          {taskTitle ?? pack.task}
        </p>
      </header>

      {/* Real numbers from the recorded pack. A budget bar that showed a target rather than the
          tokens actually spent would be the exact fiction this product refuses. */}
      <div className="brain-run-budget">
        <div>
          <strong className="tnum">{pack.usedTokens.toLocaleString()}</strong>
          <span>tokens delivered of {pack.budgetTokens.toLocaleString()} budget</span>
        </div>
        <div className="brain-run-meter" role="img" aria-label={`${Math.round(used * 100)}% of budget used`}>
          <i style={{ width: `${used * 100}%` }} />
        </div>
        <div>
          <strong className="tnum">{included}</strong>
          <span>
            included of {pack.candidatesConsidered.toLocaleString()} considered
          </span>
        </div>
        <div>
          <strong>{pack.cached ? 'Cached' : 'Compiled'}</strong>
          <span>
            compiler v{record.compilerVersion} · {pack.semanticUsed ? 'semantic on' : 'deterministic'}
          </span>
        </div>
      </div>

      {pack.conflicts.length > 0 && (
        <section className="brain-run-section" aria-label="Conflicts in the delivered context">
          <h4>
            <AlertTriangle size={13} aria-hidden /> Contradictions delivered
            <span className="memory-count tnum">{pack.conflicts.length}</span>
          </h4>
          {/* Surfaced rather than resolved: the compiler does not pick a winner, and hiding that
              from the person debugging an agent's behaviour would hide the likeliest cause. */}
          <ul className="brain-run-entries">
            {pack.conflicts.map((conflict) => (
              <li key={`${conflict.leftItemId}-${conflict.rightItemId}`}>
                <span className="brain-run-entry-head">
                  <strong>{conflict.leftTitle}</strong>
                  <span>contradicts</span>
                  <strong>{conflict.rightTitle}</strong>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pack.sections.map((section) => (
        <section className="brain-run-section" key={section.kind} aria-label={section.label}>
          <h4>
            <Check size={13} aria-hidden /> {section.label}
            <span className="memory-count tnum">{section.entries.length}</span>
          </h4>
          <ul className="brain-run-entries">
            {section.entries.map((entry) => (
              <li key={entry.itemId}>
                <span className="brain-run-entry-head">
                  <strong>{entry.title}</strong>
                  <span>{entry.memoryType}</span>
                  <span>{entry.quality}</span>
                  <span className="tnum">{entry.tokens} tok</span>
                  {entry.stale && <span>stale</span>}
                  {entry.truncated && <span>truncated</span>}
                </span>
                {entry.reasons.length > 0 && (
                  <span className="brain-run-reasons">Included because — {reasonText(entry)}</span>
                )}
                <span className="brain-run-entry-text">{entry.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="brain-run-section" aria-label="Excluded knowledge">
        <h4>
          <Ban size={13} aria-hidden /> Excluded
          <span className="memory-count tnum">{pack.rejected.length}</span>
        </h4>
        {pack.rejected.length === 0 ? (
          <p className="memory-empty-lead">
            Nothing was cut. Every candidate the compiler retrieved fitted the budget.
          </p>
        ) : (
          <ul className="brain-run-entries brain-run-excluded">
            {pack.rejected.map((rejection) => (
              <li key={rejection.itemId}>
                <span className="brain-run-entry-head">
                  <strong>{rejection.title}</strong>
                  <span>{REJECTION_LABELS[rejection.reason] ?? rejection.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pack.handoffs.length > 0 && (
        <section className="brain-run-section" aria-label="Prior agent results delivered">
          <h4>
            Prior agent results
            <span className="memory-count tnum">{pack.handoffs.length}</span>
          </h4>
          <ul className="brain-run-entries">
            {pack.handoffs.map((handoff) => (
              <li key={handoff.id}>
                <span className="brain-run-entry-head">
                  <strong>{handoff.task}</strong>
                  <span>{handoff.agent}</span>
                  <span>{handoff.outcome}</span>
                  <span className="tnum">{handoff.tokens} tok</span>
                </span>
                <span className="brain-run-entry-text">{handoff.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
