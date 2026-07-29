import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './appStore'
import type { Workspace } from '../native/types'

const workspace: Workspace = { id: 'workspace', projectId: 'project', name: 'Workspace', normalizedName: 'workspace', restoreBehavior: 'inherit', layout: { type: 'pane', paneId: 'pane' }, activePaneId: 'pane', panes: [{ id: 'pane', title: 'Codex', provider: 'codex', executablePath: 'codex.exe', args: [], workingDirectory: 'C:\\project', workingDirectoryMode: 'project_relative', positionOrder: 0 }], createdAt: '', updatedAt: '', lastOpenedAt: '' }

describe('application metadata store', () => {
  beforeEach(() => useAppStore.setState({ workspace: undefined, activePaneId: undefined }))

  it('hydrates active Pane identity from durable Workspace metadata', () => {
    useAppStore.getState().setWorkspace(workspace)
    expect(useAppStore.getState().activePaneId).toBe('pane')
  })

  it('does not own terminal output or Terminal Sessions', () => {
    expect(useAppStore.getState()).not.toHaveProperty('sessions')
    expect(useAppStore.getState()).not.toHaveProperty('upsertSession')
  })
})
