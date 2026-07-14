import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectOverview } from '../../../native/types'
import type { MissionBundle, SaveMissionRequest } from '../missionTypes'
import { MissionComposer } from './MissionCreationDialog'

const overview = {
  project: { id: 'project-ui', name: 'Composer Project' },
  workspaces: [{ id: 'workspace-ui', projectId: 'project-ui', name: 'Main Workspace' }],
  folderMissing: false,
} as unknown as ProjectOverview

function result(request: SaveMissionRequest): MissionBundle {
  const now = new Date().toISOString()
  return {
    mission: { id: request.id as string, projectId: request.projectId, originWorkspaceId: request.originWorkspaceId, title: request.title, objective: request.objective, constraints: request.constraints, referencePaths: request.referencePaths, preferredAgentIds: request.preferredAgentIds, status: request.status ?? 'draft', executionMode: request.executionMode, riskLevel: request.riskLevel, permissionProfile: request.permissionProfile, verificationProfileId: request.verificationProfileId, createdAt: now, updatedAt: now },
    acceptanceCriteria: request.acceptanceCriteria.map((criterion) => ({ id: criterion.id as string, missionId: request.id as string, description: criterion.description, required: criterion.required, status: 'pending', evidenceIds: [] })),
    tasks: [], worktrees: [], sessions: [], events: [], verificationResults: [], evidence: [], auditEvents: [], recovery: [],
  }
}

function fillForm() {
  fireEvent.change(screen.getByLabelText('Mission title'), { target: { value: 'Latest title' } })
  fireEvent.change(screen.getByLabelText('Objective'), { target: { value: 'Latest objective' } })
  fireEvent.change(screen.getByPlaceholderText('A specific, verifiable outcome'), { target: { value: 'Latest criterion' } })
}

beforeEach(() => localStorage.clear())

describe('Mission Composer save recovery', () => {
  it('restores the complete canonical Draft into every form section', () => {
    const request: SaveMissionRequest = {
      id: 'draft-restored', projectId: 'project-ui', originWorkspaceId: 'workspace-ui', title: 'Restored title', objective: 'Restored objective',
      constraints: ['Keep routing', 'Preserve data'], referencePaths: ['src/routes.tsx', 'docs/mission.md'], preferredAgentIds: ['agent-ui'], status: 'draft',
      executionMode: 'manual-plan', riskLevel: 'high', permissionProfile: 'read-only', verificationProfileId: 'profile-ui',
      acceptanceCriteria: [{ id: 'criterion-ui', description: 'Every field is restored', required: false }],
    }
    render(<MissionComposer overview={overview} agents={[{ id:'agent-ui', name:'Codex', provider:'codex', available:true } as never]} profiles={[{ id:'profile-ui', projectId:'project-ui', name:'Release checks', checks:[], approved:true, createdAt:'t', updatedAt:'t' }]} initialDraft={result(request)} onSaveDraft={async(value)=>result(value)} onCreatePlan={async(value)=>result(value)} onCancel={()=>undefined}/>)
    expect(screen.getByLabelText('Mission title')).toHaveValue('Restored title')
    expect(screen.getByLabelText('Objective')).toHaveValue('Restored objective')
    expect(screen.getByPlaceholderText('A specific, verifiable outcome')).toHaveValue('Every field is restored')
    expect(screen.getByLabelText('Execution mode')).toHaveValue('manual-plan')
    expect(screen.getByLabelText('Permission profile')).toHaveValue('read-only')
    expect(screen.getByLabelText('Risk')).toHaveValue('high')
    expect(screen.getByRole('checkbox', { name: /Codex/ })).toBeChecked()
    expect(screen.getByLabelText('Verification profile')).toHaveValue('profile-ui')
    expect(screen.getByLabelText(/Constraints/)).toHaveValue('Keep routing\nPreserve data')
    expect(screen.getByLabelText(/Reference paths/)).toHaveValue('src/routes.tsx\ndocs/mission.md')
    expect(screen.getByLabelText(/Origin Workspace/)).toHaveValue('workspace-ui')
  })

  it('keeps every field after a canonical failure and Retry saves the same Draft ID', async () => {
    const save = vi.fn().mockRejectedValueOnce({ code: 'database_error', message: 'The local database is locked.', detail: 'SQLITE_BUSY', sourceLayer: 'persistence' }).mockImplementation(async (request: SaveMissionRequest) => result(request))
    render(<MissionComposer overview={overview} agents={[]} profiles={[]} originWorkspaceId="workspace-ui" onSaveDraft={save} onCreatePlan={async(request)=>result(request)} onCancel={()=>undefined}/>)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    expect(await screen.findByText('The local database is locked.')).toBeInTheDocument()
    expect(screen.getByLabelText('Mission title')).toHaveValue('Latest title')
    expect(screen.getByLabelText('Objective')).toHaveValue('Latest objective')
    expect(screen.getByPlaceholderText('A specific, verifiable outcome')).toHaveValue('Latest criterion')
    const firstId = save.mock.calls[0][0].id
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('Draft saved')).toBeInTheDocument())
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0].id).toBe(firstId)
    expect(save.mock.calls[1][0].title).toBe('Latest title')
  })

  it('reports canonical success when only the browser recovery copy fails', async () => {
    const storageFailure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('recovery unavailable') })
    const save = vi.fn(async (request: SaveMissionRequest) => result(request))
    render(<MissionComposer overview={overview} agents={[]} profiles={[]} onSaveDraft={save} onCreatePlan={async(request)=>result(request)} onCancel={()=>undefined}/>)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    expect(await screen.findByText('Draft saved to SQLite.')).toBeInTheDocument()
    expect(screen.getByText('The optional browser recovery copy could not be updated.')).toBeInTheDocument()
    storageFailure.mockRestore()
  })
})
