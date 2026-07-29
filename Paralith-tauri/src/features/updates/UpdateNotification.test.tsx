import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SafeRestartAssessment, UpdateStatus } from '../../native/types'
import { UpdateNotificationView } from './UpdateNotification'

function status(phase: UpdateStatus['journal']['phase'], overrides: Partial<UpdateStatus['journal']> = {}): UpdateStatus {
  return {
    build: {
      product: 'PARALITH',
      version: '0.4.1-1023',
      edition: 'preview',
      releaseChannel: 'preview',
      gitCommit: 'abc',
      buildTimestamp: '2026-07-28T00:00:00Z',
      databaseSchemaVersion: 22,
      target: 'windows',
      architecture: 'x86_64',
      appIdentifier: 'com.corelith.paralith.preview',
      updaterPublicKeyProvisioned: true,
      updateEndpoint: 'https://example/preview/latest.json',
      bundledRelease: {},
    },
    journal: {
      phase,
      fromVersion: '0.4.1-1023',
      fromSchemaVersion: 22,
      signatureVerified: phase === 'downloaded',
      downloadReceived: 0,
      installOnExit: false,
      firstLaunchAttempts: 0,
      available: {
        version: '0.4.1-1024',
        releaseNotes: 'Signed updates now install directly.',
        edition: 'preview',
        channel: 'preview',
        schemaVersion: 22,
        minimumSchemaVersion: 1,
        maximumSchemaVersion: 22,
        rolloutPercent: 100,
      },
      history: [],
      ...overrides,
    },
    endpointConfigured: true,
    endpointStatus: 'Configured',
    installerType: 'windows-x86_64',
    recoveryMode: false,
    updateDataDirectory: 'updates',
  }
}

const softAssessment: SafeRestartAssessment = {
  safe: false,
  installable: true,
  hardBlocked: false,
  runningTerminals: 1,
  activeAgents: 1,
  activeSwarms: 0,
  detachedWindows: 0,
  gitMutationActive: false,
  pendingDatabaseWrites: 0,
  unsavedEditorState: false,
  unsavedSettings: false,
  unsavedBrowserState: false,
  blockers: ['1 terminal session is running.'],
  hardBlockers: [],
}

function renderNotification(props: Partial<Parameters<typeof UpdateNotificationView>[0]> = {}) {
  const defaults: Parameters<typeof UpdateNotificationView>[0] = {
    status: status('available'),
    deferred: false,
    dismissed: false,
    onUpdateNow: vi.fn(),
    onRetry: vi.fn(),
    onLater: vi.fn(),
  }
  return render(<UpdateNotificationView {...defaults} {...props} />)
}

describe('one-click update notification', () => {
  it('shows the available version, release summary, Update now, and Later', async () => {
    const onUpdateNow = vi.fn()
    renderNotification({ onUpdateNow })
    expect(screen.getByText('PARALITH 0.4.1-1024')).toBeInTheDocument()
    expect(screen.getByText('Signed updates now install directly.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }))
    expect(onUpdateNow).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument()
  })

  it('renders real byte and percentage progress while downloading', () => {
    renderNotification({
      status: status('downloading'),
      progress: { received: 5 * 1024 * 1024, total: 20 * 1024 * 1024 },
      operation: 'downloading',
    })
    expect(screen.getByRole('button', { name: 'Downloading 25%' })).toBeDisabled()
    expect(screen.getByText('5.0 MB of 20.0 MB · 25%')).toBeInTheDocument()
  })

  it('reports bundled-key verification before a safe install', () => {
    renderNotification({ status: status('downloaded') })
    expect(screen.getByText(/Signature verified with PARALITH’s bundled updater key/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install & restart' })).toBeEnabled()
  })

  it('keeps soft-blocked and deferred updates available', () => {
    renderNotification({ status: status('downloaded'), assessment: softAssessment, deferred: true })
    expect(screen.getByText('1 terminal session is running.')).toBeInTheDocument()
    expect(screen.getByText('Update deferred. Your active work was left running.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install & restart' })).toBeEnabled()
  })

  it('makes an active Git mutation an absolute blocker', () => {
    renderNotification({
      status: status('downloaded'),
      assessment: {
        ...softAssessment,
        installable: false,
        hardBlocked: true,
        gitMutationActive: true,
        blockers: [],
        hardBlockers: ['A Git operation is in progress.'],
      },
    })
    expect(screen.getByText('A Git operation is in progress.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install & restart' })).toBeDisabled()
  })

  it('offers retry after failure and hides only when explicitly dismissed', async () => {
    const onRetry = vi.fn()
    const { rerender } = renderNotification({
      status: status('failed', { error: 'Signature verification failed.' }),
      error: 'Signature verification failed.',
      onRetry,
    })
    await userEvent.click(screen.getByRole('button', { name: 'Retry update' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.getByText('Signature verification failed.')).toBeInTheDocument()
    rerender(<UpdateNotificationView
      status={status('failed')}
      deferred={false}
      dismissed
      onUpdateNow={vi.fn()}
      onRetry={vi.fn()}
      onLater={vi.fn()}
    />)
    expect(screen.queryByLabelText('Update available')).not.toBeInTheDocument()
  })
})
