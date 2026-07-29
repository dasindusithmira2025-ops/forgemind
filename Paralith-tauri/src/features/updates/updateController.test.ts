import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SafeRestartAssessment, UpdateStatus } from '../../native/types'

const nativeMock = vi.hoisted(() => ({
  getUpdateStatus: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  assessSafeRestart: vi.fn(),
  installDownloadedUpdate: vi.fn(),
  installUpdateOnExit: vi.fn(),
  retryUpdate: vi.fn(),
}))
const eventMock = vi.hoisted(() => ({ listen: vi.fn() }))

vi.mock('@tauri-apps/api/event', () => ({ listen: eventMock.listen }))
vi.mock('../../native/commands', () => ({
  native: nativeMock,
  asNativeError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}))

import { startUpdateController, stopUpdateController, useUpdateController } from './updateController'

function status(phase: UpdateStatus['journal']['phase']): UpdateStatus {
  return {
    build: {
      product: 'PARALITH',
      edition: 'preview',
      version: '0.4.1-1023',
      gitCommit: 'abc',
      buildTimestamp: '2026-07-28T00:00:00Z',
      releaseChannel: 'preview',
      databaseSchemaVersion: 22,
      target: 'windows',
      architecture: 'x86_64',
      appIdentifier: 'com.corelith.paralith.preview',
      updateEndpoint: 'https://example/latest.json',
      updaterPublicKeyProvisioned: true,
      bundledRelease: {},
    },
    journal: {
      phase,
      fromVersion: '0.4.1-1023',
      fromSchemaVersion: 22,
      signatureVerified: phase === 'downloaded',
      downloadReceived: phase === 'downloaded' ? 1024 : 0,
      downloadTotal: 1024,
      installOnExit: false,
      firstLaunchAttempts: 0,
      available: {
        version: '0.4.1-1024',
        releaseNotes: 'Signed update',
        edition: 'preview',
        channel: 'preview',
        schemaVersion: 22,
        minimumSchemaVersion: 1,
        maximumSchemaVersion: 22,
        rolloutPercent: 100,
      },
      history: [],
    },
    endpointConfigured: true,
    endpointStatus: 'Configured',
    installerType: 'windows-x86_64',
    recoveryMode: false,
    updateDataDirectory: 'updates',
  }
}

const safe: SafeRestartAssessment = {
  safe: true,
  installable: true,
  hardBlocked: false,
  runningTerminals: 0,
  activeAgents: 0,
  activeSwarms: 0,
  detachedWindows: 0,
  gitMutationActive: false,
  pendingDatabaseWrites: 0,
  unsavedEditorState: false,
  unsavedSettings: false,
  unsavedBrowserState: false,
  blockers: [],
  hardBlockers: [],
}
const client = { unsavedEditorState: false, unsavedSettings: false, unsavedBrowserState: false }

beforeEach(() => {
  stopUpdateController()
  vi.clearAllMocks()
  eventMock.listen.mockResolvedValue(vi.fn())
  nativeMock.getUpdateStatus.mockResolvedValue(status('idle'))
  useUpdateController.setState({
    status: undefined,
    progress: undefined,
    assessment: undefined,
    operation: undefined,
    error: undefined,
    deferred: false,
    dismissedVersion: undefined,
  })
})

describe('shared update controller', () => {
  it('downloads, requires the verified state, passes the safe gate, and installs immediately', async () => {
    useUpdateController.getState().setStatus(status('available'))
    nativeMock.downloadUpdate.mockResolvedValue(status('downloaded'))
    nativeMock.assessSafeRestart.mockResolvedValue(safe)
    nativeMock.installDownloadedUpdate.mockResolvedValue(undefined)

    await useUpdateController.getState().updateNow(client, vi.fn())

    expect(nativeMock.downloadUpdate).toHaveBeenCalledOnce()
    expect(nativeMock.assessSafeRestart).toHaveBeenCalledWith(client)
    expect(nativeMock.installDownloadedUpdate).toHaveBeenCalledWith(client, false)
  })

  it('defers soft blockers without dismissing the available update', async () => {
    useUpdateController.getState().setStatus(status('downloaded'))
    nativeMock.assessSafeRestart.mockResolvedValue({
      ...safe,
      safe: false,
      runningTerminals: 1,
      blockers: ['1 terminal is running.'],
    })
    const confirm = vi.fn().mockResolvedValue(false)

    await useUpdateController.getState().updateNow(client, confirm)

    expect(confirm).toHaveBeenCalledOnce()
    expect(nativeMock.installDownloadedUpdate).not.toHaveBeenCalled()
    expect(useUpdateController.getState().deferred).toBe(true)
    expect(useUpdateController.getState().status?.journal.available?.version).toBe('0.4.1-1024')
  })

  it('never offers an override for an active Git mutation', async () => {
    useUpdateController.getState().setStatus(status('downloaded'))
    nativeMock.assessSafeRestart.mockResolvedValue({
      ...safe,
      safe: false,
      installable: false,
      hardBlocked: true,
      gitMutationActive: true,
      hardBlockers: ['A Git operation is in progress.'],
    })
    const confirm = vi.fn()

    await useUpdateController.getState().updateNow(client, confirm)

    expect(confirm).not.toHaveBeenCalled()
    expect(nativeMock.installDownloadedUpdate).not.toHaveBeenCalled()
    expect(useUpdateController.getState().error).toContain('Git')
  })

  it('retries a failed update by resetting and checking again', async () => {
    useUpdateController.getState().setStatus(status('failed'))
    nativeMock.retryUpdate.mockResolvedValue(status('idle'))
    nativeMock.checkForUpdates.mockResolvedValue(status('available'))

    await useUpdateController.getState().retry()

    expect(nativeMock.retryUpdate).toHaveBeenCalledOnce()
    expect(nativeMock.checkForUpdates).toHaveBeenCalledOnce()
    expect(useUpdateController.getState().status?.journal.phase).toBe('available')
  })

  it('keeps real progress in the shared status consumed by notification and Settings', () => {
    useUpdateController.getState().setStatus(status('available'))
    useUpdateController.getState().setProgress({ received: 25, total: 100 })
    expect(useUpdateController.getState().status?.journal.phase).toBe('downloading')
    expect(useUpdateController.getState().status?.journal.downloadReceived).toBe(25)
    expect(useUpdateController.getState().progress).toEqual({ received: 25, total: 100 })
  })

  it('cleans up a partial subscription and can retry after listener startup fails', async () => {
    const removeStatusListener = vi.fn()
    eventMock.listen
      .mockResolvedValueOnce(removeStatusListener)
      .mockRejectedValueOnce(new Error('event bus unavailable'))

    await expect(startUpdateController()).resolves.toBeUndefined()
    expect(removeStatusListener).toHaveBeenCalledOnce()
    expect(useUpdateController.getState().error).toBe('event bus unavailable')

    eventMock.listen.mockResolvedValue(vi.fn())
    await expect(startUpdateController()).resolves.toBeUndefined()
    expect(nativeMock.getUpdateStatus).toHaveBeenCalledOnce()
  })
})
