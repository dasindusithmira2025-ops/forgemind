import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { ErrorNotice } from '../../../components/ui/ErrorNotice'
import { useRepositoryStore } from '../../repository/repositoryStore'
import { ChangesSection } from '../../repository/components/ChangesSection'

/**
 * The right-panel Diff surface. It reuses the real Repository Changes view (staging, commit,
 * publish, per-file diff) rather than a second diff renderer — `repositoryStore` is a single
 * project-scoped store already shared with the full Repository Command Center, so staging a file
 * here and opening `/repository/:projectId` later shows the same state, not a divergent copy.
 *
 * Two things `ChangesSection` normally delegates to its parent Command Center don't fit a narrow
 * side panel — jumping to another repository section, and the full "create agent worktree" dialog
 * flow — so both route out to the full Repository screen instead of a second, thinner
 * implementation of either.
 */
export function DiffSurface({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const loadProject = useRepositoryStore((state) => state.loadProject)
  const activeProjectId = useRepositoryStore((state) => state.projectId)
  const load = useRepositoryStore((state) => state.load)

  useEffect(() => {
    void loadProject(projectId)
  }, [projectId, loadProject])

  const openFullRepository = () => navigate(`/repository/${projectId}`)

  if (activeProjectId !== projectId || load.status === 'loading') {
    return <div className="surface-status"><Loader2 size={16} className="spin" aria-hidden /><span>Loading repository…</span></div>
  }
  if (load.status === 'error') {
    return <div className="surface-status"><ErrorNotice message={load.errorMessage ?? 'Could not load the repository.'} onRetry={() => void loadProject(projectId)} /></div>
  }

  return (
    <div className="diff-surface">
      <ChangesSection onNavigate={openFullRepository} onRequestAgentWorktree={openFullRepository} />
    </div>
  )
}
