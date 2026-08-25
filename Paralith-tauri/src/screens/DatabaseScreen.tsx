import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { Button } from '../components/ui/Button'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { asNativeError, native } from '../native/commands'
import { useAppStore } from '../stores/appStore'
import { DatabaseStudio } from '../features/database/components/DatabaseStudio'

/**
 * Project-level route hosting the Database Studio surface:
 * same full-screen titlebar + Back pattern, same project-name resolution from the active session
 * or a fresh `native.getProject` lookup, reached from within an active project.
 */
export function DatabaseScreen() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const storedProject = useAppStore((state) => state.project)
  const [projectName, setProjectName] = useState(storedProject?.id === projectId ? storedProject.name : '')
  const [error, setError] = useState('')

  useEffect(() => {
    if (storedProject?.id === projectId) { setProjectName(storedProject.name); return }
    let live = true
    void native.getProject(projectId)
      .then((project) => { if (live) setProjectName(project.name) })
      .catch((caught) => { if (live) setError(asNativeError(caught).message) })
    return () => { live = false }
  }, [projectId, storedProject])

  return (
    <main className="repo-shell">
      <header className="settings-titlebar">
        <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => navigate(-1)}>Back</Button>
        <Brand compact />
        <h1>Database</h1>
        <div className="titlebar-spacer" />
        <span className="repo-shell-project" title={projectName}>{projectName}</span>
      </header>
      {error
        ? <div className="centered-error"><ErrorNotice message={error} /><Button onClick={() => navigate('/')}>Return to launcher</Button></div>
        : projectId
          ? <DatabaseStudio projectId={projectId} />
          : <div className="centered-error"><ErrorNotice message="No project selected." /></div>}
    </main>
  )
}
