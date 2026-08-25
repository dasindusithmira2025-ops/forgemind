import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { Button } from '../components/ui/Button'
import { UsagePage } from '../features/usage/components/UsagePage'

/**
 * Application-level route for Usage analytics. Unlike Database this is not
 * project-scoped: provider token consumption is observed per machine, not per repository, so
 * scoping it to a project would report a number that is true of neither.
 */
export function UsageScreen() {
  const navigate = useNavigate()
  return (
    <main className="repo-shell">
      <header className="settings-titlebar">
        <Button variant="ghost" icon={<ArrowLeft size={15} />} onClick={() => navigate(-1)}>Back</Button>
        <Brand compact />
        <h1>Usage</h1>
        <div className="titlebar-spacer" />
      </header>
      <UsagePage />
    </main>
  )
}
