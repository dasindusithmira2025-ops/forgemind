import { useState } from 'react'
import { GitBranch, Loader2 } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { useRepositoryStore } from '../repositoryStore'

/**
 * The create-branch flow, promoted out of an inline text input into the shared Paralith dialog
 * system so it can be launched from the navigation rail or the branches surface. It dispatches the
 * typed `create_branch` operation from the current commit; the backend validates the ref name.
 */
export function CreateBranchDialog({ onClose }: { onClose: () => void }) {
  const snapshot = useRepositoryStore((state) => state.snapshot)
  const runOperation = useRepositoryStore((state) => state.runOperation)
  const pending = useRepositoryStore((state) => state.pending)
  const [name, setName] = useState('')
  const busy = Boolean(pending['create-branch'])

  const create = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    void runOperation({ kind: 'create_branch', name: trimmed, startPoint: snapshot?.headSha }, { key: 'create-branch' })
      .then((record) => { if (record.status === 'succeeded') onClose() })
      .catch(() => undefined)
  }

  return (
    <Modal title="Create branch" onClose={onClose}>
      <div className="repo-agent-dialog">
        <p className="repo-agent-purpose">Create a new branch from the current commit <code>{snapshot?.headSha.slice(0, 10) ?? '—'}</code>. Switching to it remains a separate action.</p>
        <label className="repo-field">
          <span>Branch name</span>
          <input value={name} data-autofocus spellCheck={false} placeholder="feature/short-description" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') create() }} />
        </label>
        <div className="repo-dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={busy ? <Loader2 size={14} className="is-spinning" /> : <GitBranch size={14} />} onClick={create} disabled={busy || !name.trim() || !snapshot}>
            {busy ? 'Creating…' : 'Create branch'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
