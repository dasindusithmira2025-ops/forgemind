import { describe, expect, it } from 'vitest'
import { deriveActiveContext } from './activeContext'
import type { Project, TerminalSession, Workspace } from '../native/types'

const project: Project = { id: 'project', name: 'Demo', rootPath: 'C:\\demo', canonicalRootPath: 'c:\\demo', majorLanguages: [], isGitRepository: false, hasPackageJson: false, hasLockfile: false, createdAt: '', updatedAt: '', lastOpenedAt: '' }
const workspace: Workspace = { id: 'ws', projectId: 'project', name: 'Main', layout: { type: 'pane', paneId: 'p1' }, activePaneId: 'p1', panes: [{ id: 'p1', title: 'Claude', provider: 'claude', executablePath: 'c', args: [], workingDirectory: 'C:\\demo', positionOrder: 0 }], createdAt: '', updatedAt: '', lastOpenedAt: '' }
const running: TerminalSession = { id: 's-run', workspaceId: 'ws', paneId: 'p1', provider: 'claude', title: 'Claude', workingDirectory: 'C:\\demo', status: 'running', startedAt: '2026-01-02T00:00:00Z', outputTail: [], nextSequence: 0 }
const dead: TerminalSession = { ...running, id: 's-old', status: 'exited', startedAt: '2026-01-01T00:00:00Z' }

describe('active context selector', () => {
  it('derives a consistent project, workspace, pane, and live session', () => {
    const context = deriveActiveContext({ project, workspace, activePaneId: 'p1', sessions: { [dead.id]: dead, [running.id]: running } })
    expect(context.activeProject?.id).toBe('project')
    expect(context.activeWorkspace?.id).toBe('ws')
    expect(context.activePane?.id).toBe('p1')
    // The single live session wins over an older exited one on the same pane.
    expect(context.activeTerminalSession?.id).toBe('s-run')
  })

  it('reports no project or pane when no workspace is loaded', () => {
    const context = deriveActiveContext({ project, workspace: undefined, activePaneId: undefined, sessions: {} })
    expect(context.activeProject).toBeUndefined()
    expect(context.activeWorkspace).toBeUndefined()
    expect(context.activePane).toBeUndefined()
    expect(context.activeTerminalSession).toBeUndefined()
  })
})
