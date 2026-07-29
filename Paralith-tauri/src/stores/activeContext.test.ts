import { describe, expect, it } from 'vitest'
import { deriveActiveContext } from './activeContext'
import type { Project, Workspace } from '../native/types'

const project: Project = { id: 'project', name: 'Demo', rootPath: 'C:\\demo', canonicalRootPath: 'c:\\demo', majorLanguages: [], isGitRepository: false, hasPackageJson: false, hasLockfile: false, createdAt: '', updatedAt: '', lastOpenedAt: '' }
const workspace: Workspace = { id: 'ws', projectId: 'project', name: 'Main', normalizedName: 'main', restoreBehavior: 'inherit', layout: { type: 'pane', paneId: 'p1' }, activePaneId: 'p1', panes: [{ id: 'p1', title: 'Claude', provider: 'claude', executablePath: 'c', args: [], workingDirectory: 'C:\\demo', workingDirectoryMode: 'project_relative', positionOrder: 0 }], createdAt: '', updatedAt: '', lastOpenedAt: '' }

describe('active context selector', () => {
  it('derives Project, Workspace, and Pane only when ownership matches', () => {
    const context = deriveActiveContext({ project, workspace, activePaneId: 'p1' })
    expect(context.activeProject?.id).toBe('project')
    expect(context.activeWorkspace?.id).toBe('ws')
    expect(context.activePane?.id).toBe('p1')
  })

  it('rejects a stale Project selection from another Workspace', () => {
    const context = deriveActiveContext({ project: { ...project, id: 'other' }, workspace, activePaneId: 'p1' })
    expect(context.activeProject).toBeUndefined()
  })
})
