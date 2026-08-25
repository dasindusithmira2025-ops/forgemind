import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { Button } from '../components/ui/Button'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { asNativeError, native } from '../native/commands'
import { useAppStore } from '../stores/appStore'
import { MissionsPanel } from '../features/missions/MissionsPanel'

/**
 * Project-level route hosting Mission Control. Uses the same full-screen shell as the other
 * project-level tools (own titlebar + Back), reached from the sidebar.
 *
 * Project scope is verified here rather than assumed from the URL: a Mission creates Runs that
 * reach the filesystem and Git, so a route pointing at a Project that is not the open one must be
 * refused, not rendered.
 */
export function MissionsScreen() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const storedProject = useAppStore((state) => state.project)
  const [projectName, setProjectName] = useState(
    storedProject?.id === projectId ? storedProject.name : '',
  )
  const [error, setError] = useState('')
  const [activeProjectId, setActiveProjectId] = useState<string>()
  const [projectSessionChecked, setProjectSessionChecked] = useState(false)

  useEffect(() => {
    let live = true
    setProjectSessionChecked(false)
    void native
      .listOpenProjects()
      .then((sessions) => {
        if (!live) return
        setActiveProjectId(sessions.find((session) => session.isActive)?.projectId)
        setProjectSessionChecked(true)
      })
      .catch((caught) => {
        if (!live) return
        setError(asNativeError(caught).message)
        setProjectSessionChecked(true)
      })
    return () => {
      live = false
    }
  }, [projectId])

  useEffect(() => {
    if (!projectSessionChecked || activeProjectId !== projectId) return
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
  }, [activeProjectId, projectId, projectSessionChecked, storedProject])

  return (
    <main className="repo-shell missions-screen">
      <header className="settings-titlebar">
        <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => navigate(-1)}>
          Back
        </Button>
        <Brand compact />
        <h1>Missions</h1>
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
      ) : !projectSessionChecked ? (
        <div className="centered-error">
          <p>Loading Project context…</p>
        </div>
      ) : !activeProjectId ? (
        <div className="centered-error">
          <ErrorNotice message="Open a Project before creating or viewing Missions." />
          <Button onClick={() => navigate('/')}>Open a Project</Button>
        </div>
      ) : activeProjectId !== projectId ? (
        <div className="centered-error">
          <ErrorNotice message="These Missions do not belong to the selected Project." />
          <Button onClick={() => navigate(-1)}>Return to selected Project</Button>
        </div>
      ) : (
        <MissionsPanel projectId={projectId} />
      )}
    </main>
  )
}
