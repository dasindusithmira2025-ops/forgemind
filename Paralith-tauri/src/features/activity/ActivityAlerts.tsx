import { useEffect, useRef, useState } from 'react'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { AlertTriangle, CheckCircle2, PauseCircle } from 'lucide-react'
import type { ActivityThread } from '../../native/types'
import { activityStateLabel, alertKey, pendingAlerts, useActivityStore } from './activityStore'
import './activity.css'

/** A completion is worth one glance, not a dismissal. Failures and asks stay until acted on. */
const SUCCESS_TOAST_MS = 6000

const important = (thread: ActivityThread) =>
  thread.state === 'failed' || thread.state === 'blocked' || thread.state === 'waiting_for_user'

async function notifyNatively(thread: ActivityThread) {
  try {
    const granted = await isPermissionGranted() || await requestPermission() === 'granted'
    if (!granted) return
    sendNotification({ title: `${thread.title} — ${activityStateLabel(thread.state)}`, body: thread.summary })
  } catch {
    // A refused or unavailable notification channel is not an application error: the dock and the
    // toast already carry the same signal inside the window.
  }
}

/**
 * In-app toast plus an OS notification for the states worth interrupting someone over.
 *
 * The OS half only fires when the window is not focused — a notification for something the user is
 * already looking at is noise. The in-app half is the surface for the focused case.
 */
export function ActivityAlerts() {
  const threads = useActivityStore((state) => state.threads)
  const loaded = useActivityStore((state) => state.loaded)
  const setOpen = useActivityStore((state) => state.setOpen)
  const canOpenDock = useActivityStore((state) => state.pulseMounted)
  const fired = useRef(new Set<string>())
  const seeded = useRef(false)
  const [toast, setToast] = useState<ActivityThread>()

  useEffect(() => {
    if (!loaded) return
    const pending = pendingAlerts(threads, fired.current)
    for (const thread of pending) fired.current.add(alertKey(thread))
    // The hydrate snapshot is history, not news: adopt it as already-alerted and start from there.
    if (!seeded.current) { seeded.current = true; return }
    if (pending.length === 0) return
    const newest = pending[0]
    setToast(newest)
    if (!document.hasFocus()) for (const thread of pending) void notifyNatively(thread)
  }, [threads, loaded])

  useEffect(() => {
    if (!toast || important(toast)) return
    const timer = window.setTimeout(() => setToast(undefined), SUCCESS_TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (!toast) return null
  const tone = important(toast) ? 'attention' : 'settled'
  return <aside className={`activity-toast is-${tone}`} role={important(toast) ? 'alert' : 'status'} aria-label="Activity update">
    <div className="activity-toast-icon">
      {toast.state === 'failed' || toast.state === 'blocked'
        ? <AlertTriangle size={16} />
        : toast.state === 'completed' ? <CheckCircle2 size={16} /> : <PauseCircle size={16} />}
    </div>
    <div className="activity-toast-copy">
      <strong>{toast.title}</strong>
      <span>{activityStateLabel(toast.state)} · {toast.summary}</span>
      {toast.reason && <small>{toast.reason}</small>}
    </div>
    <div className="activity-toast-actions">
      {canOpenDock && <button className="button button-primary" onClick={() => { setOpen(true); setToast(undefined) }}>View</button>}
      <button onClick={() => setToast(undefined)}>Dismiss</button>
    </div>
  </aside>
}
