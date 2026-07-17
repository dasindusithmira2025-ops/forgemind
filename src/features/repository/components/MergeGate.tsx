import { useCallback, useEffect, useState } from 'react'
import { AlertOctagon, CheckCircle2, GitMerge, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { asNativeError, native } from '../../../native/commands'
import { useRepositoryStore } from '../repositoryStore'
import type { MergeReadiness } from '../../../native/types'
import type { PullRequestView } from '../repositoryTypes'

type MergeMethod = 'merge' | 'squash' | 'rebase'

/**
 * A compact, authoritative merge-readiness surface. Readiness is NEVER computed here — the
 * component renders the backend `MergeReadiness` decision and its supporting reasons, and the
 * merge button strictly reflects that decision plus the operation's own permission checks.
 */
export function MergeGate({ pr }: { pr: PullRequestView }) {
  const projectId = useRepositoryStore((state) => state.projectId)
  const snapshot = useRepositoryStore((state) => state.snapshot)
  const runOperation = useRepositoryStore((state) => state.runOperation)
  const pending = useRepositoryStore((state) => state.pending)
  const [readiness, setReadiness] = useState<MergeReadiness>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [method, setMethod] = useState<MergeMethod>('squash')

  const evaluate = useCallback(async () => {
    if (!projectId) return
    setLoading(true); setError('')
    try {
      const result = await native.evaluateMergeReadiness({
        projectId,
        repositoryPath: snapshot?.repositoryPath,
        pullRequestNumber: pr.number,
        expectedHeadSha: pr.headSha || undefined,
      })
      setReadiness(result)
    } catch (caught) {
      setError(asNativeError(caught).message)
    } finally {
      setLoading(false)
    }
  }, [projectId, snapshot?.repositoryPath, pr.number, pr.headSha])

  useEffect(() => { void evaluate() }, [evaluate])

  const merge = () => {
    void runOperation({ kind: 'merge_pull_request', number: pr.number, method, expectedHeadSha: readiness?.sourceHeadSha || pr.headSha }, { key: `merge:${pr.number}` })
      .then((record) => { if (record.status === 'succeeded' || record.status === 'awaiting_approval') void evaluate() })
      .catch(() => undefined)
  }

  const merging = Boolean(pending[`merge:${pr.number}`])
  const ready = readiness?.ready ?? false

  return (
    <div className={`repo-merge-gate ${ready ? 'ready' : 'blocked'}`}>
      <div className="repo-merge-gate-head">
        {loading ? <Loader2 size={16} className="is-spinning" /> : ready ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
        <strong>{loading ? 'Evaluating merge readiness…' : ready ? 'Ready to merge' : 'Merge blocked'}</strong>
        <button className="repo-link-btn" onClick={() => void evaluate()} disabled={loading}>Re-check</button>
      </div>

      {error && <p className="repo-inline-warning" role="alert">{error}</p>}

      {readiness && (
        <>
          {readiness.blockingReasons.length > 0 && (
            <ul className="repo-gate-list blocking">
              {readiness.blockingReasons.map((reason, index) => <li key={index}><AlertOctagon size={13} /> {reason}</li>)}
            </ul>
          )}
          {readiness.warnings.length > 0 && (
            <ul className="repo-gate-list warning">
              {readiness.warnings.map((warning, index) => <li key={index}><ShieldAlert size={13} /> {warning}</li>)}
            </ul>
          )}
          {readiness.requiredActions.length > 0 && (
            <ul className="repo-gate-list required">
              {readiness.requiredActions.map((action, index) => <li key={index}>{action}</li>)}
            </ul>
          )}
        </>
      )}

      <div className="repo-merge-controls">
        <label className="repo-inline-label">
          <span>Strategy</span>
          <select value={method} onChange={(event) => setMethod(event.target.value as MergeMethod)} disabled={!ready || merging}>
            <option value="squash">Squash and merge</option>
            <option value="merge">Create a merge commit</option>
            <option value="rebase">Rebase and merge</option>
          </select>
        </label>
        <Button variant="primary" icon={merging ? <Loader2 size={14} className="is-spinning" /> : <GitMerge size={14} />} onClick={merge} disabled={!ready || merging} title={ready ? 'Merge this pull request' : 'Resolve the blockers above to merge'}>
          {merging ? 'Merging' : 'Merge pull request'}
        </Button>
      </div>
    </div>
  )
}
