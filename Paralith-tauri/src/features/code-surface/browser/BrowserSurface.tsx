import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Copy,
  ExternalLink,
  MousePointerSquareDashed,
  RotateCw,
  Search,
  Send,
  ShieldAlert,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import './browser.css'
import { native } from '../../../native/commands'
import { onBrowserEvent } from '../../../native/events'
import type { BrowserBounds } from '../../../native/types'
import {
  canGoBack,
  canGoForward,
  currentEntry,
  useBrowserSessionStore,
} from './browserSessionStore'
import { displayUrl, hostLabel, isTrustedInspectOrigin } from './browserUrl'
import { decodeInspectPayload } from './browserInspectBridge'
import {
  buildAgentContext,
  sanitizeInspectedElement,
  type AgentContextPackage,
  type SanitizedElement,
} from './inspectContext'

/** Context used to build the "Send to Active Agent" package. */
export interface BrowserContextInfo {
  workspaceId: string
  workspaceName?: string
  projectId: string
  projectName?: string
  taskId?: string
  taskName?: string
  worktree?: string
  agentLabel?: string
}

export interface BrowserSurfaceProps {
  /** True only while the Browser is the visible + selected surface. The native webview is hidden
   * whenever this is false so the Editor (plain HTML) shows through. */
  active: boolean
  context: BrowserContextInfo
  onSendToAgent?: (pkg: AgentContextPackage) => Promise<void> | void
}

/** Common local dev-server ports offered as one-tap openers on the start page. These are honest
 * conveniences (not claimed detections) until backend port discovery lands. */
const COMMON_PORTS: { port: number; label: string }[] = [
  { port: 3000, label: 'Next / Node' },
  { port: 5173, label: 'Vite' },
  { port: 8080, label: 'Web' },
  { port: 8000, label: 'API' },
  { port: 4200, label: 'Angular' },
]

export function BrowserSurface({ active, context, onSendToAgent }: BrowserSurfaceProps) {
  const workspaceId = context.workspaceId
  const store = useBrowserSessionStore()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const addressRef = useRef<HTMLInputElement>(null)
  const boundsFrame = useRef(0)
  const [quickOpen, setQuickOpen] = useState(false)

  const url = currentEntry(store.history)
  const shouldShowWebview = active && Boolean(url)

  useEffect(() => {
    store.init(workspaceId)
    // Tear down this Workspace's browser view when the surface unmounts or the Workspace changes,
    // so a browser session is never silently reused under an unrelated Workspace.
    return () => {
      void native.closeBrowserView(workspaceId).catch(() => undefined)
    }
    // Only re-run when the Workspace identity changes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const measureBounds = useCallback((): BrowserBounds | undefined => {
    const node = viewportRef.current
    if (!node) return undefined
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return undefined
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
  }, [])

  const pushBounds = useCallback(() => {
    if (boundsFrame.current) return
    boundsFrame.current = requestAnimationFrame(() => {
      boundsFrame.current = 0
      const bounds = measureBounds()
      if (bounds) void native.browserSetBounds(workspaceId, bounds).catch(() => undefined)
    })
  }, [measureBounds, workspaceId])

  // Keep the native child webview overlaying the viewport rectangle exactly, and hidden whenever the
  // Browser is not the active surface (so the mounted Editor shows through). The webview is never
  // recreated on show/hide — its page, history and scroll survive tool switches.
  useEffect(() => {
    if (!shouldShowWebview) {
      void native.browserSetVisible(workspaceId, false).catch(() => undefined)
      return
    }
    const bounds = measureBounds()
    if (!bounds) return
    let cancelled = false
    void (async () => {
      try {
        // Passing the URL means the backend creates the view pointing at it (no about:blank →
        // navigate race) or navigates an existing view only when the URL actually changed — so a
        // re-show after an Editor switch never reloads the page.
        await native.openBrowserView(workspaceId, bounds, url)
        if (cancelled) return
        await native.browserSetZoom(workspaceId, useBrowserSessionStore.getState().zoom)
        await native.browserSetVisible(workspaceId, true)
      } catch (caught) {
        if (cancelled) return
        // Surface the real backend failure instead of leaving a silently blank viewport + spinner.
        const message = (caught as { message?: string })?.message ?? String(caught)
        useBrowserSessionStore.setState({ loading: false, error: { kind: 'load-failed', url: url ?? '', message } })
      }
    })()

    const node = viewportRef.current
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => pushBounds()) : undefined
    if (node && observer) observer.observe(node)
    window.addEventListener('resize', pushBounds)
    return () => {
      cancelled = true
      observer?.disconnect()
      window.removeEventListener('resize', pushBounds)
      if (boundsFrame.current) {
        cancelAnimationFrame(boundsFrame.current)
        boundsFrame.current = 0
      }
    }
    // Re-run when activation or the loaded URL changes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShowWebview, url, workspaceId])

  // React to lifecycle + security events from the native view. All payloads originate in Rust hooks;
  // inspection payloads are still decoded and re-sanitized here before being trusted.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    void onBrowserEvent((event) => {
      if (event.workspaceId !== workspaceId) return
      const state = useBrowserSessionStore.getState()
      switch (event.kind) {
        case 'load-started':
          state.onLoadStarted(event.url)
          break
        case 'load-finished':
          state.onLoadFinished({ url: event.url })
          break
        case 'title-changed':
          state.onLoadFinished({ url: currentEntry(state.history) ?? '', title: event.title })
          break
        case 'nav-blocked':
          state.onLoadFailed({ url: event.url, kind: 'blocked-scheme' })
          break
        case 'inspect-selected': {
          if (!state.inspecting) return
          const raw = decodeInspectPayload(event.payload)
          state.setInspecting(false)
          if (!raw) return
          const element = sanitizeInspectedElement(raw)
          state.setSelection({ element, pageUrl: currentEntry(state.history) ?? '', pageTitle: state.title })
          break
        }
      }
    }).then((stop) => {
      if (cancelled) stop()
      else unlisten = stop
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [workspaceId])

  // Watchdog: Tauri's load hooks do not surface network-level failures (e.g. connection refused —
  // WebView2 renders its own error page instead), so a stuck spinner would otherwise hang forever.
  // If no load-finished arrives in time, clear the spinner so the controls are usable again.
  useEffect(() => {
    if (!store.loading) return
    const timer = setTimeout(() => {
      if (useBrowserSessionStore.getState().loading) useBrowserSessionStore.setState({ loading: false })
    }, 20000)
    return () => clearTimeout(timer)
  }, [store.loading, url])

  // Navigation handlers only update the session store; the geometry effect drives the actual native
  // navigation whenever the current URL changes, so there is a single source of navigation truth.
  const go = useCallback((rawInput: string) => {
    const before = currentEntry(useBrowserSessionStore.getState().history)
    const target = useBrowserSessionStore.getState().navigate(rawInput)
    setQuickOpen(false)
    // Resubmitting the identical URL is a reload (the effect won't fire on an unchanged URL).
    if (target && target === before) {
      useBrowserSessionStore.setState({ loading: true })
      void native.browserReload(workspaceId).catch(() => undefined)
    }
  }, [workspaceId])

  const back = useCallback(() => { useBrowserSessionStore.getState().goBack() }, [])
  const forward = useCallback(() => { useBrowserSessionStore.getState().goForward() }, [])

  const reload = useCallback(() => {
    if (useBrowserSessionStore.getState().reload()) void native.browserReload(workspaceId).catch(() => undefined)
  }, [workspaceId])

  const stop = useCallback(() => {
    useBrowserSessionStore.setState({ loading: false })
    void native.browserStop(workspaceId).catch(() => undefined)
  }, [workspaceId])

  const applyZoom = useCallback((next: number) => {
    void native.browserSetZoom(workspaceId, next).catch(() => undefined)
  }, [workspaceId])

  const toggleInspect = useCallback(() => {
    const state = useBrowserSessionStore.getState()
    const next = !state.inspecting
    state.setInspecting(next)
    void native.browserSetInspect(workspaceId, next).catch(() => undefined)
  }, [workspaceId])

  const focusAddress = useCallback(() => {
    const input = addressRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [])

  // Browser-scoped keyboard shortcuts. Bound only while active AND focus is inside the Browser's own
  // HTML chrome, so a focused terminal or the page webview never has its keys intercepted.
  useEffect(() => {
    if (!active) return
    const handle = (event: KeyboardEvent) => {
      const target = document.activeElement
      const owns = !target || target === document.body || (surfaceRef.current?.contains(target) ?? false)
      if (!owns) return
      const key = event.key.toLowerCase()
      if (event.ctrlKey && !event.shiftKey && key === 'l') { event.preventDefault(); focusAddress() }
      else if (event.ctrlKey && !event.shiftKey && key === 'r') { event.preventDefault(); reload() }
      else if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); back() }
      else if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); forward() }
      else if (event.ctrlKey && (event.key === '+' || event.key === '=')) { event.preventDefault(); applyZoom(useBrowserSessionStore.getState().zoomIn()) }
      else if (event.ctrlKey && event.key === '-') { event.preventDefault(); applyZoom(useBrowserSessionStore.getState().zoomOut()) }
      else if (event.ctrlKey && event.key === '0') { event.preventDefault(); applyZoom(useBrowserSessionStore.getState().resetZoom()) }
      else if (event.key === 'Escape') {
        if (useBrowserSessionStore.getState().inspecting) { event.preventDefault(); toggleInspect() }
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [active, applyZoom, back, focusAddress, forward, reload, toggleInspect])

  const loading = store.loading
  const canInspect = Boolean(url) && isTrustedInspectOrigin(url ?? '')

  return (
    <div className="browser-surface" ref={surfaceRef} style={{ display: active ? undefined : 'none' }} aria-hidden={!active}>
      <div className="browser-navbar" role="toolbar" aria-label="Browser navigation">
        <div className="browser-nav-group">
          <button type="button" title="Back (Alt+Left)" aria-label="Back" disabled={!canGoBack(store.history)} onClick={back}><ArrowLeft size={15} /></button>
          <button type="button" title="Forward (Alt+Right)" aria-label="Forward" disabled={!canGoForward(store.history)} onClick={forward}><ArrowRight size={15} /></button>
          {loading ? (
            <button type="button" className="browser-stop" title="Stop loading (Esc)" aria-label="Stop loading" onClick={stop}><X size={15} /></button>
          ) : (
            <button type="button" title="Reload (Ctrl+R)" aria-label="Reload" disabled={!url} onClick={reload}><RotateCw size={15} /></button>
          )}
        </div>

        <form
          className={`browser-address ${store.secure ? 'is-secure' : ''}`}
          onSubmit={(event) => { event.preventDefault(); go(store.input) }}
        >
          {store.secure ? <span className="browser-lock" title="Secure connection">🔒</span> : null}
          <input
            ref={addressRef}
            type="text"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Address"
            placeholder="Enter a URL or localhost:port"
            title={url ? displayUrl(url) : undefined}
            value={store.input}
            onChange={(event) => store.setInput(event.target.value)}
            onFocus={(event) => event.target.select()}
          />
          {loading && <span className="browser-loading-dot" aria-label="Loading" />}
          <button type="button" className="browser-address-menu" title="Open a dev server" aria-label="Open a dev server" onClick={() => setQuickOpen((value) => !value)}><Search size={14} /></button>
        </form>

        <div className="browser-nav-group">
          <button
            type="button"
            className={`browser-inspect ${store.inspecting ? 'is-active' : ''}`}
            title={canInspect ? 'Inspect element' : 'Inspect is available on localhost pages only'}
            aria-label="Inspect element"
            aria-pressed={store.inspecting}
            disabled={!canInspect}
            onClick={toggleInspect}
          ><MousePointerSquareDashed size={15} /></button>
          <button type="button" title="Open in system browser" aria-label="Open externally" disabled={!url} onClick={() => url && void openUrl(displayUrl(url)).catch(() => undefined)}><ExternalLink size={15} /></button>
          <div className="browser-zoom" role="group" aria-label="Zoom">
            <button type="button" title="Zoom out (Ctrl+-)" aria-label="Zoom out" onClick={() => applyZoom(store.zoomOut())}><ZoomOut size={14} /></button>
            <button type="button" className="browser-zoom-level" title="Reset zoom (Ctrl+0)" aria-label="Reset zoom" onClick={() => applyZoom(store.resetZoom())}>{Math.round(store.zoom * 100)}%</button>
            <button type="button" title="Zoom in (Ctrl++)" aria-label="Zoom in" onClick={() => applyZoom(store.zoomIn())}><ZoomIn size={14} /></button>
          </div>
        </div>
      </div>

      {store.inspecting && (
        <div className="browser-inspect-strip" role="status">
          <MousePointerSquareDashed size={13} />
          <span>Inspect mode — click an element in the page. Press Esc to cancel.</span>
        </div>
      )}

      {store.error && (
        <BrowserErrorStrip
          kind={store.error.kind}
          message={store.error.message}
          onRetry={() => url && reload()}
          onDismiss={() => useBrowserSessionStore.setState({ error: undefined })}
        />
      )}

      <div className="browser-viewport" ref={viewportRef}>
        {!url && <BrowserStartPage onOpen={go} recents={recentUrls(store.history)} />}
        {url && !store.error && !shouldShowWebviewSupported() && (
          <div className="browser-unsupported"><ShieldAlert size={22} /><p>The embedded browser view is unavailable in this environment.</p></div>
        )}
        {/* Sits behind the native webview: visible only until the native surface is created and
          * paints over it, so a creation failure or slow start is never a silent black rectangle. */}
        {url && !store.error && shouldShowWebviewSupported() && (
          <div className="browser-viewport-status" role="status">
            <span className="browser-viewport-status-spinner" aria-hidden />
            <span>Starting browser…</span>
            <code title={displayUrl(url)}>{hostLabel(url)}</code>
          </div>
        )}
      </div>

      {store.selection && (
        <SelectedElementBar
          selection={store.selection}
          context={context}
          canSend={Boolean(onSendToAgent)}
          onSend={onSendToAgent}
          onClear={() => useBrowserSessionStore.getState().setSelection(undefined)}
        />
      )}

      {quickOpen && (
        <div className="browser-quickopen" role="menu" aria-label="Open a dev server">
          <button type="button" className="browser-quickopen-scrim" aria-label="Close" onClick={() => setQuickOpen(false)} />
          <div className="browser-quickopen-panel">
            <p className="browser-quickopen-title">Common dev servers</p>
            <div className="browser-quickopen-ports">
              {COMMON_PORTS.map((item) => (
                <button key={item.port} type="button" onClick={() => go(`localhost:${item.port}`)}>
                  <strong>localhost:{item.port}</strong>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            {recentUrls(store.history).length > 0 && (
              <>
                <p className="browser-quickopen-title">Recent</p>
                <div className="browser-quickopen-recents">
                  {recentUrls(store.history).map((recent) => (
                    <button key={recent} type="button" title={recent} onClick={() => go(recent)}>{hostLabel(recent)}<span>{recent}</span></button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** The native webview overlays the viewport; in a real Tauri window it is always supported. This
 * only reports false in a non-Tauri host (where `window.__TAURI_INTERNALS__` is absent), so the UI
 * can show an honest unsupported notice rather than a blank rectangle. */
function shouldShowWebviewSupported(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function recentUrls(history: { entries: string[] }): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = history.entries.length - 1; i >= 0 && out.length < 6; i -= 1) {
    const value = history.entries[i]
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function BrowserErrorStrip({ kind, message, onRetry, onDismiss }: { kind: string; message: string; onRetry: () => void; onDismiss: () => void }) {
  const danger = kind === 'security' || kind === 'blocked-scheme'
  return (
    <div className={`browser-error-strip ${danger ? 'is-danger' : ''}`} role="alert">
      {danger ? <ShieldAlert size={14} /> : <Ban size={14} />}
      <span>{message}</span>
      <div className="browser-error-actions">
        <button type="button" onClick={onRetry}>Retry</button>
        <button type="button" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  )
}

function BrowserStartPage({ onOpen, recents }: { onOpen: (url: string) => void; recents: string[] }) {
  return (
    <div className="browser-start">
      <h3>Open a development server</h3>
      <p>Run your app in a terminal, then open its localhost URL here — the terminal keeps running beside the browser.</p>
      <div className="browser-start-ports">
        {COMMON_PORTS.map((item) => (
          <button key={item.port} type="button" onClick={() => onOpen(`localhost:${item.port}`)}>
            <strong>localhost:{item.port}</strong>
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      {recents.length > 0 && (
        <div className="browser-start-recents">
          <span>Recent</span>
          {recents.map((url) => (
            <button key={url} type="button" title={url} onClick={() => onOpen(url)}>{hostLabel(url)}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function SelectedElementBar({
  selection,
  context,
  canSend,
  onSend,
  onClear,
}: {
  selection: { element: SanitizedElement; pageUrl: string; pageTitle?: string; screenshot?: string }
  context: BrowserContextInfo
  canSend: boolean
  onSend?: (pkg: AgentContextPackage) => Promise<void> | void
  onClear: () => void
}) {
  const [instruction, setInstruction] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [sent, setSent] = useState(false)
  const { element } = selection

  const buildPackage = useCallback(
    () =>
      buildAgentContext({
        instruction,
        pageUrl: selection.pageUrl,
        pageTitle: selection.pageTitle,
        element,
        screenshot: selection.screenshot,
        target: {
          workspaceId: context.workspaceId,
          workspaceName: context.workspaceName,
          projectId: context.projectId,
          projectName: context.projectName,
          taskId: context.taskId,
          taskName: context.taskName,
          worktree: context.worktree,
          agentLabel: context.agentLabel,
        },
      }),
    [context, element, instruction, selection],
  )

  const label = `${element.tag}${element.id ? `#${element.id}` : element.classNames[0] ? `.${element.classNames[0]}` : ''}`

  const doSend = useCallback(async () => {
    const pkg = buildPackage()
    if (pkg.requiresReview && !confirming) { setConfirming(true); return }
    await onSend?.(pkg)
    setSent(true)
    setConfirming(false)
    setTimeout(() => setSent(false), 1500)
  }, [buildPackage, confirming, onSend])

  const pkg = buildPackage()

  return (
    <div className="browser-selection" role="region" aria-label="Selected element">
      <div className="browser-selection-head">
        <code className="browser-selection-label" title={element.selector ?? label}>{label}</code>
        {element.selector && <span className="browser-selection-selector" title={element.selector}>{element.selector}</span>}
        <span className="browser-selection-spacer" />
        <button type="button" title="Copy selector" aria-label="Copy selector" disabled={!element.selector} onClick={() => element.selector && void navigator.clipboard?.writeText(element.selector)}><Copy size={13} /> Selector</button>
        <button type="button" title="Copy context" aria-label="Copy context" onClick={() => void navigator.clipboard?.writeText(pkg.prompt)}><Copy size={13} /> Context</button>
        <button type="button" title="Clear selection" aria-label="Clear selection" onClick={onClear}><X size={14} /></button>
      </div>
      {canSend && (
        <div className="browser-selection-send">
          <input
            type="text"
            aria-label="Instruction for the agent"
            placeholder="What should the agent do with this element?"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
          <button type="button" className={`browser-send ${confirming ? 'is-confirming' : ''}`} onClick={() => void doSend()}>
            <Send size={13} /> {sent ? 'Sent' : confirming ? 'Review & send' : 'Send to Active Agent'}
          </button>
        </div>
      )}
      {pkg.warnings.length > 0 && (
        <div className="browser-selection-warn" role="status">
          <ShieldAlert size={12} />
          <span>
            {pkg.warnings.includes('injection-suspected') && 'Page text resembles an instruction — review before sending. '}
            {pkg.warnings.includes('credentials-in-url') && 'The URL contains credentials (stripped from the copy). '}
            {pkg.warnings.includes('large-context') && 'This context is large. '}
          </span>
        </div>
      )}
    </div>
  )
}
