import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CurrentProjectsSection } from './CurrentProjectsSection'
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
  { project: project('p2', 'Beta'), isActive: false },
]

describe('CurrentProjectsSection', () => {
  it('lists every open project and marks the active one', () => {
    render(<CurrentProjectsSection openProjects={open} actions={actions()} />)
    expect(screen.getByText('Current Projects')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    const active = screen.getByRole('button', { name: /^Alpha/ })
    expect(active).toHaveAttribute('aria-current', 'true')
    const inactive = screen.getByRole('button', { name: /^Beta/ })
    expect(inactive).not.toHaveAttribute('aria-current')
  })

  it('focuses a project without touching the others', () => {
    const onSelectProject = vi.fn()
    render(<CurrentProjectsSection openProjects={open} actions={actions({ onSelectProject })} />)
    fireEvent.click(screen.getByRole('button', { name: /^Beta/ }))
    expect(onSelectProject).toHaveBeenCalledWith('p2')
  })

  it('closes a single project session', () => {
    const onCloseProject = vi.fn()
    render(<CurrentProjectsSection openProjects={open} actions={actions({ onCloseProject })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close project Beta' }))
    expect(onCloseProject).toHaveBeenCalledWith('p2')
  })

  it('offers Locate only for an active project with a missing folder', () => {
    const withMissing: SidebarOpenProject[] = [
      { project: project('p1', 'Alpha'), isActive: true, folderMissing: true },
      { project: project('p2', 'Beta'), isActive: false, folderMissing: true },
    ]
    render(<CurrentProjectsSection openProjects={withMissing} actions={actions()} />)
    // Exactly one Locate button — the active project's.
    expect(screen.getAllByRole('button', { name: 'Locate' })).toHaveLength(1)
  })
})
