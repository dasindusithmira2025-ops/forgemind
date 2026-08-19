import { useSyncExternalStore } from 'react'
import { native } from '../../native/commands'
import type { UsageTelemetrySnapshot } from '../../native/types'

interface UsageTelemetryState {
  snapshot?: UsageTelemetrySnapshot
  isRefreshing: boolean
  isSampling: boolean
  error?: string
}

class UsageTelemetryStore {
  private state: UsageTelemetryState = { isRefreshing: false, isSampling: false }
  private listeners = new Set<() => void>()
  private started = false
  private refreshPromise?: Promise<void>
  private samplePromise?: Promise<void>
  private timer?: number

  start() {
    if (this.started) return
    this.started = true
    void this.hydrate()
    document.addEventListener('visibilitychange', this.onVisibility)
    window.addEventListener('focus', this.onFocus)
    this.schedule()
  }

  private async hydrate() {
    const getTelemetry = (native as Partial<typeof native>).getUsageTelemetry
    if (getTelemetry) {
      try { this.set({ snapshot: await getTelemetry() }) } catch { /* sampling below owns the visible state */ }
    }
    void this.refresh(false)
  }

  private onFocus = () => { void this.sample(); this.schedule() }
  private onVisibility = () => {
    if (document.visibilityState === 'visible') { void this.sample(); this.schedule() }
    else this.stopSchedule()
  }

  private schedule() {
    this.stopSchedule()
    if (document.visibilityState !== 'visible') return
    this.timer = window.setTimeout(() => { void this.sample().finally(() => this.schedule()) }, 2_500)
  }

  private stopSchedule() {
    if (this.timer !== undefined) window.clearTimeout(this.timer)
    this.timer = undefined
  }

  async sample() {
    if (this.samplePromise) return this.samplePromise
    const sample = (native as Partial<typeof native>).sampleUsageTelemetry
    if (!sample) return
    this.set({ isSampling: true })
    this.samplePromise = sample()
      .then((snapshot) => this.set({ snapshot, error: undefined }))
      .catch(() => this.set({ error: 'Local telemetry could not be sampled.' }))
      .finally(() => { this.samplePromise = undefined; this.set({ isSampling: false }) })
    return this.samplePromise
  }

  async refresh(forceGithub = true) {
    if (this.refreshPromise) return this.refreshPromise
    const refresh = (native as Partial<typeof native>).refreshUsageTelemetry
    if (!refresh) return
    this.set({ isRefreshing: true })
    this.refreshPromise = refresh(forceGithub)
      .then((snapshot) => this.set({ snapshot, error: undefined }))
      .catch(() => this.set({ error: 'Telemetry refresh could not be completed.' }))
      .finally(() => { this.refreshPromise = undefined; this.set({ isRefreshing: false }) })
    return this.refreshPromise
  }

  private set(patch: Partial<UsageTelemetryState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getSnapshot = () => this.state
}

export const usageTelemetryStore = new UsageTelemetryStore()
const serverSnapshot: UsageTelemetryState = { isRefreshing: false, isSampling: false }
export function useUsageTelemetry() {
  usageTelemetryStore.start()
  return useSyncExternalStore(usageTelemetryStore.subscribe, usageTelemetryStore.getSnapshot, () => serverSnapshot)
}
