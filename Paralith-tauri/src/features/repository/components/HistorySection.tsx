import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown, ChevronRight, FileDiff, GitMerge, Loader2, RefreshCw, Search, ShieldCheck,
  ShieldQuestion, X,
} from 'lucide-react'
import { ErrorNotice } from '../../../components/ui/ErrorNotice'
import type { RepositoryCommitFile, RepositoryCommitSummary } from '../../../native/types'
import { useRepositoryStore } from '../repositoryStore'
import { relativeTime } from '../repositorySelectors'
import {
  buildCommitGraph, groupByDirectory, groupRefs, laneColumn, refDisplayName, refRemoteSuffix,
  splitPath, type GraphRow, type RefGroup,
} from '../commitGraph'
import type { BadgeTone } from './StatusBadge'

/**
 * Commit history and the Commit Inspector — the repository's read surface for what already
 * happened. The listing is a bounded, paged `git log` walk; the Inspector reads one commit's
 * identity, message and changed files. Everything shown comes from Git: an absent value (an
 * unsigned commit, a binary file's line count) is rendered as absent rather than filled in.
 *
 * Layout contract: the graph rail, the commit column and the SHA are three fixed roles in a row —
 * the rail can never collide with the subject, the subject ellipsizes rather than wrapping, and
 * secondary metadata is dropped at narrow widths before the subject is damaged.
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
  const graph = useMemo(() => buildCommitGraph(commits), [commits])

  return (
    <div className="repo-graph">
      <div className="repo-graph-pane" aria-label="Commit history">
        <div className="repo-graph-toolbar">
          <form className="repo-graph-search" onSubmit={applySearch} role="search">
            <Search size={12} aria-hidden />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter commits"
              aria-label="Filter commits by message"
              spellCheck={false}
            />
            {search && (
              <button type="button" className="repo-icon-btn" aria-label="Clear message filter" onClick={() => { setSearch(''); void loadHistory({ ...scope, search: undefined }) }}>
                <X size={11} />
              </button>
            )}
          </form>
          <button
            type="button"
            className="repo-icon-btn"
            aria-label="Refresh history"
            title="Refresh history"
            disabled={loading}
            onClick={() => void loadHistory()}
          >
            {loading ? <Loader2 size={13} className="is-spinning" /> : <RefreshCw size={13} />}
          </button>
        </div>

        {scope.path && (
          <div className="repo-graph-scope">
            <FileDiff size={11} aria-hidden />
            <code title={scope.path}>{scope.path}</code>
            <button type="button" className="repo-icon-btn" aria-label="Show all commits" onClick={clearPath}><X size={11} /></button>
          </div>
        )}

        {error && <div className="repo-graph-notice"><ErrorNotice message={error} onRetry={() => void loadHistory()} /></div>}

        {loading && commits.length === 0 && <p className="repo-empty"><Loader2 size={13} className="is-spinning" /> Reading commit history…</p>}
        {!loading && !error && commits.length === 0 && (
          <p className="repo-empty">
            {scope.path || scope.search
              ? 'No commits match this filter.'
              : 'This repository has no commits yet.'}
          </p>
        )}

        <ul className="repo-graph-rows" style={{ '--graph-rail': `${railWidth(graph.lanes)}px` } as React.CSSProperties}>
          {commits.map((commit, index) => (
            <CommitRow
              key={commit.sha}
              commit={commit}
              row={graph.rows[index]}
              lanes={graph.lanes}
              active={current?.sha === commit.sha}
              onSelect={selectCommit}
            />
          ))}
        </ul>

        {hasMore && (
          <div className="repo-graph-more">
            <button type="button" className="repo-graph-more-btn" disabled={paging} onClick={() => void loadMoreHistory()}>
              {paging ? <Loader2 size={13} className="is-spinning" /> : <ChevronDown size={13} />}
              {paging ? 'Loading…' : 'Load more commits'}
            </button>
          </div>
        )}
      </div>

      {current
        ? <CommitInspector commit={current} />
        : <div className="repo-graph-detail repo-empty">Select a commit to inspect it.</div>}
    </div>
  )
}

// ---- Graph rail ------------------------------------------------------------------------------

/** Lane pitch and edge padding, in px. The rail is sized from these so text starts after it. */
const LANE_PITCH = 13
const RAIL_EDGE = 9

function railWidth(lanes: number): number {
  return RAIL_EDGE * 2 + (Math.max(lanes, 1) - 1) * LANE_PITCH
}
function laneX(lane: number): number {
  return RAIL_EDGE + laneColumn(lane) * LANE_PITCH
}

/**
 * The graph cell for one row. Lines are drawn in a stretched viewBox (y 0 = row top, 50 = the node
 * line, 100 = row bottom) so the rail follows the row height at any `--ui-scale` without the
 * component having to know what that height resolved to. The node itself is a DOM element rather
 * than an SVG circle, so it stays perfectly round under that vertical stretch.
 */
function GraphCell({ row, lanes }: { row: GraphRow | undefined; lanes: number }) {
  if (!row) return <span className="repo-graph-cell" aria-hidden />
  const width = railWidth(lanes)
  const path = (from: number, to: number, top: boolean): string => {
    const [y0, y1] = top ? [0, 50] : [50, 100]
    const x0 = laneX(from)
    const x1 = laneX(to)
    if (x0 === x1) return `M${x0} ${y0}V${y1}`
    const mid = (y0 + y1) / 2
    return `M${x0} ${y0}C${x0} ${mid},${x1} ${mid},${x1} ${y1}`
  }
  return (
    <span className="repo-graph-cell" aria-hidden>
      <svg viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" focusable="false">
        {row.top.map((edge, index) => (
          <path key={`t${index}`} d={path(edge.from, edge.to, true)} stroke={laneColor(edge.color)} vectorEffect="non-scaling-stroke" />
        ))}
        {row.bottom.map((edge, index) => (
          <path key={`b${index}`} d={path(edge.from, edge.to, false)} stroke={laneColor(edge.color)} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <span
        className={`repo-graph-node${row.merge ? ' is-merge' : ''}`}
        style={{ left: `${laneX(row.lane)}px`, color: laneColor(row.color) }}
      />
    </span>
  )
}

function laneColor(index: number): string {
  return `var(--graph-lane-${index + 1})`
}

function CommitRow({ commit, row, lanes, active, onSelect }: {
  commit: RepositoryCommitSummary
  row: GraphRow | undefined
  lanes: number
  active: boolean
  onSelect: (sha: string) => void
}) {
  const refs = useMemo(() => groupRefs(commit.refs), [commit.refs])
  return (
    <li>
      <button
        type="button"
        className={active ? 'repo-graph-row is-active' : 'repo-graph-row'}
        aria-current={active ? 'true' : undefined}
        onClick={() => onSelect(commit.sha)}
      >
        <GraphCell row={row} lanes={lanes} />
        <span className="repo-graph-main">
          <span className="repo-graph-line">
            <span className="repo-graph-subject" title={commit.subject}>{commit.subject || '(no subject)'}</span>
            {refs.length > 0 && <RefTrail refs={refs} />}
          </span>
          <span className="repo-graph-meta">
            <span className="repo-graph-author">{commit.authorName}</span>
            <span className="repo-graph-dot" aria-hidden>·</span>
            <span>{relativeTime(commit.authoredAt)}</span>
          </span>
        </span>
        <code className="repo-graph-sha">{shortSha(commit.sha)}</code>
      </button>
    </li>
  )
}

/** Grouped decorations, capped at two so a heavily-tagged commit cannot push out the subject. */
function RefTrail({ refs }: { refs: RefGroup[] }) {
  const shown = refs.slice(0, 2)
  const extra = refs.length - shown.length
  return (
    <span className="repo-graph-refs">
      {shown.map((group) => {
        const remotes = refRemoteSuffix(group)
        return (
          <span
            key={`${group.kind}:${group.label}`}
            className={`repo-ref${group.head ? ' is-head' : ''}${group.kind === 'tag' ? ' is-tag' : ''}`}
            title={remotes ? `${refDisplayName(group)} · ${remotes}` : refDisplayName(group)}
          >
            {refDisplayName(group)}
            {remotes && <span className="repo-ref-remote">{remotes}</span>}
          </span>
        )
      })}
      {extra > 0 && <span className="repo-ref is-more" title={refs.slice(2).map(refDisplayName).join(', ')}>+{extra}</span>}
    </span>
  )
}

// ---- Commit inspector ------------------------------------------------------------------------

/** Above this many files the inspector offers a filter and groups rows under their directory. */
const GROUPING_THRESHOLD = 12
/** Above this many files the directory groups start collapsed, so a huge commit opens instantly. */
const COLLAPSE_THRESHOLD = 60

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
  const refs = useMemo(() => groupRefs(commit.refs), [commit.refs])

  return (
    <div className="repo-graph-detail">
      <header className="repo-commit-head">
        <h3 className="repo-commit-subject">{commit.subject || '(no subject)'}</h3>
        <p className="repo-commit-byline">
          <span className="repo-commit-author" title={commit.authorEmail}>{commit.authorName}</span>
          <span className="repo-graph-dot" aria-hidden>·</span>
          <span>{relativeTime(commit.authoredAt)}</span>
          <button
            type="button"
            className="repo-commit-sha"
            title={`Copy ${commit.sha}`}
            aria-label={`Copy commit SHA ${commit.sha}`}
            onClick={() => void navigator.clipboard?.writeText(commit.sha).catch(() => undefined)}
          >
            {shortSha(commit.sha)}
          </button>
          {detail?.merge && <span className="repo-commit-flag"><GitMerge size={11} aria-hidden />merge</span>}
          {signature && (
            <span className={`repo-commit-flag tone-${signature.tone}`} title={`git %G? = ${commit.signature}`}>
              {signature.trusted ? <ShieldCheck size={11} aria-hidden /> : <ShieldQuestion size={11} aria-hidden />}
              {signature.label}
            </span>
          )}
        </p>
        {commit.committerEmail !== commit.authorEmail && (
          <p className="repo-commit-subline">Committed by {commit.committerName} {relativeTime(commit.committedAt)}</p>
        )}

        <div className="repo-commit-context">
          {refs.length > 0 && (
            <span className="repo-graph-refs">
              {refs.map((group) => (
                <span
                  key={`${group.kind}:${group.label}`}
                  className={`repo-ref${group.head ? ' is-head' : ''}${group.kind === 'tag' ? ' is-tag' : ''}`}
                >
                  {refDisplayName(group)}
                  {refRemoteSuffix(group) && <span className="repo-ref-remote">{refRemoteSuffix(group)}</span>}
                </span>
              ))}
            </span>
          )}
          <span className="repo-commit-parents">
            <span className="repo-commit-label">{commit.parents.length === 0 ? 'Root commit' : commit.parents.length > 1 ? 'Parents' : 'Parent'}</span>
            {commit.parents.map((parent) => {
              const known = commits.some((item) => item.sha === parent)
              return known
                ? <button key={parent} type="button" className="repo-commit-parent" onClick={() => selectCommit(parent)}>{shortSha(parent)}</button>
                : <code key={parent} className="repo-commit-parent is-flat" title={`${parent} is outside the loaded page`}>{shortSha(parent)}</code>
            })}
          </span>
        </div>
      </header>

      {detail?.body && <pre className="repo-commit-body">{detail.body}</pre>}

      {error && <ErrorNotice message={error} onRetry={() => void loadCommitDetail(commit.sha)} />}
      {loading && !detail && <p className="repo-empty"><Loader2 size={13} className="is-spinning" /> Reading commit…</p>}

      {detail && (
        <ChangedFiles
          files={detail.files}
          additions={detail.additions}
          deletions={detail.deletions}
          truncated={detail.filesTruncated}
          merge={detail.merge}
          onShowFileHistory={(path) => void loadHistory({ ...scope, path })}
        />
      )}
    </div>
  )
}

/**
 * The changed-file explorer. Small commits stay a flat list; once a commit is large enough that
 * a flat list stops being scannable it gains a filter and folds into collapsible directory
 * groups, so a 100-file commit browses like repository structure instead of a spreadsheet.
 */
function ChangedFiles({ files, additions, deletions, truncated, merge, onShowFileHistory }: {
  files: RepositoryCommitFile[]
  additions: number
  deletions: number
  truncated: boolean
  merge: boolean
  onShowFileHistory: (path: string) => void
}) {
  const [query, setQuery] = useState('')
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({})

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? files.filter((file) => file.path.toLowerCase().includes(needle)) : files
  }, [files, query])
  const grouped = useMemo(
    () => (files.length >= GROUPING_THRESHOLD ? groupByDirectory(matched) : undefined),
    [files.length, matched],
  )
  const openByDefault = files.length <= COLLAPSE_THRESHOLD || query.trim().length > 0

  return (
    <section className="repo-commit-files">
      <div className="repo-commit-stat">
        <span className="repo-commit-stat-count">{files.length} file{files.length === 1 ? '' : 's'} changed</span>
        <span className="repo-commit-add">+{additions}</span>
        <span className="repo-commit-del">−{deletions}</span>
        {merge && <span className="repo-commit-label">against first parent</span>}
        {files.length >= GROUPING_THRESHOLD && (
          <label className="repo-commit-filter">
            <Search size={11} aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter files"
              aria-label="Filter changed files"
              spellCheck={false}
            />
          </label>
        )}
      </div>

      {truncated && <p className="repo-inline-warning">Only the first {files.length} files are listed for this commit.</p>}
      {files.length === 0 && <p className="repo-empty">This commit changes no files.</p>}
      {files.length > 0 && matched.length === 0 && <p className="repo-empty">No changed file matches this filter.</p>}

      {grouped
        ? grouped.map((group) => {
          const open = openDirs[group.dir] ?? openByDefault
          return (
            <div className="repo-file-dir" key={group.dir || '/'}>
              <button
                type="button"
                className="repo-file-dir-head"
                aria-expanded={open}
                onClick={() => setOpenDirs((current) => ({ ...current, [group.dir]: !open }))}
              >
                {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
                <span className="repo-file-dir-name">{group.dir || 'repository root'}</span>
                <span className="repo-count">{group.files.length}</span>
              </button>
              {open && (
                <ul className="repo-file-list">
                  {group.files.map((file) => (
                    <FileRow key={file.path} file={file} showDir={false} onShowFileHistory={onShowFileHistory} />
                  ))}
                </ul>
              )}
            </div>
          )
        })
        : (
          <ul className="repo-file-list">
            {matched.map((file) => (
              <FileRow key={file.path} file={file} showDir onShowFileHistory={onShowFileHistory} />
            ))}
          </ul>
        )}
    </section>
  )
}

function FileRow({ file, showDir, onShowFileHistory }: {
  file: RepositoryCommitFile
  showDir: boolean
  onShowFileHistory: (path: string) => void
}) {
  const { dir, name } = splitPath(file.path)
  return (
    <li>
      <span className={`repo-file-status status-${statusKey(file.status)}`} title={statusTitle(file.status)}>{file.status || '?'}</span>
      <span className="repo-file-name" title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}>
        {file.previousPath && <span className="repo-file-dir-part">{file.previousPath} → </span>}
        {showDir && dir && <span className="repo-file-dir-part">{dir}</span>}
        {name}
      </span>
      <LineCounts file={file} />
      <button
        type="button"
        className="repo-icon-btn"
        aria-label={`Show history for ${file.path}`}
        title="Show history for this file"
        onClick={() => onShowFileHistory(file.path)}
      >
        <FileDiff size={12} />
      </button>
    </li>
  )
}

function shortSha(sha: string): string {
  return sha.slice(0, 8)
}

/** Binary files carry no line count, so they read as "binary" instead of a misleading `+0 −0`. */
function LineCounts({ file }: { file: RepositoryCommitFile }) {
  if (file.binary || file.additions === null || file.deletions === null) {
    return <span className="repo-file-counts is-binary">binary</span>
  }
  return (
    <span className="repo-file-counts">
      <span className="repo-commit-add">+{file.additions}</span>{' '}
      <span className="repo-commit-del">−{file.deletions}</span>
    </span>
  )
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
