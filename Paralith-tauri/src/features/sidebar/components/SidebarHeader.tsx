import { Search } from 'lucide-react'
import { Brand } from '../../../components/ui/Brand'
import { useOrchestratorStore } from '../../orchestrator/store'

/**
 * The application band at the top of the sidebar: identity, and the one control that is not
 * scoped to a Workspace.
 *
 * Search is an icon rather than the field it used to be. The field advertised a text input that
 * accepted no text — every keystroke was forwarded to the Orchestrator panel — and it cost a full
 * control row directly above the Workspace list, which is the thing the sidebar exists to show.
 */
export function SidebarHeader() {
  const setOrchestratorOpen = useOrchestratorStore((state) => state.setOpen)

  return (
    <div className="sb-header">
      <Brand mono />
      <button
        type="button"
        className="sb-header-action"
        aria-label="Search — open the Orchestrator command panel"
        title="Search (Ctrl+Space)"
        onClick={() => setOrchestratorOpen(true)}
      >
        <Search size={15} />
      </button>
    </div>
  )
}
