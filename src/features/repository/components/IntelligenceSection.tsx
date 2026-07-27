import type { ReactNode } from 'react'
import { AlertTriangle, FlaskConical, GitCommitHorizontal, Loader2, Network, RefreshCw, Workflow } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { ErrorNotice } from '../../../components/ui/ErrorNotice'
import { useRepositoryStore } from '../repositoryStore'
import { relativeTime } from '../repositorySelectors'
import { StatusBadge, type BadgeTone } from './StatusBadge'
import type { RepositoryImpactItem, RepositoryRiskSignal } from '../../../native/types'

const SEVERITY_TONE: Record<RepositoryRiskSignal['severity'], BadgeTone> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
}

/**
 * Repository Intelligence — what the current change set actually touches.
 *
 * The backend extractor derives this from Git alone, and it is explicit about how sure it is:
 * relationships below full confidence are *leads to verify*, not facts, and this surface says so
 * rather than presenting a heuristic as a finding. Every item carries the evidence that produced
 * it, so an operator can check the reasoning instead of trusting a number.
 */
export function IntelligenceSection() {
  const intelligence = useRepositoryStore((state) => state.intelligence)
  const loading = useRepositoryStore((state) => state.intelligenceLoading)
  const error = useRepositoryStore((state) => state.intelligenceError)
  const refresh = useRepositoryStore((state) => state.refreshIntelligence)
  const snapshot = useRepositoryStore((state) => state.snapshot)

  if (error && !intelligence) {
    return (
      <div className="repo-intel">
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      </div>
    )
  }

  // The two empty-ish states are genuinely different: `undefined` means the stored projection has
  // not been read back yet, while `null` means the extractor has never run for this repository.
  // Collapsing them would flash "no graph extracted" during every normal load.
  if (intelligence === undefined) {
    return <div className="repo-center-loading"><Loader2 size={20} className="is-spinning" /><span>Reading repository graph…</span></div>
  }

  if (intelligence === null) {
    return (
      <div className="repo-intel repo-intel-empty">
        <Network size={28} />
        <h2>No graph extracted yet</h2>
        <p>
          Build a graph of this repository to see which tests, dependents and workflows your current
          changes reach. Extraction runs entirely from Git — nothing is sent anywhere.
        </p>
        <Button icon={<RefreshCw size={14} />} onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Extracting…' : 'Build repository graph'}
        </Button>
      </div>
    )
  }

  const { impact, graph } = intelligence
  const stale = snapshot ? snapshot.headSha !== intelligence.headSha : false
  const risks = [...impact.riskSignals, ...impact.missingTestSignals]

  return (
    <div className="repo-intel">
      <header className="repo-intel-head">
        <div>
          <h2>Change impact</h2>
          <p>
            {impact.changedFiles.length} changed file{impact.changedFiles.length === 1 ? '' : 's'} ·
            {' '}{graph.nodes.length} nodes · {graph.edges.length} edges ·
            {' '}extracted {relativeTime(impact.generatedAt)}
          </p>
        </div>
        <div className="repo-intel-head-actions">
          {stale && <StatusBadge tone="warning" title={`Graph built at ${intelligence.headSha.slice(0, 12)}`}>HEAD moved — rebuild</StatusBadge>}
          <Button variant="secondary" icon={<RefreshCw size={14} className={loading ? 'is-spinning' : ''} />} onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Extracting…' : 'Rebuild'}
          </Button>
        </div>
      </header>

      {error && <ErrorNotice message={error} onRetry={() => void refresh()} />}

      {risks.length > 0 && (
        <section className="repo-intel-risks">
          <header><strong>Risk signals</strong><span>{risks.length}</span></header>
          {risks.map((risk) => (
            <article key={risk.code} className="repo-intel-risk">
              <StatusBadge tone={SEVERITY_TONE[risk.severity]} icon={<AlertTriangle size={12} />}>{risk.severity}</StatusBadge>
              <div>
                <strong>{risk.summary}</strong>
                {risk.evidence.length > 0 && <ul className="repo-intel-evidence">{risk.evidence.map((item) => <li key={item} className="mono">{item}</li>)}</ul>}
              </div>
            </article>
          ))}
        </section>
      )}

      <div className="repo-intel-columns">
        <ImpactList
          title="Related tests"
          icon={<FlaskConical size={14} />}
          items={impact.relatedTests}
          empty="No test file matched a changed file by name. That is a lead, not proof of missing coverage."
        />
        <ImpactList
          title="Direct dependents"
          icon={<Network size={14} />}
          items={impact.directDependents}
          empty="No other tracked source file references these changes by name."
        />
        <ImpactList
          title="Changed symbols"
          icon={<GitCommitHorizontal size={14} />}
          items={impact.changedSymbols}
          empty="Git reported no named symbols in the changed hunks."
        />
        <ImpactList
          title="Affected workflows"
          icon={<Workflow size={14} />}
          items={impact.relatedWorkflows}
          empty="No CI workflow definition is part of this change set."
        />
      </div>

      <footer className="repo-intel-foot">
        <span className="mono">{graph.extractorVersion}</span>
        <span>
          Confidence below 100% marks a heuristic match (filename stem or textual reference) — treat
          those rows as leads to verify, not conclusions.
        </span>
      </footer>
    </div>
  )
}

function ImpactList({ title, icon, items, empty }: {
  title: string
  icon: ReactNode
  items: RepositoryImpactItem[]
  empty: string
}) {
  return (
    <section className="repo-intel-list">
      <header>{icon}<strong>{title}</strong><span>{items.length}</span></header>
      {items.length === 0
        ? <p className="repo-intel-none">{empty}</p>
        : (
          <ul>
            {items.map((item) => (
              <li key={`${title}:${item.path}`}>
                <div className="repo-intel-item-head">
                  <span className="mono" title={item.path}>{item.path}</span>
                  <StatusBadge tone={item.confidence >= 1 ? 'success' : item.confidence >= 0.6 ? 'accent' : 'neutral'} title={item.evidence.join(' · ')}>
                    {Math.round(item.confidence * 100)}%
                  </StatusBadge>
                </div>
                <small>{item.reason}</small>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
