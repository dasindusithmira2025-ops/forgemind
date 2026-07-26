import { useSyncExternalStore } from 'react'
import { native } from '../../native/commands'
import { onAiUsageChanged, onTerminalExit } from '../../native/events'
import type { ProviderUsageSnapshot } from '../../native/types'

class AiUsageStore {
  private snapshots: ProviderUsageSnapshot[] = []
  private listeners = new Set<() => void>()
  private started = false
  private refreshPromise?: Promise<void>
  private timer?: number
  private activityTimer?: number
  private unlisten: Array<() => void> = []

  start() {
    if (this.started) return
    this.started = true
    void this.hydrate()
    void Promise.all([
      onAiUsageChanged((snapshots) => this.set(snapshots)),
      onTerminalExit(() => {
        // A completed Claude/Codex process is a meaningful local activity boundary. The native
        // collector still coalesces refreshes from any other window.
        if (this.activityTimer !== undefined) window.clearTimeout(this.activityTimer)
        this.activityTimer = window.setTimeout(() => { this.activityTimer = undefined; void this.refresh() }, 750)
      }),
    ]).then((unlisten) => this.unlisten.push(...unlisten)).catch(() => undefined)
    window.addEventListener('focus', this.onFocus)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.schedule()
  }

  private onFocus = () => { void this.refresh(); this.schedule() }
  private onVisibility = () => { if (document.visibilityState === 'visible') { void this.refresh(); this.schedule() } }
  private schedule = () => {
    if (this.timer !== undefined) window.clearTimeout(this.timer)
    if (document.visibilityState !== 'visible') { this.timer = undefined; return }
    this.timer = window.setTimeout(() => { void this.refresh().finally(this.schedule) }, 60_000)
  }
  private async hydrate() { try { const getSnapshots = (native as Partial<typeof native>).getAiUsageSnapshots; if (getSnapshots) this.set(await getSnapshots()) } catch { /* status bar retains an empty, non-decorative state */ } finally { void this.refresh() } }
  async refresh() {
    if (this.refreshPromise) return this.refreshPromise
    const refresh = (native as Partial<typeof native>).refreshAiUsage
    if (!refresh) return
    this.refreshPromise = refresh().then((snapshots) => this.set(snapshots)).catch(() => undefined).finally(() => { this.refreshPromise = undefined })
    return this.refreshPromise
  }
  private set(snapshots: ProviderUsageSnapshot[]) { this.snapshots = snapshots; this.listeners.forEach((listener) => listener()) }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  getSnapshot = () => this.snapshots
}

export const aiUsageStore = new AiUsageStore()
export function useAiUsage() { aiUsageStore.start(); return useSyncExternalStore(aiUsageStore.subscribe, aiUsageStore.getSnapshot, () => []) }
