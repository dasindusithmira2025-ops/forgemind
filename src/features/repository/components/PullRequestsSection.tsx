import { useEffect, useMemo, useState } from 'react'
import {
  Bot, Check, CheckCircle2, CircleDashed, GitPullRequest, MessageSquare, User, X,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useRepositoryStore } from '../repositoryStore'
import { relativeTime } from '../repositorySelectors'
import { applyPrFilter, PR_FILTER_LABELS, type PrFilterId } from '../repositoryNav'
import { StatusBadge, type BadgeTone } from './StatusBadge'
import { MergeGate } from './MergeGate'
import { ConnectedPlaceholder } from './ConnectedPlaceholder'
import type { PullRequestView } from '../repositoryTypes'
import type { AgentActionRequest } from './AgentActionDialog'

const PR_FILTER_TABS: PrFilterId[] = ['active', 'mine', 'drafts', 'awaiting-review', 'agents', 'all']

export function PullRequestsSection({ filter = 'active', selected, onFilterChange, onSelect, onRequestAgentWorktree }: {
  filter?: PrFilterId
  selected?: number
  onFilterChange?: (filter: PrFilterId) => void
  onSelect?: (number: number) => void
  onRequestAgentWorktree: (request: AgentActionRequest) => void
}) {
  const pullRequests = useRepositoryStore((state) => state.remoteViews.pullRequests)
  const remoteLoading = useRepositoryStore((state) => state.remoteLoading)
  const remoteError = useRepositoryStore((state) => state.remoteError)
  const providerStatus = useRepositoryStore((state) => state.providerStatus)
  const refreshRemote = useRepositoryStore((state) => state.refreshRemote)

  const visible = useMemo(() => applyPrFilter(pullRequests, filter, providerStatus?.accountLogin), [pullRequests, filter, providerStatus?.accountLogin])
  const current = visible.find((pr) => pr.number === selected) ?? visible[0]

  if (!providerStatus?.authenticated && pullRequests.length === 0) {
    return <ConnectedPlaceholder title="Pull requests" message={remoteError ?? 'Connect a GitHub account to review pull requests here without leaving Paralith.'} onRetry={() => void refreshRemote()} loading={remoteLoading} authHint={!providerStatus?.authenticated} />
  }
  if (pullRequests.length === 0) {
    return <ConnectedPlaceholder title="No pull requests" message={remoteError ?? 'No open pull requests for this repository yet. Push a branch and open one from the Changes surface.'} onRetry={() => void refreshRemote()} loading={remoteLoading} />
  }

  return (
    <div className="repo-pr">
      <div className="repo-pr-list" aria-label="Pull requests">
        <div className="repo-segmented repo-pr-filters" role="tablist" aria-label="Filter pull requests">
          {PR_FILTER_TABS.map((id) => (
            <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? 'active' : ''} onClick={() => onFilterChange?.(id)}>{PR_FILTER_LABELS[id]}</button>
          ))}
        </div>
        {visible.length === 0 && <p className="repo-empty">No pull requests match this filter.</p>}
        <ul>
          {visible.map((pr) => (
            <li key={pr.number}>
              <button className={current?.number === pr.number ? 'active' : ''} aria-current={current?.number === pr.number ? 'true' : undefined} onClick={() => onSelect?.(pr.number)}>
                <span className="repo-pr-row-top">
                  <GitPullRequest size={13} className={`pr-state-${pr.state}`} aria-hidden />
                  <span className="repo-pr-title">{pr.title}</span>
                </span>
                <span className="repo-pr-row-meta">
                  <StatusBadge tone={stateTone(pr.state)}>{pr.state}</StatusBadge>
                  {pr.authorKind === 'agent' ? <span className="repo-owner repo-owner-agent"><Bot size={11} />{pr.author}</span> : <span className="repo-owner repo-owner-human"><User size={11} />{pr.author}</span>}
                  <span className="repo-muted">#{pr.number} · {relativeTime(pr.updatedAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {current ? <PullRequestDetail pr={current} onRequestAgentWorktree={onRequestAgentWorktree} /> : <div className="repo-empty">Select a pull request.</div>}
    </div>
  )
}

function PullRequestDetail({ pr: summary, onRequestAgentWorktree }: { pr: PullRequestView; onRequestAgentWorktree: (request: AgentActionRequest) => void }) {
  const detail = useRepositoryStore((state) => state.pullRequestDetails[summary.number])
  const detailLoading = useRepositoryStore((state) => state.pullRequestLoading[summary.number])
  const detailError = useRepositoryStore((state) => state.pullRequestErrors[summary.number])
  const loadDetail = useRepositoryStore((state) => state.loadPullRequestDetail)
  const runOperation = useRepositoryStore((state) => state.runOperation)
  const pending = useRepositoryStore((state) => state.pending)
  const [reviewBody, setReviewBody] = useState('')
  const [selectedFile, setSelectedFile] = useState('')
  const pr = detail ?? summary
  const activeFile = pr.files.find((file) => file.path === selectedFile) ?? pr.files[0]

  useEffect(() => { if (!detail && !detailLoading && !detailError) void loadDetail(summary.number) }, [detail, detailError, detailLoading, loadDetail, summary.number])

  const submitReview = (event: 'approve' | 'request_changes' | 'comment') => {
    void runOperation({ kind: 'submit_review', number: pr.number, event, body: reviewBody.trim() }, { key: `review:${pr.number}` })
      .then((record) => { if (record.status === 'succeeded') setReviewBody('') })
      .catch(() => undefined)
  }
  const requestReview = () => {
    const reviewers = window.prompt('Request review from (comma-separated logins):')?.split(',').map((item) => item.trim()).filter(Boolean)
    if (!reviewers?.length) return
    void runOperation({ kind: 'request_review', number: pr.number, reviewers }, { key: `request-review:${pr.number}` }).catch(() => undefined)
  }
  const markReady = () => void runOperation({ kind: 'mark_pull_request_ready', number: pr.number }, { key: `ready:${pr.number}` }).catch(() => undefined)
  const askAgent = () => onRequestAgentWorktree({
    title: `Ask an agent to update PR #${pr.number}`,
    purpose: `Hand this pull request to an agent to address review feedback and update the branch "${pr.headBranch}".`,
    defaultBranch: pr.headBranch || `agent/pr-${pr.number}`,
    fileScope: [],
    taskId: `pr-${pr.number}`,
    requiresApproval: false,
    permission: 'Create a worktree on the PR head branch and push updates',
  })

  const reviewing = Boolean(pending[`review:${pr.number}`])

  return (
    <div className="repo-pr-detail">
      <header className="repo-pr-detail-head">
        <div>
          <h3>{pr.title} <span className="repo-muted">#{pr.number}</span></h3>
          <div className="repo-pr-branches"><code>{pr.baseBranch || 'Base branch unavailable'}</code> ← <code>{pr.headBranch || 'Head branch unavailable'}</code></div>
        </div>
        <div className="repo-pr-detail-badges">
          <StatusBadge tone={stateTone(pr.state)}>{pr.state}</StatusBadge>
          <StatusBadge tone={reviewTone(pr.reviewDecision)}>{reviewLabel(pr.reviewDecision)}</StatusBadge>
          <StatusBadge tone={checksTone(pr.checksState)}>{checksLabel(pr.checksState)}</StatusBadge>
        </div>
      </header>

      <div className="repo-pr-stats">
        <span><strong>{pr.changedFiles}</strong> files</span>
        <span><strong>{pr.commits >= 0 ? pr.commits : '—'}</strong> {pr.commits >= 0 ? 'commits' : 'commits loading'}</span>
        <span><MessageSquare size={12} /> {pr.comments >= 0 ? pr.comments : 'comments loading'}</span>
        {pr.labels.map((label) => <span key={label} className="repo-tag">{label}</span>)}
        {pr.linkedIssue && <span className="repo-tag">Linked {pr.linkedIssue}</span>}
        <span className="repo-diff-add">+{pr.additions}</span><span className="repo-diff-del">−{pr.deletions}</span>
      </div>

      {detailLoading && <p className="repo-muted">Refreshing files, commits, checks and review threads from GitHub…</p>}
      {detailError && <ConnectedPlaceholder inline title="Pull request detail failed" message={detailError} onRetry={() => void loadDetail(pr.number)} />}

      {pr.body && <p className="repo-pr-body">{pr.body}</p>}

      <MergeGate pr={pr} />

      <section className="repo-pr-cockpit">
        <div className="repo-pr-file-list">
          <header><strong>Changed files</strong><span>{pr.files.length || pr.changedFiles}</span></header>
          {pr.files.map((file) => <button key={file.path} className={activeFile?.path === file.path ? 'active' : ''} onClick={() => setSelectedFile(file.path)}><span>{file.path}</span><small><span className="repo-diff-add">+{file.additions}</span> <span className="repo-diff-del">−{file.deletions}</span></small></button>)}
          {!detailLoading && pr.files.length === 0 && !detailError && <p className="repo-muted">GitHub returned no changed files for this pull request.</p>}
        </div>
        <div className="repo-pr-diff">
          <header><strong>{activeFile?.path ?? 'Select a changed file'}</strong>{activeFile && <span>{activeFile.status}</span>}</header>
          {activeFile?.patch ? <pre>{activeFile.patch}</pre> : <div className="repo-diff-state">{activeFile ? 'GitHub omitted this patch because the file is binary or the diff is too large.' : 'No diff is available.'}</div>}
        </div>
        <aside className="repo-pr-review-rail">
          <header><strong>Review activity</strong><span>{pr.reviews.length + pr.reviewThreads.length}</span></header>
          {pr.reviews.map((review, index) => <article key={`${review.author}:${review.submittedAt}:${index}`}><strong>{review.author}</strong><StatusBadge tone={review.state === 'approved' ? 'success' : review.state === 'changes_requested' ? 'danger' : 'neutral'}>{review.state.replaceAll('_', ' ')}</StatusBadge>{review.body && <p>{review.body}</p>}</article>)}
          {pr.reviewThreads.map((thread) => <article key={thread.id}><strong>{thread.author}</strong><span className="repo-muted">{thread.path}{thread.line ? `:${thread.line}` : ''}</span><p>{thread.body}</p></article>)}
          {pr.reviews.length + pr.reviewThreads.length === 0 && <p className="repo-muted">No review activity has been submitted.</p>}
          {pr.checks.length > 0 && <div className="repo-pr-checks"><strong>Checks</strong>{pr.checks.map((check) => <div key={`${check.workflowName}:${check.name}`}><StatusBadge tone={check.conclusion === 'success' ? 'success' : check.conclusion ? 'danger' : 'pending'}>{check.conclusion || check.status}</StatusBadge><span>{check.workflowName ? `${check.workflowName} / ` : ''}{check.name}</span></div>)}</div>}
        </aside>
      </section>

      <div className="repo-pr-review">
        <textarea value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} placeholder="Leave a review comment…" aria-label="Review comment" rows={2} />
        <div className="repo-pr-review-actions">
          {pr.state === 'draft' && <Button variant="secondary" icon={<CheckCircle2 size={14} />} onClick={markReady} disabled={Boolean(pending[`ready:${pr.number}`])}>Ready for review</Button>}
          <Button variant="ghost" icon={<CircleDashed size={14} />} onClick={requestReview} disabled={Boolean(pending[`request-review:${pr.number}`])}>Request review</Button>
          <Button variant="ghost" icon={<MessageSquare size={14} />} onClick={() => submitReview('comment')} disabled={reviewing || !reviewBody.trim()}>Comment</Button>
          <Button variant="ghost" icon={<X size={14} />} onClick={() => submitReview('request_changes')} disabled={reviewing || !reviewBody.trim()}>Request changes</Button>
          <Button variant="primary" icon={<Check size={14} />} onClick={() => submitReview('approve')} disabled={reviewing}>Approve</Button>
        </div>
        <div className="repo-pr-agent-row">
          <Button variant="secondary" icon={<Bot size={14} />} onClick={askAgent}>Ask an agent to update this PR</Button>
        </div>
      </div>

    </div>
  )
}

function stateTone(state: PullRequestView['state']): BadgeTone {
  return state === 'merged' ? 'accent' : state === 'closed' ? 'danger' : state === 'draft' ? 'neutral' : 'success'
}
function reviewTone(decision: PullRequestView['reviewDecision']): BadgeTone {
  return decision === 'approved' ? 'success' : decision === 'changes_requested' ? 'danger' : 'warning'
}
function reviewLabel(decision: PullRequestView['reviewDecision']): string {
  return decision === 'approved' ? 'Approved' : decision === 'changes_requested' ? 'Changes requested' : decision === 'review_required' ? 'Review required' : 'No reviews'
}
function checksTone(state: PullRequestView['checksState']): BadgeTone {
  return state === 'passing' ? 'success' : state === 'failing' ? 'danger' : state === 'pending' ? 'pending' : 'neutral'
}
function checksLabel(state: PullRequestView['checksState']): string {
  return state === 'passing' ? 'Checks passing' : state === 'failing' ? 'Checks failing' : state === 'pending' ? 'Checks running' : 'No checks'
}
