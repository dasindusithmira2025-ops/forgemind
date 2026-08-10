import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown, FileDiff, GitCommitHorizontal, GitMerge, Loader2, RefreshCw, Search, ShieldCheck,
  ShieldQuestion, X,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { ErrorNotice } from '../../../components/ui/ErrorNotice'
import type { RepositoryCommitFile, RepositoryCommitSummary } from '../../../native/types'
import { useRepositoryStore } from '../repositoryStore'
import { relativeTime } from '../repositorySelectors'
import { StatusBadge, type BadgeTone } from './StatusBadge'

/**
 * Commit history and the Commit Inspector — the repository's read surface for what already
 * happened. The listing is a bounded, paged `git log` walk; the Inspector reads one commit's
 * identity, message and changed files. Everything shown comes from Git: an absent value (an
 * unsigned commit, a binary file's line count) is rendered as absent rather than filled in.
 */
export function HistorySection() {
  const commits = useRepositoryStore((state) => state.historyCommits)
  const scope = useRepositoryStore((state) => state.historyScope)
  const hasMore = useRepositoryStore((state) => state.historyHasMore)
  const loading = useRepositoryStore((state) => state.historyLoading)
  const paging = useRepositoryStore((state) => state.historyPaging)
  const error = useRepositoryStore((state) => state.historyError)
  const selected = useRepositoryStore((state) => state.selectedCommit)
  const loadHistory = useRepositoryStore((state) => state.loadHistory)
  const loadMoreHistory = useRepositoryStore((state) => state.loadMoreHistory)
  const selectCommit = useRepositoryStore((state) => state.selectCommit)

  const [search, setSearch] = useState(scope.search ?? '')

  // Keep the input in step when the scope is changed from elsewhere (e.g. a file-history entry).
  useEffect(() => { setSearch(scope.search ?? '') }, [scope.search])

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault()
    const value = search.trim()
    if (value === (scope.search ?? '')) return
    void loadHistory({ ...scope, search: value || undefined })
  }
  const clearPath = () => void loadHistory({ search: scope.search })

  const current = useMemo(
    () => commits.find((commit) => commit.sha === selected) ?? commits[0],
    [commits, selected],
  )

  return (
    <div className="repo-history">
      <div className="repo-history-list" aria-label="Commit history">
        <div className="repo-history-toolbar">
          <form className="repo-history-search" onSubmit={applySearch} role="search">
            <Search size={13} aria-hidden />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by message"
              aria-label="Filter commits by message"
              spellCheck={false}
            />
            {search && (
              <button type="button" className="repo-icon-btn" aria-label="Clear message filter" onClick={() => { setSearch(''); void loadHistory({ ...scope, search: undefined }) }}>
                <X size={12} />
              </button>
            )}
          </form>
          <Button variant="ghost" icon={loading ? <Loader2 size={14} className="is-spinning" /> : <RefreshCw size={14} />} aria-label="Refresh history" disabled={loading} onClick={() => void loadHistory()} />
        </div>

        {scope.path && (
          <div className="repo-history-scope">
            <FileDiff size={12} aria-hidden />
            <code title={scope.path}>{scope.path}</code>
            <button type="button" className="repo-icon-btn" aria-label="Show all commits" onClick={clearPath}><X size={12} /></button>
          </div>
        )}

        {error && <div className="repo-history-error"><ErrorNotice message={error} onRetry={() => void loadHistory()} /></div>}

        {loading && commits.length === 0 && <p className="repo-empty"><Loader2 size={14} className="is-spinning" /> Reading commit history…</p>}
        {!loading && !error && commits.length === 0 && (
          <p className="repo-empty">
            {scope.path || scope.search
              ? 'No commits match this filter.'
              : 'This repository has no commits yet.'}
          </p>
        )}

        <ul>
          {commits.map((commit) => (
            <li key={commit.sha}>
              <button
                className={current?.sha === commit.sha ? 'active' : ''}
                aria-current={current?.sha === commit.sha ? 'true' : undefined}
                onClick={() => selectCommit(commit.sha)}
              >
                <span className="repo-history-row-top">
                  {commit.parents.length > 1
                    ? <GitMerge size={13} className="repo-history-merge" aria-label="Merge commit" />
                    : <GitCommitHorizontal size={13} aria-hidden />}
                  <span className="repo-history-subject">{commit.subject || '(no subject)'}</span>
                </span>
                <span className="repo-history-row-meta">
                  <code>{shortSha(commit.sha)}</code>
                  <span className="repo-muted">{commit.authorName} · {relativeTime(commit.authoredAt)}</span>
                  {commit.refs.map((ref) => <span key={ref} className="repo-tag">{ref}</span>)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {hasMore && (
          <div className="repo-history-more">
            <Button variant="secondary" icon={paging ? <Loader2 size={14} className="is-spinning" /> : <ChevronDown size={14} />} disabled={paging} onClick={() => void loadMoreHistory()}>
              {paging ? 'Loading…' : 'Load more commits'}
            </Button>
          </div>
        )}
      </div>

      {current
        ? <CommitInspector commit={current} />
        : <div className="repo-empty">Select a commit to inspect it.</div>}
    </div>
  )
}

/**
 * The Commit Inspector. Identity, signature status, message body and the changed-file list are
 * all read from the commit itself; a merge is diffed against its first parent and says so, rather
 * than presenting an empty file list as "no changes".
 */
function CommitInspector({ commit }: { commit: RepositoryCommitSummary }) {
  const detail = useRepositoryStore((state) => state.commitDetails[commit.sha])
  const loading = useRepositoryStore((state) => state.commitDetailLoading[commit.sha])
  const error = useRepositoryStore((state) => state.commitDetailErrors[commit.sha])
  const loadCommitDetail = useRepositoryStore((state) => state.loadCommitDetail)
  const selectCommit = useRepositoryStore((state) => state.selectCommit)
  const commits = useRepositoryStore((state) => state.historyCommits)
  const scope = useRepositoryStore((state) => state.historyScope)
  const loadHistory = useRepositoryStore((state) => state.loadHistory)

  useEffect(() => { void loadCommitDetail(commit.sha) }, [commit.sha, loadCommitDetail])

  const signature = signatureLabel(commit.signature)

  return (
    <div className="repo-history-detail">
      <div className="repo-history-detail-head">
        <div>
          <h3>{commit.subject || '(no subject)'}</h3>
          <p className="repo-history-identity">
            <strong>{commit.authorName}</strong> <span className="repo-muted">{commit.authorEmail}</span>
            <span className="repo-muted"> authored {relativeTime(commit.authoredAt)}</span>
          </p>
          {commit.committerEmail !== commit.authorEmail && (
            <p className="repo-history-identity repo-muted">
              Committed by {commit.committerName} {relativeTime(commit.committedAt)}
            </p>
          )}
        </div>
        <div className="repo-history-detail-badges">
          <StatusBadge tone="neutral" title={commit.sha}>{shortSha(commit.sha)}</StatusBadge>
          {detail?.merge && <StatusBadge tone="accent" icon={<GitMerge size={11} />}>merge</StatusBadge>}
          {signature && <StatusBadge tone={signature.tone} icon={signature.trusted ? <ShieldCheck size={11} /> : <ShieldQuestion size={11} />} title={`git %G? = ${commit.signature}`}>{signature.label}</StatusBadge>}
        </div>
      </div>

      {commit.refs.length > 0 && (
        <div className="repo-history-refs">{commit.refs.map((ref) => <span key={ref} className="repo-tag">{ref}</span>)}</div>
      )}

      <div className="repo-history-parents">
        <span className="repo-muted">{commit.parents.length === 0 ? 'Root commit' : commit.parents.length > 1 ? 'Parents' : 'Parent'}</span>
        {commit.parents.map((parent) => {
          const known = commits.some((item) => item.sha === parent)
          return known
            ? <button key={parent} type="button" className="repo-history-parent" onClick={() => selectCommit(parent)}>{shortSha(parent)}</button>
            : <code key={parent} className="repo-history-parent-flat" title={`${parent} is outside the loaded page`}>{shortSha(parent)}</code>
        })}
      </div>

      {detail?.body && <pre className="repo-history-body">{detail.body}</pre>}

      {error && <ErrorNotice message={error} onRetry={() => void loadCommitDetail(commit.sha)} />}
      {loading && !detail && <p className="repo-empty"><Loader2 size={14} className="is-spinning" /> Reading commit…</p>}

      {detail && (
        <>
          <div className="repo-section-subhead">
            <span>Changed files</span>
            <span className="repo-count">{detail.files.length}</span>
            <span className="repo-muted">+{detail.additions} −{detail.deletions}</span>
            {detail.merge && <span className="repo-muted">against first parent</span>}
          </div>
          {detail.filesTruncated && (
            <p className="repo-inline-warning">Only the first {detail.files.length} files are listed for this commit.</p>
          )}
          {detail.files.length === 0 && <p className="repo-empty">This commit changes no files.</p>}
          <ul className="repo-history-files">
            {detail.files.map((file) => (
              <li key={file.path}>
                <span className={`repo-history-status status-${statusKey(file.status)}`} title={statusTitle(file.status)}>{file.status || '?'}</span>
                <span className="repo-history-file-path" title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}>
                  {file.previousPath && <span className="repo-muted">{file.previousPath} → </span>}
                  {file.path}
                </span>
                <span className="repo-history-counts">{lineCounts(file)}</span>
                <button
                  type="button"
                  className="repo-icon-btn"
                  aria-label={`Show history for ${file.path}`}
                  title="Show history for this file"
                  onClick={() => void loadHistory({ ...scope, path: file.path })}
                >
                  <FileDiff size={12} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function shortSha(sha: string): string {
  return sha.slice(0, 8)
}

/** Binary files carry no line count, so they read as "binary" instead of a misleading `+0 −0`. */
function lineCounts(file: RepositoryCommitFile): string {
  if (file.binary || file.additions === null || file.deletions === null) return 'binary'
  return `+${file.additions} −${file.deletions}`
}

function statusKey(status: string): string {
  return (status.charAt(0) || 'x').toLowerCase()
}

function statusTitle(status: string): string {
  switch (status.charAt(0)) {
    case 'A': return 'Added'
    case 'M': return 'Modified'
    case 'D': return 'Deleted'
    case 'R': return `Renamed (${status.slice(1)}% similar)`
    case 'C': return `Copied (${status.slice(1)}% similar)`
    case 'T': return 'Type changed'
    case 'U': return 'Unmerged'
    default: return 'Unknown status'
  }
}

/**
 * Map Git's raw `%G?` code to an honest label. Only `G` is reported as a verified signature;
 * every other signed state says exactly what Git said rather than being rounded up to "signed".
 */
function signatureLabel(code: string): { label: string; tone: BadgeTone; trusted: boolean } | undefined {
  switch (code) {
    case 'G': return { label: 'signed', tone: 'success', trusted: true }
    case 'B': return { label: 'bad signature', tone: 'danger', trusted: false }
    case 'U': return { label: 'signed, untrusted key', tone: 'warning', trusted: false }
    case 'X': return { label: 'signature expired', tone: 'warning', trusted: false }
    case 'Y': return { label: 'signed by expired key', tone: 'warning', trusted: false }
    case 'R': return { label: 'signed by revoked key', tone: 'danger', trusted: false }
    case 'E': return { label: 'signature unverifiable', tone: 'warning', trusted: false }
    default: return undefined
  }
}
