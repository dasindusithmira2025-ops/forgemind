import { useEffect, useMemo, useState } from 'react'
import { GitBranch, Loader2, Search, X } from 'lucide-react'
import { asNativeError, native } from '../../native/commands'
import type { RepositoryBranchSummary } from '../../native/types'

type Props = {
  projectId: string
  projectRootPath: string
  currentBranch?: string
  workingDirectory: string
  onAssign: (branch: string) => Promise<void>
  onClose: () => void
}

export function PaneBranchDialog({ projectId, projectRootPath, currentBranch, workingDirectory, onAssign, onClose }: Props) {
  const [branches, setBranches] = useState<RepositoryBranchSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [assigning, setAssigning] = useState<string>()
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    setLoading(true)
    void native.listRepositoryBranches(projectId).then((items) => {
      if (!current) return
      setBranches(items)
      setError('')
    }).catch((caught) => {
      if (current) setError(asNativeError(caught).message)
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [projectId])

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return branches.filter((branch) => !needle || branch.name.toLocaleLowerCase().includes(needle))
  }, [branches, query])

  const assign = async (branch: RepositoryBranchSummary) => {
    setAssigning(branch.name)
    setError('')
    try {
      await onAssign(branch.name)
      onClose()
    } catch (caught) {
      setError(asNativeError(caught).message)
    } finally {
      setAssigning(undefined)
    }
  }

  return <div className="repo-modal-backdrop" role="presentation" onMouseDown={() => { if (!assigning) onClose() }}>
    <section className="pane-branch-dialog" role="dialog" aria-modal="true" aria-labelledby="pane-branch-title" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div><strong id="pane-branch-title">Change terminal branch</strong><span>Only this terminal moves. Other terminals and the shared Project checkout stay in place.</span></div>
        <button className="repo-icon-btn" aria-label="Close branch picker" disabled={Boolean(assigning)} onClick={onClose}><X size={15} /></button>
      </header>
      <label className="pane-branch-search"><Search size={14} aria-hidden /><input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter local and GitHub branches" aria-label="Filter terminal branches" /></label>
      {error && <div className="pane-branch-error" role="alert">{error}</div>}
      <div className="pane-branch-list" aria-busy={loading}>
        {loading && <div className="pane-branch-state"><Loader2 className="is-spinning" size={15} />Loading branches…</div>}
        {!loading && visible.length === 0 && <div className="pane-branch-state">No branch matches this filter.</div>}
        {visible.map((branch) => {
          const localName = branch.kind === 'remote' ? branch.name.split('/').slice(1).join('/') : branch.name
          const local = branch.kind === 'local' ? branch : branches.find((item) => item.kind === 'local' && item.name === localName)
          const checkout = local?.checkedOutPath
          const current = localName === currentBranch
          const shared = Boolean(checkout) && pathContains(checkout!, projectRootPath)
          const occupied = Boolean(checkout) && !current && !shared && !pathContains(checkout!, workingDirectory)
          const disabled = Boolean(assigning) || current || occupied
          const detail = current
            ? 'Current terminal branch'
            : occupied
              ? `Checked out in ${checkout}`
              : shared
                ? 'Shared Project branch · returns this terminal to the Project checkout'
              : branch.kind === 'remote'
                ? 'Remote branch · creates or reuses its local tracking branch'
                : branch.latestSubject || 'Local branch'
          return <button key={branch.fullRef} type="button" className="pane-branch-row" disabled={disabled} onClick={() => void assign(branch)}>
            <GitBranch size={14} aria-hidden />
            <span><strong>{branch.name}</strong><small>{detail}</small></span>
            <em>{assigning === branch.name ? <Loader2 className="is-spinning" size={14} /> : branch.kind}</em>
          </button>
        })}
      </div>
      <footer>Changing branch stops and restarts this terminal in a PARALITH-managed worktree. Uncommitted worktrees are preserved and refused.</footer>
    </section>
  </div>
}

function pathContains(root: string, candidate: string): boolean {
  const normalize = (value: string) => value.replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase()
  const normalizedRoot = normalize(root)
  const normalizedCandidate = normalize(candidate)
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
}
