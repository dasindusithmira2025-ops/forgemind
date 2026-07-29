import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MonitorInfo, OpenProjectSession, WorkspacePlacement } from '../../native/types'
import {
  activeProjectId,
  monitorForPlacement,
  monitorLabel,
  partitionPlacements,
  placementForWorkspace,
} from './placementSelectors'
import { resolveWindowAction } from './windowIntent'
import { buildRecoveryNotice } from './recoverySelectors'
import type { MonitorRecoveryReport } from '../../native/types'

function placement(id: string, mode: WorkspacePlacement['mode']): WorkspacePlacement {
  return { workspaceId: id, mode, maximized: false, fullscreen: false, placementRevision: 0 }
}

function session(projectId: string, isActive: boolean): OpenProjectSession {
  return { projectId, isActive, expanded: true, openedAt: 't', updatedAt: 't' }
}

describe('placement selectors', () => {
  it('finds the single active project', () => {
    expect(activeProjectId([session('p1', false), session('p2', true)])).toBe('p2')
    expect(activeProjectId([session('p1', false)])).toBeUndefined()
  })

  it('partitions placements into this-window vs other-monitors', () => {
    const { attached, detached } = partitionPlacements([
      placement('w1', 'attached'),
      placement('w2', 'detached'),
      placement('w3', 'attached'),
    ])
    expect(attached.map((p) => p.workspaceId)).toEqual(['w1', 'w3'])
    expect(detached.map((p) => p.workspaceId)).toEqual(['w2'])
  })

  it('resolves a workspace placement and its monitor', () => {
    const monitors: MonitorInfo[] = [
      {
        id: 'mon-2',
        name: 'DELL',
        alias: 'Right',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1,
        isPrimary: false,
        windowCount: 1,
      },
    ]
    const detached = { ...placement('w2', 'detached'), monitorId: 'mon-2' }
    expect(placementForWorkspace([detached], 'w2')).toBe(detached)
    expect(monitorLabel(monitors[0])).toBe('Right')
    expect(monitorForPlacement(detached, monitors)?.name).toBe('DELL')
  })
})

describe('window intent resolver', () => {
  it('detaches an attached workspace but focuses an already-detached one (no duplicate)', () => {
    expect(resolveWindowAction(placement('w1', 'attached'), 'open-in-new-window')).toEqual({ kind: 'detach' })
    expect(resolveWindowAction(placement('w1', 'detached'), 'open-in-new-window')).toEqual({ kind: 'focus' })
  })

  it('attach/focus/move/close are no-ops on an attached workspace', () => {
    for (const intent of ['attach-to-main', 'focus-window', 'move-to-monitor', 'close-window'] as const) {
      expect(resolveWindowAction(placement('w1', 'attached'), intent).kind).toBe('noop')
    }
  })

  it('acts on a detached workspace for attach/focus/move/close', () => {
    expect(resolveWindowAction(placement('w1', 'detached'), 'attach-to-main')).toEqual({ kind: 'attach' })
    expect(resolveWindowAction(placement('w1', 'detached'), 'focus-window')).toEqual({ kind: 'focus' })
    expect(resolveWindowAction(placement('w1', 'detached'), 'close-window')).toEqual({ kind: 'close' })
    expect(resolveWindowAction(placement('w1', 'detached'), 'move-to-monitor')).toEqual({ kind: 'move' })
  })
})

describe('monitor recovery notice', () => {
  it('summarizes rescued windows and passes through reconnect offers', () => {
    const report: MonitorRecoveryReport = {
      recovered: [
        { workspaceId: 'w1', windowLabel: 'ws-w1', geometry: { x: 0, y: 0, width: 800, height: 600 } },
        { workspaceId: 'w2', windowLabel: 'ws-w2', geometry: { x: 0, y: 0, width: 800, height: 600 } },
      ],
      reconnectable: [{ workspaceId: 'w3', monitorId: 'right@2000,0', monitorAlias: 'Right' }],
    }
    const notice = buildRecoveryNotice(report)
    expect(notice.recoveredMessage).toContain('2 workspace windows')
    expect(notice.offers).toHaveLength(1)
    expect(notice.offers[0].workspaceId).toBe('w3')
  })

  it('has no message when nothing was recovered', () => {
    expect(buildRecoveryNotice({ recovered: [], reconnectable: [] }).recoveredMessage).toBeUndefined()
  })

  it('uses singular phrasing for a single rescued window', () => {
    const notice = buildRecoveryNotice({
      recovered: [{ workspaceId: 'w1', windowLabel: 'ws-w1', geometry: { x: 0, y: 0, width: 800, height: 600 } }],
      reconnectable: [],
    })
    expect(notice.recoveredMessage).toContain('1 workspace window ')
  })
})

describe('handoff controller in-flight guard', () => {
  afterEach(() => vi.restoreAllMocks())

  it('rejects a concurrent handoff of the same workspace (double-click guard)', async () => {
    const { native } = await import('../../native/commands')
    const { handoffController } = await import('./handoffController')
    let resolveDetach: (value: Awaited<ReturnType<typeof native.detachWorkspace>>) => void = () => {}
    vi.spyOn(native, 'getWorkspacePlacement').mockResolvedValue(placement('w1', 'detached'))
    vi.spyOn(native, 'detachWorkspace').mockReturnValue(
      new Promise<Awaited<ReturnType<typeof native.detachWorkspace>>>((resolve) => {
        resolveDetach = resolve
      }),
    )

    const first = handoffController.run('w1', placement('w1', 'attached'), 'open-in-new-window')
    expect(handoffController.isInFlight('w1')).toBe(true)
    await expect(
      handoffController.run('w1', placement('w1', 'attached'), 'open-in-new-window'),
    ).rejects.toMatchObject({ code: 'handoff_in_progress' })

    resolveDetach({operationId:'op',workspaceId:'w1',toWindowLabel:'ws-w1',targetMode:'detached',expectedRevision:0,leaseId:'lease'})
    await expect(first).resolves.toMatchObject({ mode: 'detached' })
    expect(handoffController.isInFlight('w1')).toBe(false)
  })
})
