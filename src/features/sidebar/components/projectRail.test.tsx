import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarProjectRail } from './SidebarProjectRail'
import { useSidebarStore } from '../sidebarStore'
import type { SidebarActions, SidebarOpenProject } from '../sidebarTypes'
import type { Project } from '../../../native/types'

function project(id: string, name: string): Project {
  return {
    id,
    name,
    rootPath: `C:\\${name}`,
    canonicalRootPath: `c:\\${name}`,
    majorLanguages: [],
    isGitRepository: true,
    hasPackageJson: false,
    hasLockfile: false,
    gitBranch: 'main',
    createdAt: '',
    updatedAt: '',
    lastOpenedAt: '',
  }
}

function actions(overrides: Partial<SidebarActions> = {}): SidebarActions {
  return {
    onSelectWorkspace: vi.fn(),
    onOpenFresh: vi.fn(),
    onNewWorkspace: vi.fn(),
    onRenameWorkspace: vi.fn(),
    onReconfigureWorkspace: vi.fn(),
    onDuplicateWorkspace: vi.fn(),
    onRestartWorkspace: vi.fn(),
    onStopWorkspace: vi.fn(),
    onMoveWorkspace: vi.fn(),
    onReorder: vi.fn(),
    onRemoveRecent: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    onOpenProjectFolder: vi.fn(),
    onLocateFolder: vi.fn(),
    onRefreshProject: vi.fn(),
    onOpenLauncher: vi.fn(),
    onOpenSettings: vi.fn(),
    onToggleCollapse: vi.fn(),
    onResizeCommit: vi.fn(),
    ...overrides,
  }
}

const open: SidebarOpenProject[] = [
  { project: project('p1', 'Alpha'), isActive: true },
  { project: project('p2', 'Beta'), isActive: false, runtimeSummary: '2 terminals' },
]

function renderRail(props: Partial<Parameters<typeof SidebarProjectRail>[0]> = {}) {
  return render(
    <SidebarProjectRail openProjects={open} recents={[]} actions={actions()} {...props} />,
  )
}

describe('SidebarProjectRail', () => {
  beforeEach(() => useSidebarStore.setState({ projectSwitcherOpen: false }))

  it('shows the focused Project as identity and keeps background sessions glanceable', () => {
    renderRail()
    expect(screen.getByRole('button', { name: /Project Alpha/ })).toBeInTheDocument()
    // A background Project stays visible as its own single-line row, not hidden behind a menu.
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('2 terminals')).toBeInTheDocument()
    // …and the rail advertises how many others are open.
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('focuses a background Project without touching the others', () => {
    const onSelectProject = vi.fn()
    renderRail({ actions: actions({ onSelectProject }) })
    fireEvent.click(screen.getByRole('button', { name: 'Focus project Beta' }))
    expect(onSelectProject).toHaveBeenCalledWith('p2')
  })

  it('closes a background Project session from its own row', () => {
    const onCloseProject = vi.fn()
    renderRail({ actions: actions({ onCloseProject }) })
    fireEvent.click(screen.getByRole('button', { name: 'Close project Beta' }))
    expect(onCloseProject).toHaveBeenCalledWith('p2')
  })

  it('offers Locate only when the focused Project folder is unavailable', () => {
    renderRail()
    expect(screen.queryByRole('button', { name: 'Locate folder' })).not.toBeInTheDocument()

    // A background Project's missing folder is reported, but Locate targets the focused one only.
    renderRail({
      openProjects: [
        { project: project('p1', 'Alpha'), isActive: true, folderMissing: true },
        { project: project('p2', 'Beta'), isActive: false, folderMissing: true },
      ],
    })
    expect(screen.getAllByRole('button', { name: 'Locate folder' })).toHaveLength(1)
  })

  it('opens the one Project surface, which owns every remaining Project action', async () => {
    renderRail()
    fireEvent.click(screen.getByRole('button', { name: /Project Alpha/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Project' })

    // Both sessions are switchable here, the focused one is marked, and each can be closed.
    expect(screen.getByRole('button', { name: 'Close project Alpha' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('New Workspace')
    expect(dialog).toHaveTextContent('Reveal folder')
    expect(dialog).toHaveTextContent('Refresh metadata')
    expect(dialog).toHaveTextContent('Project launcher')
    expect(screen.getByRole('searchbox', { name: /Search recent Projects/i })).toBeInTheDocument()
  })

  it('closes the Project surface on Escape', async () => {
    renderRail()
    fireEvent.click(screen.getByRole('button', { name: /Project Alpha/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Project' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Project' })).not.toBeInTheDocument()
  })
})
