import { describe, expect, it } from 'vitest'
import type { Project, TerminalSession, Workspace, WorkspacePlacement } from '../../native/types'
import type { PaneAgentState } from './sidebarAgentStatus'
import {
  applyFrozenOrder,
  buildSidebarPresentation,
  computeAttentionOrder,
  deriveSidebarWorkspace,
  MIN_ROWS_FOR_FILTER,
  presentWorkspaces,
} from './sidebarModel'
import type { SidebarProjectGroup, SidebarWorkspace, WorkspaceRuntimeStatus } from './sidebarTypes'

function project(id: string, name = id): Project {
  return {
    id,
    name,
    rootPath: `C:\\${id}`,
    canonicalRootPath: `c:\\${id}`,
    majorLanguages: [],
    isGitRepository: true,
    hasPackageJson: false,
    hasLockfile: false,
    createdAt: '',
    updatedAt: '',
    lastOpenedAt: '',
  }
}

function workspace(id: string, projectId = 'p', lastOpenedAt = '2026-01-01T00:00:00Z'): Workspace {
  return {
    id,
    projectId,
    name: id,
    normalizedName: id,
    restoreBehavior: 'inherit',
    layout: { type: 'pane', paneId: `${id}-pane` },
    activePaneId: `${id}-pane`,
    panes: [
      {
        id: `${id}-pane`,
        workspaceId: id,
        title: 'Claude',
        provider: 'claude',
        executablePath: 'x',
        args: [],
        workingDirectory: 'd',
        workingDirectoryMode: 'project_relative',
        positionOrder: 0,
      },
    ],
    createdAt: '',
    updatedAt: '',
    lastOpenedAt,
  }
}

function row(id: string, status: WorkspaceRuntimeStatus, projectId = 'p', lastOpenedAt?: string): SidebarWorkspace {
  return {
    workspace: workspace(id, projectId, lastOpenedAt),
    runtime: {
      workspaceId: id,
      configuredPaneCount: 1,
      startingCount: 0,
      runningCount: status === 'active' ? 1 : 0,
      waitingCount: status === 'waiting' ? 1 : 0,
      exitedCount: 0,
      failedCount: 0,
      disconnectedCount: 0,
      deferredCount: 0,
      activeProviders: [],
      status,
      requiresAttention: status === 'waiting' || status === 'attention',
      updatedAt: 'now',
    },
    providers: { labels: ['Claude'], visible: ['Claude'], overflow: 0, text: 'Claude' },
  }
}

function group(projectId: string, rows: SidebarWorkspace[], isActive = true): SidebarProjectGroup {
  return { project: project(projectId), isActive, folderMissing: false, workspaces: rows }
}

function detached(workspaceId: string): WorkspacePlacement {
  return { workspaceId, mode: 'detached' } as WorkspacePlacement
}

const NO_PLACEMENTS: WorkspacePlacement[] = []

describe('presentWorkspaces', () => {
  const rows = [row('alpha', 'closed'), row('beta', 'waiting'), row('gamma', 'active')]

  it('matches on Workspace name and on provider text', () => {
    expect(presentWorkspaces(rows, 'bet', 'manual').map((entry) => entry.workspace.id)).toEqual(['beta'])
    expect(presentWorkspaces(rows, 'claude', 'manual')).toHaveLength(3)
  })

  it('leaves manual order untouched', () => {
    // The persisted drag order is the user's own answer to what matters; re-sorting it would make
    // the drag handle look broken.
    expect(presentWorkspaces(rows, '', 'manual').map((entry) => entry.workspace.id)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ])
  })

  it('puts the Workspaces that need a human first in the attention order', () => {
    expect(presentWorkspaces(rows, '', 'attention').map((entry) => entry.workspace.id)).toEqual([
      'beta',
      'gamma',
      'alpha',
    ])
  })

  it('honours a frozen order instead of re-sorting', () => {
    const frozen = ['gamma', 'alpha', 'beta']
    expect(presentWorkspaces(rows, '', 'attention', frozen).map((entry) => entry.workspace.id)).toEqual(frozen)
  })
})

describe('applyFrozenOrder', () => {
  it('appends Workspaces created since the order was frozen', () => {
    const rows = [row('alpha', 'closed'), row('new', 'closed'), row('beta', 'closed')]
    expect(applyFrozenOrder(rows, ['beta', 'alpha']).map((entry) => entry.workspace.id)).toEqual([
      'beta',
      'alpha',
      'new',
    ])
  })

  it('is a no-op with nothing frozen', () => {
    const rows = [row('alpha', 'closed')]
    expect(applyFrozenOrder(rows, [])).toBe(rows)
  })
})

describe('computeAttentionOrder', () => {
  it('spans every group in one flat order', () => {
    const groups = [
      group('p1', [row('idle', 'closed', 'p1')]),
      group('p2', [row('blocked', 'waiting', 'p2')], false),
    ]
    expect(computeAttentionOrder(groups)).toEqual(['blocked', 'idle'])
  })
})

describe('buildSidebarPresentation', () => {
  const base = {
    groupBy: 'project' as const,
    sortMode: 'manual' as const,
    filterQuery: '',
    placements: NO_PLACEMENTS,
  }

  it('splits detached Workspaces out of the primary list', () => {
    // Leaving them in both would double-count every header and offer a reorder that writes to the
    // wrong list.
    const presentation = buildSidebarPresentation({
      ...base,
      groups: [group('p', [row('here', 'active'), row('elsewhere', 'active')])],
      placements: [detached('elsewhere')],
    })
    expect(presentation.groups[0].workspaces.map((entry) => entry.workspace.id)).toEqual(['here'])
    expect(presentation.detached.map((entry) => entry.workspace.id)).toEqual(['elsewhere'])
  })

  it('hides a group whose every row was filtered out, and says so once', () => {
    const presentation = buildSidebarPresentation({
      ...base,
      filterQuery: 'nothing-matches-this',
      groups: [group('p', [row('alpha', 'closed')])],
    })
    expect(presentation.groups[0].hidden).toBe(true)
    expect(presentation.anyMatch).toBe(false)
  })

  it('counts every list once in the filter total', () => {
    // One match from each of the three lists the field filters, and nothing counted twice — the
    // detached row must not also be counted inside the group it came from.
    const presentation = buildSidebarPresentation({
      ...base,
      filterQuery: 'keep',
      groups: [
        group('p', [row('keep-listed', 'closed'), row('keep-detached', 'closed'), row('drop-me', 'closed')]),
      ],
      placements: [detached('keep-detached')],
      swarmNames: ['keep-swarm', 'other-swarm'],
    })
    expect(presentation.matchCount).toBe(3)
    expect(presentation.groups[0].visibleCount).toBe(1)
    expect(presentation.visibleDetached).toHaveLength(1)
  })

  it('offers the filter field only once there is enough to filter', () => {
    const few = buildSidebarPresentation({ ...base, groups: [group('p', [row('a', 'closed')])] })
    expect(few.showFilter).toBe(false)
    const many = buildSidebarPresentation({
      ...base,
      groups: [group('p', Array.from({ length: MIN_ROWS_FOR_FILTER }, (_, i) => row(`w${i}`, 'closed')))],
    })
    expect(many.showFilter).toBe(true)
  })

  it('allows reordering only in the active Project, in manual order, with no filter', () => {
    const groups = [group('p1', [row('a', 'closed', 'p1')]), group('p2', [row('b', 'closed', 'p2')], false)]
    expect(buildSidebarPresentation({ ...base, groups }).groups.map((entry) => entry.reorderable)).toEqual([
      true,
      false,
    ])
    expect(
      buildSidebarPresentation({ ...base, groups, sortMode: 'attention' }).groups[0].reorderable,
    ).toBe(false)
    expect(buildSidebarPresentation({ ...base, groups, filterQuery: 'a' }).groups[0].reorderable).toBe(false)
    // The flat list mixes Projects, so a drop index has no single persisted order to write back to.
    expect(buildSidebarPresentation({ ...base, groups, groupBy: 'flat' }).flat.reorderable).toBe(false)
  })

  it('gives the flat list every Project row and the names to label them with', () => {
    const groups = [group('p1', [row('a', 'closed', 'p1')]), group('p2', [row('b', 'closed', 'p2')], false)]
    const presentation = buildSidebarPresentation({ ...base, groups, groupBy: 'flat' })
    expect(presentation.flat.workspaces.map((entry) => entry.workspace.id)).toEqual(['a', 'b'])
    expect(presentation.projectNameById.get('p2')).toBe('p2')
  })

  it('reorders against the unfiltered source, never the presented subset', () => {
    const rows = [row('a', 'closed'), row('b', 'closed'), row('c', 'closed')]
    const presentation = buildSidebarPresentation({ ...base, groups: [group('p', rows)], filterQuery: 'b' })
    expect(presentation.groups[0].workspaces).toHaveLength(1)
    expect(presentation.groups[0].orderSource.map((entry) => entry.workspace.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('deriveSidebarWorkspace', () => {
  function session(paneId: string, workspaceId: string): TerminalSession {
    return {
      id: `s-${paneId}`,
      projectId: 'p',
      workspaceId,
      paneId,
      provider: 'claude',
      executable: 'x',
      arguments: [],
      title: 't',
      workingDirectory: 'd',
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
      outputTail: [],
      nextSequence: 0,
      restorationState: 'restored',
      droppedOutputBytes: 0,
    }
  }

  it('derives a background Project row from the same inputs as the active one', () => {
    // One derivation for every Project. Two — a live one for the focused Project and a snapshot
    // for the rest — is exactly how the sidebar came to disagree with itself.
    const target = workspace('w')
    const blocked: PaneAgentState[] = [{ paneId: 'w-pane', attention: 'needs_you' }]
    const derived = deriveSidebarWorkspace(
      target,
      {
        sessionsByWorkspace: new Map([['w', [session('w-pane', 'w')]]]),
        paneAgentStatesByWorkspace: new Map([['w', blocked]]),
      },
      [],
    )
    expect(derived.runtime.waitingCount).toBe(1)
    expect(derived.runtime.status).toBe('waiting')
    expect(derived.providers.text).toBe('Claude')
  })

  it('reports a Workspace with no Sessions as closed', () => {
    const derived = deriveSidebarWorkspace(
      workspace('w'),
      { sessionsByWorkspace: new Map(), paneAgentStatesByWorkspace: new Map() },
      [],
    )
    expect(derived.runtime.status).toBe('closed')
  })
})
