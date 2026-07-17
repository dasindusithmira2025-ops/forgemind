import { useState } from 'react'
import { Bot, Check, ChevronDown, ChevronRight, ShieldCheck, User, X } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useRepositoryStore } from '../repositoryStore'
import { relativeTime } from '../repositorySelectors'
import { StatusBadge, type BadgeTone } from './StatusBadge'
import type { RepositoryOperationRecord } from '../../../native/types'

/**
 * The repository operation ledger. It records what ran, under which policy decision, and how it
 * finished — plus any pending approvals an agent (or a policy gate) is waiting on. Details are
 * inspectable without exposing credentials or environment data (the contract carries neither).
 */
export function OperationLedger() {
  const operations = useRepositoryStore((state) => state.operations)
  const approvals = useRepositoryStore((state) => state.approvals)
  const progress = useRepositoryStore((state) => state.progress)
  const decideApproval = useRepositoryStore((state) => state.decideApproval)
  const pending = useRepositoryStore((state) => state.pending)
  const [openId, setOpenId] = useState<string>()

  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending')

  return (
    <div className="repo-ledger">
      {pendingApprovals.length > 0 && (
        <div className="repo-approvals">
          <div className="repo-section-subhead"><span>Approvals required</span><span className="repo-count">{pendingApprovals.length}</span></div>
          {pendingApprovals.map((approval) => (
            <div key={approval.id} className="repo-approval-card">
              <div className="repo-approval-head">
                {approval.actor.kind === 'agent' ? <Bot size={14} /> : <User size={14} />}
                <strong>{approval.operationKind.replaceAll('_', ' ')}</strong>
                <StatusBadge tone={riskTone(approval.risk)}>{approval.risk} risk</StatusBadge>
                <span className="repo-muted">{approval.actor.displayName}{approval.branch ? ` · ${approval.branch}` : ''}</span>
              </div>
              <p className="repo-approval-reason">{approval.reason}</p>
              {approval.expectedEffects && <p className="repo-muted">Effects: {approval.expectedEffects}</p>}
              {approval.recoveryStrategy && <p className="repo-muted">Recovery: {approval.recoveryStrategy}</p>}
              <div className="repo-dialog-actions">
                <Button variant="ghost" icon={<X size={14} />} disabled={Boolean(pending[`approval:${approval.id}`])} onClick={() => void decideApproval(approval.id, false, 'Denied from ledger')}>Deny</Button>
                <Button variant="primary" icon={<Check size={14} />} disabled={Boolean(pending[`approval:${approval.id}`])} onClick={() => void decideApproval(approval.id, true)}>Approve</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="repo-section-subhead"><span>Operation history</span><span className="repo-count">{operations.length}</span></div>
      {operations.length === 0
        ? <p className="repo-empty">No repository operations recorded yet in this session. Staging, commits, pushes and reviews appear here with their policy decision and outcome.</p>
        : (
          <ul className="repo-ledger-list">
            {operations.map((operation) => (
              <LedgerRow
                key={operation.id}
                operation={operation}
                progressMessage={progress[operation.id]?.message}
                open={openId === operation.id}
                onToggle={() => setOpenId((current) => current === operation.id ? undefined : operation.id)}
              />
            ))}
          </ul>
        )}
    </div>
  )
}

function LedgerRow({ operation, progressMessage, open, onToggle }: {
  operation: RepositoryOperationRecord
  progressMessage?: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <li className={`repo-ledger-row ${open ? 'open' : ''}`}>
      <button className="repo-ledger-main" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="repo-ledger-kind">{operation.kind.replaceAll('_', ' ')}</span>
        <StatusBadge tone={statusTone(operation.status)}>{operation.status.replaceAll('_', ' ')}</StatusBadge>
        <StatusBadge tone={policyTone(operation.policy.decision)} icon={<ShieldCheck size={11} />}>{operation.policy.decision.replaceAll('_', ' ')}</StatusBadge>
        <span className="repo-muted">{relativeTime(operation.completedAt ?? operation.startedAt ?? operation.createdAt)}</span>
      </button>
      {open && (
        <dl className="repo-ledger-detail">
          <div><dt>Actor</dt><dd>You (human)</dd></div>
          <div><dt>Policy risk</dt><dd>{operation.policy.risk} — {operation.policy.reason}</dd></div>
          <div><dt>Created</dt><dd>{operation.createdAt}</dd></div>
          {operation.completedAt && <div><dt>Completed</dt><dd>{operation.completedAt}</dd></div>}
          {progressMessage && <div><dt>Progress</dt><dd>{progressMessage}</dd></div>}
          {operation.errorMessage && <div><dt>Failure</dt><dd className="repo-error-text">{operation.errorCode}: {operation.errorMessage}</dd></div>}
        </dl>
      )}
    </li>
  )
}

function statusTone(status: RepositoryOperationRecord['status']): BadgeTone {
  return status === 'succeeded' ? 'success' : status === 'failed' ? 'danger'
    : status === 'awaiting_approval' ? 'warning' : status === 'needs_recovery' ? 'danger'
      : status === 'cancelled' ? 'neutral' : 'pending'
}
function policyTone(decision: string): BadgeTone {
  return decision === 'allowed' ? 'success' : decision === 'blocked' ? 'danger' : 'warning'
}
function riskTone(risk: string): BadgeTone {
  return risk === 'high' || risk === 'critical' ? 'danger' : risk === 'medium' ? 'warning' : 'accent'
}
