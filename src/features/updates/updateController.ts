import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { create } from 'zustand'
import { asNativeError, native } from '../../native/commands'
import type {
  SafeRestartAssessment,
  SafeRestartClientState,
  UpdateDownloadProgress,
  UpdateStatus,
} from '../../native/types'

type UpdateOperation = 'checking' | 'downloading' | 'installing' | 'scheduling' | 'retrying'
type ConfirmSoftBlockers = (assessment: SafeRestartAssessment) => boolean | Promise<boolean>

interface UpdateControllerState {
  status?: UpdateStatus
  progress?: UpdateDownloadProgress
  assessment?: SafeRestartAssessment
  operation?: UpdateOperation
  error?: string
  deferred: boolean
  dismissedVersion?: string
  setStatus: (status: UpdateStatus) => void
  setProgress: (progress: UpdateDownloadProgress) => void
  dismiss: () => void
  check: () => Promise<UpdateStatus | undefined>
  download: () => Promise<UpdateStatus | undefined>
  updateNow: (client: SafeRestartClientState, confirmSoftBlockers: ConfirmSoftBlockers) => Promise<void>
  installOnExit: (client: SafeRestartClientState, confirmSoftBlockers: ConfirmSoftBlockers) => Promise<void>
  retry: () => Promise<UpdateStatus | undefined>
}

const availableVersion = (status?: UpdateStatus) => status?.journal.available?.version

function errorMessage(caught: unknown) {
  return asNativeError(caught).message
}

export const useUpdateController = create<UpdateControllerState>((set, get) => {
  const run = async (
    operation: UpdateOperation,
    action: () => Promise<UpdateStatus>,
  ): Promise<UpdateStatus | undefined> => {
    if (get().operation) return undefined
    set({ operation, error: undefined, deferred: false })
    try {
      const status = await action()
      get().setStatus(status)
      return status
    } catch (caught) {
      set({ error: errorMessage(caught) })
      return undefined
    } finally {
      set({ operation: undefined })
    }
  }

  const assessAndConfirm = async (
    client: SafeRestartClientState,
    confirmSoftBlockers: ConfirmSoftBlockers,
  ) => {
    const assessment = await native.assessSafeRestart(client)
    set({ assessment })
    if (assessment.hardBlocked) {
      set({
        error: `Update blocked while Git is changing the repository. ${assessment.hardBlockers.join(' ')}`,
      })
      return { assessment, confirmed: false }
    }
    if (assessment.safe) return { assessment, confirmed: true }
    const confirmed = await confirmSoftBlockers(assessment)
    if (!confirmed) set({ deferred: true })
    return { assessment, confirmed }
  }

  return {
    deferred: false,
    setStatus: (status) => {
      const previousVersion = availableVersion(get().status)
      const nextVersion = availableVersion(status)
      set({
        status,
        progress: status.journal.phase === 'downloading'
          ? { received: status.journal.downloadReceived, total: status.journal.downloadTotal }
          : status.journal.phase === 'downloaded'
            ? { received: status.journal.downloadReceived, total: status.journal.downloadTotal }
            : undefined,
        error: status.journal.phase === 'failed' ? status.journal.error || status.journal.lastResult : get().error,
        dismissedVersion: nextVersion && previousVersion !== nextVersion ? undefined : get().dismissedVersion,
      })
    },
    setProgress: (progress) => set((state) => ({
      progress,
      status: state.status ? {
        ...state.status,
        journal: {
          ...state.status.journal,
          phase: 'downloading',
          downloadReceived: progress.received,
          downloadTotal: progress.total,
        },
      } : state.status,
    })),
    dismiss: () => set({ dismissedVersion: availableVersion(get().status), deferred: true }),
    check: () => run('checking', native.checkForUpdates),
    download: () => run('downloading', native.downloadUpdate),
    retry: async () => {
      if (get().operation) return undefined
      set({ operation: 'retrying', error: undefined, deferred: false, assessment: undefined })
      try {
        get().setStatus(await native.retryUpdate())
        const status = await native.checkForUpdates()
        get().setStatus(status)
        return status
      } catch (caught) {
        set({ error: errorMessage(caught) })
        return undefined
      } finally {
        set({ operation: undefined })
      }
    },
    updateNow: async (client, confirmSoftBlockers) => {
      if (get().operation) return
      set({ error: undefined, deferred: false, assessment: undefined })
      let status = get().status
      if (!status || ['idle', 'no_update', 'failed'].includes(status.journal.phase)) {
        status = status?.journal.phase === 'failed' ? await get().retry() : await get().check()
      }
      if (!status?.journal.available) return
      if (status.journal.phase === 'available') status = await get().download()
      if (!status || status.journal.phase !== 'downloaded' || !status.journal.signatureVerified) {
        if (status?.journal.phase === 'failed') {
          set({ error: status.journal.error || 'The signed update could not be downloaded or verified.' })
        }
        return
      }
      set({ operation: 'installing' })
      try {
        const gate = await assessAndConfirm(client, confirmSoftBlockers)
        if (!gate.confirmed) return
        await native.installDownloadedUpdate(client, !gate.assessment.safe)
      } catch (caught) {
        set({ error: errorMessage(caught) })
      } finally {
        set({ operation: undefined })
      }
    },
    installOnExit: async (client, confirmSoftBlockers) => {
      if (get().operation || !get().status?.journal.signatureVerified) return
      set({ operation: 'scheduling', error: undefined, deferred: false })
      try {
        const gate = await assessAndConfirm(client, confirmSoftBlockers)
        if (!gate.confirmed) return
        get().setStatus(await native.installUpdateOnExit(client, !gate.assessment.safe))
      } catch (caught) {
        set({ error: errorMessage(caught) })
      } finally {
        set({ operation: undefined })
      }
    },
  }
})

let startPromise: Promise<void> | undefined
let unlisteners: UnlistenFn[] = []
let controllerGeneration = 0

export function startUpdateController() {
  if (startPromise) return startPromise
  const generation = ++controllerGeneration
  startPromise = (async () => {
    const statusListener = await listen<UpdateStatus>('update-status', (event) => {
      useUpdateController.getState().setStatus(event.payload)
    })
    if (generation !== controllerGeneration) {
      statusListener()
      return
    }
    unlisteners.push(statusListener)
    const progressListener = await listen<UpdateDownloadProgress>('update-progress', (event) => {
      useUpdateController.getState().setProgress(event.payload)
    })
    if (generation !== controllerGeneration) {
      progressListener()
      return
    }
    unlisteners.push(progressListener)
    try {
      useUpdateController.getState().setStatus(await native.getUpdateStatus())
    } catch (caught) {
      useUpdateController.setState({ error: errorMessage(caught) })
    }
  })()
  return startPromise
}

export function stopUpdateController() {
  controllerGeneration += 1
  for (const unlisten of unlisteners) unlisten()
  unlisteners = []
  startPromise = undefined
}
