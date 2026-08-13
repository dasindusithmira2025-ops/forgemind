import { useCallback, useEffect, useState } from 'react'
import { native } from '../../native/commands'
import { aiUsageStore } from './aiUsageStore'
import { USAGE_PERIODS, type UsagePeriod } from './usageAnalytics'
import type { UsageDailyRow } from '../../native/types'

const PERIOD_KEY = 'paralith.usage.period'

export function loadPersistedPeriod(): UsagePeriod {
  try {
    const stored = Number(localStorage.getItem(PERIOD_KEY))
    return (USAGE_PERIODS as readonly number[]).includes(stored) ? (stored as UsagePeriod) : 30
  } catch {
    return 30
  }
}

function persistPeriod(period: UsagePeriod) {
  try {
    localStorage.setItem(PERIOD_KEY, String(period))
  } catch {
    /* A view preference is never worth failing the page over. */
  }
}

export interface UsageHistoryState {
  rows: UsageDailyRow[]
  period: UsagePeriod
  setPeriod: (period: UsagePeriod) => void
  /** True only until the first load resolves; a later refresh must not collapse the layout. */
  isLoading: boolean
  isRefreshing: boolean
  /** Set when the persisted history itself could not be read — distinct from a provider failure. */
  error?: string
  refresh: () => void
}

/**
 * Owns the Usage page's historical data.
 *
 * Reads land in two stages on purpose: the persisted aggregate renders immediately (it is local
 * SQLite and always available), and the provider re-scan runs after, updating the same view. That
 * ordering is what keeps a refresh from blanking a page that already has valid history — and it is
 * why a provider being unreachable degrades to "last recorded" rather than to an empty page.
 */
export function useUsageHistory(): UsageHistoryState {
  const [period, setPeriodState] = useState<UsagePeriod>(loadPersistedPeriod)
  const [rows, setRows] = useState<UsageDailyRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async (days: UsagePeriod) => {
    const history = await native.getAiUsageHistory(days)
    setRows(history)
    setError(undefined)
  }, [])

  useEffect(() => {
    let live = true
    setIsLoading(true)
    void load(period)
      .catch(() => { if (live) setError('Recorded usage history could not be read.') })
      .finally(() => { if (live) setIsLoading(false) })
    return () => { live = false }
  }, [load, period])

  const setPeriod = useCallback((next: UsagePeriod) => {
    setPeriodState(next)
    persistPeriod(next)
  }, [])

  const refresh = useCallback(() => {
    setIsRefreshing(true)
    // The provider re-scan re-derives and re-persists the aggregates, so history is only re-read
    // once ingestion has finished. Ingestion is idempotent, so a repeated refresh cannot duplicate.
    void aiUsageStore
      .refresh()
      .then(() => load(period))
      .catch(() => setError('Recorded usage history could not be read.'))
      .finally(() => setIsRefreshing(false))
  }, [load, period])

  return { rows, period, setPeriod, isLoading, isRefreshing, error, refresh }
}
