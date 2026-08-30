import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  FileDiff,
  GitMerge,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldQuestion,
  X,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { ErrorNotice } from '../../../components/ui/ErrorNotice'
import type {
  RepositoryCommitFile,
  RepositoryCommitSummary,
  RepositoryFileStatus,
} from '../../../native/types'
import { layoutCommitGraph, type CommitGraphRow } from '../commitGraphLayout'
import { useRepositoryStore } from '../repositoryStore'
import { relativeTime } from '../repositorySelectors'
import { StatusBadge, type BadgeTone } from './StatusBadge'

const LANE_WIDTH = 18
const LANE_COLORS = [
  'var(--accent-strong)',
  'var(--success)',
  'var(--warning)',
  'var(--danger)',
  'var(--muted)',
]

/**
 * The Graph is a bounded Git history walk plus a persistent Commit Inspector. It does not own
 * Git state: selection, paging, and immutable commit details stay in repositoryStore.
 */
export function HistorySection() {
  const commits = useRepositoryStore((state) => state.historyCommits)
  const scope = useRepositoryStore((state) => state.historyScope)
  const hasMore = useRepositoryStore((state) => state.historyHasMore)
  const loading = useRepositoryStore((state) => state.historyLoading)
  const paging = useRepositoryStore((state) => state.historyPaging)
  const error = useRepositoryStore((state) => state.historyError)
  const selected = useRepositoryStore((state) => state.selectedCommit)
  const snapshot = useRepositoryStore((state) => state.snapshot)
  const loadHistory = useRepositoryStore((state) => state.loadHistory)
  const loadMoreHistory = useRepositoryStore((state) => state.loadMoreHistory)
  const selectCommit = useRepositoryStore((state) => state.selectCommit)
  const [search, setSearch] = useState(scope.search ?? '')

  useEffect(() => { setSearch(scope.search ?? '') }, [scope.search])

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault()
    const value = search.trim()
    if (value !== (scope.search ?? '')) {
      void loadHistory({ ...scope, search: value || undefined })
    }
  }

  const rows = useMemo(() => layoutCommitGraph(commits), [commits])
  const current = useMemo(
    () => commits.find((commit) => commit.sha === selected) ?? commits[0],
    [commits, selected],
  )

  return (
    <div className="repo-history repo-graph">
      <div className="repo-history-list repo-graph-list" aria-label="Git commit graph">
        <div className="repo-history-toolbar repo-graph-toolbar">
          <form className="repo-history-search" onSubmit={applySearch} role="search">
            <Search size={13} aria-hidden />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search subject or SHA"
              aria-label="Search commits"
              spellCheck={false}
            />
            {search && (
              <button
                type="button"
                className="repo-icon-btn"
                aria-label="Clear graph search"
                onClick={() => {
                  setSearch('')
                  void loadHistory({ ...scope, search: undefined })
                }}
              >
                <X size={12} />
              </button>
            )}
          </form>
          <Button
            variant="ghost"
            icon={loading ? <Loader2 size={14} className="is-spinning" /> : <RefreshCw size={14} />}
            aria-label="Refresh graph"
            disabled={loading}
            onClick={() => void loadHistory()}
          />
        </div>

        {snapshot && <WipRow branch={snapshot.branch} files={snapshot.files} />}
        {scope.path && (
          <div className="repo-history-scope">
            <FileDiff size={12} aria-hidden />
            <code title={scope.path}>{scope.path}</code>
            <button type="button" className="repo-icon-btn" aria-label="Show all commits" onClick={() => void loadHistory({ search: scope.search })}>
              <X size={12} />
            </button>
          </div>
        )}
        {error && <div className="repo-history-error"><ErrorNotice message={error} onRetry={() => void loadHistory()} /></div>}
        {loading && commits.length === 0 && <p className="repo-empty"><Loader2 size={14} className="is-spinning" /> Reading Git history…</p>}
        {!loading && !error && commits.length === 0 && <p className="repo-empty">{scope.path || scope.search ? 'No commits match this filter.' : 'This repository has no commits yet.'}</p>}

        <ul className="repo-graph-rows">
          {rows.map((row) => (
            <GraphRow key={row.commit.sha} row={row} selected={current?.sha === row.commit.sha} onSelect={selectCommit} />
          ))}
        </ul>
        {hasMore && (
          <div className="repo-history-more">
            <Button
              variant="secondary"
              icon={paging ? <Loader2 size={14} className="is-spinning" /> : <ChevronDown size={14} />}
              disabled={paging}
              onClick={() => void loadMoreHistory()}
            >
              {paging ? 'Loading…' : 'Load more commits'}
            </Button>
          </div>
        )}
      </div>
      {current ? <CommitInspector commit={current} /> : <div className="repo-empty">Select a commit to inspect it.</div>}
    </div>
  )
}

function WipRow({ branch, files }: { branch?: string; files: RepositoryFileStatus[] }) {
  const staged = files.filter((file) => file.indexStatus !== '.' && !file.untracked).length
  const conflicts = files.filter((file) => file.conflicted).length
  if (files.length === 0) return null

  return (
    <div className="repo-graph-wip">
      <div><strong>WIP</strong><span>{branch ?? 'Detached HEAD'}</span></div>
      <span>{files.length} changed</span>
      {staged > 0 && <span>{staged} staged</span>}
      {conflicts > 0 && <span className="repo-graph-danger">{conflicts} conflict{conflicts === 1 ? '' : 's'}</span>}
    </div>
  )
}

function GraphRow({ row, selected, onSelect }: { row: CommitGraphRow; selected: boolean; onSelect: (sha: string) => void }) {
  const { commit } = row
  const width = Math.max(34, Math.max(row.lanesBefore.length, row.lanesAfter.length, row.lane + 1) * LANE_WIDTH + 10)
  const laneX = (lane: number) => lane * LANE_WIDTH + 12

  return (
    <li>
      <button className={selected ? 'active' : ''} aria-current={selected ? 'true' : undefined} onClick={() => onSelect(commit.sha)}>
        <svg className="repo-graph-lanes" viewBox={`0 0 ${width} 48`} width={width} height="48" aria-hidden="true">
          {row.lanesBefore.map((_, lane) => lane !== row.lane && (
            <path key={`in-${lane}`} d={`M ${laneX(lane)} 0 V 48`} stroke={LANE_COLORS[lane % LANE_COLORS.length]} />
          ))}
          {row.parentLanes.map((parentLane, index) => (
            <path key={`out-${index}`} d={`M ${laneX(row.lane)} 24 C ${laneX(row.lane)} 37, ${laneX(parentLane)} 35, ${laneX(parentLane)} 48`} stroke={LANE_COLORS[row.lane % LANE_COLORS.length]} />
          ))}
          <circle cx={laneX(row.lane)} cy="24" r={commit.parents.length > 1 ? 5 : 4} fill="var(--surface)" stroke={LANE_COLORS[row.lane % LANE_COLORS.length]} />
        </svg>
        <span className="repo-graph-row-content">
          <span className="repo-history-row-top">
            <span className="repo-history-subject">{commit.subject || '(no subject)'}</span>
            {commit.parents.length > 1 && <GitMerge size={13} className="repo-history-merge" aria-label="Merge commit" />}
          </span>
          <span className="repo-history-row-meta">
            <code>{shortSha(commit.sha)}</code>
            <span className="repo-muted">{commit.authorName} · {relativeTime(commit.authoredAt)}</span>
            {commit.refs.map((ref) => <span key={ref} className="repo-tag">{ref}</span>)}
          </span>
        </span>
      </button>
    </li>
  )
}

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
          <p className="repo-history-identity"><strong>{commit.authorName}</strong> <span className="repo-muted">{commit.authorEmail}</span><span className="repo-muted"> authored {relativeTime(commit.authoredAt)}</span></p>
          {commit.committerEmail !== commit.authorEmail && <p className="repo-history-identity repo-muted">Committed by {commit.committerName} {relativeTime(commit.committedAt)}</p>}
        </div>
        <div className="repo-history-detail-badges">
          <StatusBadge tone="neutral" title={commit.sha}>{shortSha(commit.sha)}</StatusBadge>
          {detail?.merge && <StatusBadge tone="accent" icon={<GitMerge size={11} />}>merge</StatusBadge>}
          {signature && <StatusBadge tone={signature.tone} icon={signature.trusted ? <ShieldCheck size={11} /> : <ShieldQuestion size={11} />} title={`git %G? = ${commit.signature}`}>{signature.label}</StatusBadge>}
        </div>
      </div>
      {commit.refs.length > 0 && <div className="repo-history-refs">{commit.refs.map((ref) => <span key={ref} className="repo-tag">{ref}</span>)}</div>}
      <div className="repo-history-parents">
        <span className="repo-muted">{commit.parents.length === 0 ? 'Root commit' : commit.parents.length > 1 ? 'Parents' : 'Parent'}</span>
        {commit.parents.map((parent) => commits.some((item) => item.sha === parent)
          ? <button key={parent} type="button" className="repo-history-parent" onClick={() => selectCommit(parent)}>{shortSha(parent)}</button>
          : <code key={parent} className="repo-history-parent-flat" title={`${parent} is outside the loaded page`}>{shortSha(parent)}</code>)}
      </div>
      {detail?.body && <pre className="repo-history-body">{detail.body}</pre>}
      {error && <ErrorNotice message={error} onRetry={() => void loadCommitDetail(commit.sha)} />}
      {loading && !detail && <p className="repo-empty"><Loader2 size={14} className="is-spinning" /> Reading commit…</p>}
      {detail && <CommitFiles detail={detail} scope={scope} loadHistory={loadHistory} />}
    </div>
  )
}

function CommitFiles({ detail, scope, loadHistory }: {
  detail: ReturnType<typeof useRepositoryStore.getState>['commitDetails'][string]
  scope: ReturnType<typeof useRepositoryStore.getState>['historyScope']
  loadHistory: ReturnType<typeof useRepositoryStore.getState>['loadHistory']
}) {
  return <>
    <div className="repo-section-subhead"><span>Changed files</span><span className="repo-count">{detail.files.length}</span><span className="repo-muted">+{detail.additions} −{detail.deletions}</span>{detail.merge && <span className="repo-muted">against first parent</span>}</div>
    {detail.filesTruncated && <p className="repo-inline-warning">Only the first {detail.files.length} files are listed for this commit.</p>}
    {detail.files.length === 0 && <p className="repo-empty">This commit changes no files.</p>}
    <ul className="repo-history-files">
      {detail.files.map((file) => <li key={file.path}>
        <span className={`repo-history-status status-${statusKey(file.status)}`} title={statusTitle(file.status)}>{file.status || '?'}</span>
        <span className="repo-history-file-path" title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}>{file.previousPath && <span className="repo-muted">{file.previousPath} → </span>}{file.path}</span>
        <span className="repo-history-counts">{lineCounts(file)}</span>
        <button type="button" className="repo-icon-btn" aria-label={`Show history for ${file.path}`} title="Show history for this file" onClick={() => void loadHistory({ ...scope, path: file.path })}><FileDiff size={12} /></button>
      </li>)}
    </ul>
  </>
}

function shortSha(sha: string): string { return sha.slice(0, 8) }
function lineCounts(file: RepositoryCommitFile): string { return file.binary || file.additions === null || file.deletions === null ? 'binary' : `+${file.additions} −${file.deletions}` }
function statusKey(status: string): string { return (status.charAt(0) || 'x').toLowerCase() }
function statusTitle(status: string): string { return ({ A: 'Added', M: 'Modified', D: 'Deleted', R: `Renamed (${status.slice(1)}% similar)`, C: `Copied (${status.slice(1)}% similar)`, T: 'Type changed', U: 'Unmerged' } as Record<string, string>)[status.charAt(0)] ?? 'Unknown status' }
function signatureLabel(code: string): { label: string; tone: BadgeTone; trusted: boolean } | undefined { return ({ G: { label: 'signed', tone: 'success', trusted: true }, B: { label: 'bad signature', tone: 'danger', trusted: false }, U: { label: 'signed, untrusted key', tone: 'warning', trusted: false }, X: { label: 'signature expired', tone: 'warning', trusted: false }, Y: { label: 'signed by expired key', tone: 'warning', trusted: false }, R: { label: 'signed by revoked key', tone: 'danger', trusted: false }, E: { label: 'signature unverifiable', tone: 'warning', trusted: false } } as Record<string, { label: string; tone: BadgeTone; trusted: boolean }>)[code] }
