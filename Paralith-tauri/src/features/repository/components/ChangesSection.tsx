import { useMemo, useState } from 'react'
import {
  Bot, Check, FileCode2, GitCommitHorizontal, Loader2, Minus, Plus, Search, Trash2, Upload, User,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useRepositoryStore } from '../repositoryStore'
import { deriveSyncState, fileStatusGlyph, fileStatusLabel, filterFiles, groupFiles } from '../repositorySelectors'
import type { RepositoryFileStatus, RepositoryWorktreeLease } from '../../../native/types'
import type { FileGroup } from '../repositoryTypes'
import { DiffViewer, type DiffMode } from './DiffViewer'
import type { RepositorySectionId } from '../repositoryTypes'
import type { AgentActionRequest } from './AgentActionDialog'

interface Selection { path: string; staged: boolean }

export function ChangesSection({ onNavigate, onRequestAgentWorktree }: { onNavigate: (section: RepositorySectionId) => void; onRequestAgentWorktree: (request: AgentActionRequest) => void }) {
  const snapshot = useRepositoryStore((state) => state.snapshot)
  const leases = useRepositoryStore((state) => state.leases)
  const pullRequests = useRepositoryStore((state) => state.remoteViews.pullRequests)
  const pending = useRepositoryStore((state) => state.pending)
  const runOperation = useRepositoryStore((state) => state.runOperation)
  const [query, setQuery] = useState('')
  const [selection, setSelection] = useState<Selection>()
  const [diffMode, setDiffMode] = useState<DiffMode>('unified')
  const [commitMessage, setCommitMessage] = useState('')

  const ownership = useMemo(() => buildOwnership(leases), [leases])
  const groups = useMemo(() => {
    const filtered = filterFiles(snapshot?.files ?? [], query)
    return groupFiles(filtered)
  }, [snapshot, query])

  const stagedFiles = useMemo(() => (snapshot?.files ?? []).filter((file) => hasIndexChange(file)), [snapshot])
  const stagedCount = stagedFiles.length
  const totalCount = snapshot?.files.length ?? 0
  const conflicts = groups.find((group) => group.kind === 'conflicted')?.files.length ?? 0
  const sync = deriveSyncState(snapshot)

  const stage = (paths: string[], key: string) => void runOperation({ kind: 'stage_paths', paths }, { key }).catch(() => undefined)
  const unstage = (paths: string[], key: string) => void runOperation({ kind: 'unstage_paths', paths }, { key }).catch(() => undefined)
  const discard = (path: string) => {
    if (!window.confirm(`Discard changes to ${path}? This overwrites the working-tree copy and cannot be undone.`)) return
    void runOperation({ kind: 'restore_paths', paths: [path] }, { key: `discard:${path}` }).catch(() => undefined)
  }
  const stageAll = () => {
    const paths = (snapshot?.files ?? []).filter((file) => !file.conflicted && (hasWorktreeChange(file) || file.untracked)).map((file) => file.path)
    if (paths.length) stage(paths, 'stage-all')
  }
  const commit = () => {
    if (!commitMessage.trim() || stagedCount === 0) return
    void runOperation({ kind: 'commit_change_set', message: commitMessage.trim(), paths: stagedFiles.map((file) => file.path) }, { key: 'commit' })
      .then((record) => { if (record.status === 'succeeded') setCommitMessage('') })
      .catch(() => undefined)
  }
  const publish = () => {
    const remote = snapshot?.remotes[0] ?? 'origin'
    const branch = snapshot?.branch
    if (!branch) return
    const operation = sync === 'unpublished'
      ? { kind: 'publish_branch' as const, remote, branch }
      : { kind: 'push_branch' as const, remote, branch, forceWithLease: false }
    void runOperation(operation, { key: 'push' }).catch(() => undefined)
  }

  const committing = Boolean(pending['commit'])
  const pushing = Boolean(pending['push'])
  const canPush = Boolean(snapshot?.branch) && (sync === 'ahead' || sync === 'diverged' || sync === 'unpublished')

  if (totalCount === 0) {
    const branch = snapshot?.branch
    const branchPr = pullRequests.find((pr) => pr.headBranch === branch && (pr.state === 'open' || pr.state === 'draft'))
    const fetch = () => void runOperation({ kind: 'fetch_remote', remote: snapshot?.remotes[0] ?? 'origin', prune: true }, { key: 'clean-fetch' }).catch(() => undefined)
    const pull = () => branch && void runOperation({ kind: 'pull_branch', remote: snapshot?.remotes[0] ?? 'origin', branch, rebase: false }, { key: 'clean-pull' }).catch(() => undefined)
    const createPr = () => {
      if (!branch) return
      const base = window.prompt('Base branch for this pull request:', 'main')?.trim()
      if (!base) return
      const title = window.prompt('Pull request title:', branch)?.trim()
      if (!title) return
      void runOperation({ kind: 'open_draft_pull_request', base, head: branch, title, body: '' }, { key: 'create-pr' }).catch(() => undefined)
    }
    const createBranch = () => {
      const name = window.prompt('New branch name:')?.trim()
      if (!name) return
      void runOperation({ kind: 'create_branch', name, startPoint: snapshot?.headSha }, { key: 'create-branch' }).catch(() => undefined)
    }
    const agent = () => onRequestAgentWorktree({ title: 'Create agent worktree', purpose: 'Start isolated repository work from the current clean commit.', defaultBranch: `agent/${Date.now().toString(36)}`, fileScope: [], taskId: `task-${Date.now().toString(36)}`, requiresApproval: false, permission: 'Create a branch and isolated Git worktree' })
    return <div className="repo-clean-changes">
      <section><span>Working tree</span><strong>Clean</strong><small>No staged, unstaged or untracked files.</small></section>
      <section><span>Current branch</span><strong>{branch ?? 'Detached HEAD'}</strong><small>{snapshot?.headSha.slice(0, 12)} · {snapshot?.upstream ?? 'not published'}</small></section>
      <section><span>Synchronization</span><strong>{sync === 'clean' ? 'Up to date' : sync.replace('_', ' ')}</strong><small>{snapshot?.ahead ?? 0} outgoing · {snapshot?.behind ?? 0} incoming commit{snapshot?.behind === 1 ? '' : 's'}</small></section>
      {branchPr && <section><span>Pull request</span><strong>#{branchPr.number} {branchPr.title}</strong><small>{branchPr.state} · {branchPr.checksState.replace('_', ' ')}</small><Button variant="ghost" onClick={() => onNavigate('pull-requests')}>Open cockpit</Button></section>}
      <div className="repo-clean-actions"><Button variant="secondary" onClick={fetch} disabled={Boolean(pending['clean-fetch'])}>Fetch</Button>{(snapshot?.behind ?? 0) > 0 && <Button variant="secondary" onClick={pull} disabled={Boolean(pending['clean-pull'])}>Pull</Button>}{canPush && <Button variant="primary" onClick={publish}>Push {snapshot?.ahead} commit{snapshot?.ahead === 1 ? '' : 's'}</Button>}{branch && !branchPr && sync !== 'unpublished' && <Button variant="primary" onClick={createPr} disabled={Boolean(pending['create-pr'])}>Create PR</Button>}<Button variant="secondary" onClick={createBranch} disabled={Boolean(pending['create-branch'])}>Create branch</Button><Button variant="secondary" icon={<Bot size={14} />} onClick={agent}>Create agent worktree</Button></div>
    </div>
  }

  return (
    <div className="repo-changes">
      <div className="repo-changes-list" aria-label="Changed files">
        <div className="repo-list-toolbar">
          <div className="repo-search">
            <Search size={13} aria-hidden />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter files" aria-label="Filter changed files" />
          </div>
          <Button variant="ghost" onClick={stageAll} disabled={Boolean(pending['stage-all']) || totalCount === 0}>Stage all</Button>
        </div>

        {totalCount === 0 && <p className="repo-empty">No local changes. The working tree is clean.</p>}

        {groups.map((group) => group.files.length > 0 && (
          <FileGroupView
            key={group.kind}
            group={group}
            ownership={ownership}
            selection={selection}
            pending={pending}
            onSelect={(path, staged) => setSelection({ path, staged })}
            onStage={(path) => stage([path], `stage:${path}`)}
            onUnstage={(path) => unstage([path], `unstage:${path}`)}
            onDiscard={discard}
          />
        ))}
      </div>

      <div className="repo-changes-detail">
        <div className="repo-detail-toolbar">
          <div className="repo-detail-file">
            {selection ? <><FileCode2 size={14} /> <code title={selection.path}>{selection.path}</code>{selection.staged && <span className="repo-tag">staged</span>}</> : <span className="repo-muted">Select a file to view its diff</span>}
          </div>
          <div className="repo-segmented" role="tablist" aria-label="Diff mode">
            <button role="tab" aria-selected={diffMode === 'unified'} className={diffMode === 'unified' ? 'active' : ''} onClick={() => setDiffMode('unified')}>Unified</button>
            <button role="tab" aria-selected={diffMode === 'split'} className={diffMode === 'split' ? 'active' : ''} onClick={() => setDiffMode('split')}>Split</button>
          </div>
        </div>
        <div className="repo-detail-body">
          {selection
            ? <DiffViewer path={selection.path} staged={selection.staged} mode={diffMode} />
            : <div className="repo-diff-state">Pick a file on the left to inspect its changes.</div>}
        </div>

        <div className="repo-commit-box">
          {conflicts > 0 && <p className="repo-inline-warning">{conflicts} conflicted file{conflicts === 1 ? '' : 's'} must be resolved before committing.</p>}
          <textarea
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder={stagedCount ? `Commit message for ${stagedCount} staged file${stagedCount === 1 ? '' : 's'}` : 'Stage files to enable a commit'}
            aria-label="Commit message"
            rows={2}
          />
          <div className="repo-commit-actions">
            <span className="repo-muted">{stagedCount} staged · {totalCount} changed</span>
            <div className="repo-commit-buttons">
              <Button variant="secondary" icon={committing ? <Loader2 size={14} className="is-spinning" /> : <GitCommitHorizontal size={14} />} onClick={commit} disabled={committing || stagedCount === 0 || !commitMessage.trim() || conflicts > 0}>
                {committing ? 'Committing' : 'Commit'}
              </Button>
              <Button variant="primary" icon={pushing ? <Loader2 size={14} className="is-spinning" /> : <Upload size={14} />} onClick={publish} disabled={pushing || !canPush}>
                {pushing ? 'Pushing' : sync === 'unpublished' ? 'Publish' : 'Push'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FileGroupView({ group, ownership, selection, pending, onSelect, onStage, onUnstage, onDiscard }: {
  group: FileGroup
  ownership: Map<string, RepositoryWorktreeLease>
  selection: Selection | undefined
  pending: Record<string, boolean>
  onSelect: (path: string, staged: boolean) => void
  onStage: (path: string) => void
  onUnstage: (path: string) => void
  onDiscard: (path: string) => void
}) {
  const staged = group.kind === 'staged'
  return (
    <div className={`repo-file-group group-${group.kind}`}>
      <div className="repo-file-group-head">
        <span className="repo-file-group-title">{group.label}</span>
        <span className="repo-count">{group.files.length}</span>
      </div>
      <ul>
        {group.files.map((file) => {
          const owner = ownership.get(file.path)
          const busyKey = staged ? `unstage:${file.path}` : `stage:${file.path}`
          const active = selection?.path === file.path && selection.staged === staged
          return (
            <li key={`${group.kind}:${file.path}`} className={active ? 'active' : ''}>
              <button className="repo-file-main" onClick={() => onSelect(file.path, staged)} title={file.path} aria-current={active ? 'true' : undefined}>
                <span className={`repo-file-glyph glyph-${group.kind}`} aria-hidden>{fileStatusGlyph(file)}</span>
                <span className="repo-file-path">{file.renamed && file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}</span>
                <span className="repo-file-tags">
                  {owner && <span className="repo-owner repo-owner-agent" title={`Agent ${owner.agentId} · task ${owner.taskId}`}><Bot size={11} />{owner.agentId}</span>}
                  {!owner && <span className="repo-owner repo-owner-human" title="Local (human) change"><User size={11} />you</span>}
                  <span className="repo-status-word">{fileStatusLabel(file)}</span>
                </span>
              </button>
              <span className="repo-file-controls">
                {staged
                  ? <button className="repo-icon-btn" title="Unstage" aria-label={`Unstage ${file.path}`} disabled={Boolean(pending[busyKey])} onClick={() => onUnstage(file.path)}><Minus size={13} /></button>
                  : <button className="repo-icon-btn" title="Stage" aria-label={`Stage ${file.path}`} disabled={Boolean(pending[busyKey])} onClick={() => onStage(file.path)}><Plus size={13} /></button>}
                {!staged && group.kind !== 'conflicted' && <button className="repo-icon-btn danger" title="Discard changes" aria-label={`Discard ${file.path}`} disabled={Boolean(pending[`discard:${file.path}`])} onClick={() => onDiscard(file.path)}><Trash2 size={13} /></button>}
                {group.kind === 'conflicted' && <button className="repo-icon-btn" title="Mark resolved (stage)" aria-label={`Mark ${file.path} resolved`} onClick={() => onStage(file.path)}><Check size={13} /></button>}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function hasIndexChange(file: RepositoryFileStatus): boolean {
  return !file.conflicted && file.indexStatus.trim().length > 0 && file.indexStatus !== '.' && file.indexStatus !== ' '
}
function hasWorktreeChange(file: RepositoryFileStatus): boolean {
  return file.worktreeStatus.trim().length > 0 && file.worktreeStatus !== '.' && file.worktreeStatus !== ' '
}

/** Map each file to the agent worktree lease that scopes it, so ownership is real, not guessed. */
function buildOwnership(leases: RepositoryWorktreeLease[]): Map<string, RepositoryWorktreeLease> {
  const map = new Map<string, RepositoryWorktreeLease>()
  for (const lease of leases) {
    if (lease.status === 'released') continue
    for (const path of lease.fileScope) map.set(path, lease)
  }
  return map
}
