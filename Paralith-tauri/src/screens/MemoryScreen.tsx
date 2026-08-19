import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { Button } from '../components/ui/Button'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { asNativeError, native } from '../native/commands'
import { useAppStore } from '../stores/appStore'
import { MemoryWorkspace } from '../features/memory/components/MemoryWorkspace'

/**
 * Project-level route hosting the Context Fabric. Mirrors `DatabaseScreen` and `RepositoryScreen`
 * exactly: the same full-screen titlebar and Back pattern, and the same project-name resolution
 * from the active session or a fresh lookup.
 */
export function MemoryScreen() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const storedProject = useAppStore((state) => state.project)
  const [projectName, setProjectName] = useState(
    storedProject?.id === projectId ? storedProject.name : '',
  )
  const [error, setError] = useState('')

  useEffect(() => {
    if (storedProject?.id === projectId) {
      setProjectName(storedProject.name)
      return
    }
    let live = true
    void native
      .getProject(projectId)
      .then((project) => {
        if (live) setProjectName(project.name)
      })
      .catch((caught) => {
        if (live) setError(asNativeError(caught).message)
      })
    return () => {
      live = false
    }
  }, [projectId, storedProject])

  return (
    <main className="repo-shell">
      <header className="settings-titlebar">
        <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => navigate(-1)}>
          Back
        </Button>
        <Brand compact />
        <h1>Memory</h1>
        <div className="titlebar-spacer" />
        <span className="repo-shell-project" title={projectName}>
          {projectName}
        </span>
      </header>
      {error ? (
        <div className="centered-error">
          <ErrorNotice message={error} />
          <Button onClick={() => navigate('/')}>Return to launcher</Button>
        </div>
      ) : projectId ? (
        <MemoryWorkspace projectId={projectId} />
      ) : (
        <div className="centered-error">
          <ErrorNotice message="No project selected." />
        </div>
      )}
    </main>
  )
}
