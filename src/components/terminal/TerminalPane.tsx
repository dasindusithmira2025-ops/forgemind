import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ChevronDown, Maximize2, Minimize2, MoreHorizontal, RotateCw, Search, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { native } from '../../native/commands'
import type { AppSettings, PaneAssignment, TerminalSession } from '../../native/types'
import { providerLabel } from '../../shared/layout'
import type { TerminalAction } from './terminalActions'
import { terminalRuntime, useTerminalRuntime } from '../../features/terminals/runtimeStore'

const MAX_RENDER_BATCH_BYTES = 256 * 1024

interface TerminalPaneProps {
  assignment: PaneAssignment
  session?: TerminalSession
  deferred?: boolean
  active: boolean
  maximized: boolean
  settings: AppSettings
  onFocus: () => void
  onMaximize: () => void
  onClose: () => void
  onRestart: () => void
  onStop: () => void
  onMenu: (anchor: HTMLElement) => void
  /** Pointer-down on the header, used by the docking canvas to start a pane drag. */
  onHeaderPointerDown?: (event: ReactPointerEvent) => void
}

export function TerminalPane({ assignment, session, deferred = false, active, maximized, settings, onFocus, onMaximize, onClose, onRestart, onMenu, onHeaderPointerDown }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | undefined>(undefined)
  const fitRef = useRef<FitAddon | undefined>(undefined)
  const searchRef = useRef<SearchAddon | undefined>(undefined)
  const sessionRef = useRef<string | undefined>(undefined)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [bell, setBell] = useState(false)
  const encoder = useRef(new TextEncoder())
  const sessionId = session?.id
  const runtime = useTerminalRuntime(sessionId)
  const currentSession = runtime.session ?? session
  const nextSequence = useRef(0)
  const historyReady = useRef(false)
  const writeInFlight = useRef(false)
  const replayGeneration = useRef(0)
  const lastNativeSize = useRef<{ sessionId: string; cols: number; rows: number } | undefined>(undefined)
  const [replayVersion, setReplayVersion] = useState(0)

  const writeTerminal = (data: Uint8Array): Promise<void> => {
    const terminal = terminalRef.current
    if (!terminal || data.byteLength === 0) return Promise.resolve()
    return new Promise<void>((resolve) => terminal.write(data, resolve))
  }

  useEffect(() => {
    if (!containerRef.current || terminalRef.current) return
    const fit = new FitAddon()
    const search = new SearchAddon()
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: settings.cursorStyle,
      fontFamily: settings.terminalFontFamily,
      fontSize: settings.terminalFontSize,
      lineHeight: settings.terminalLineHeight,
      scrollback: settings.scrollbackSize,
      theme: terminalTheme,
    })
    terminal.loadAddon(fit); terminal.loadAddon(search); terminal.loadAddon(new WebLinksAddon())
    terminal.open(containerRef.current)
    terminalRef.current = terminal; fitRef.current = fit; searchRef.current = search
    const input = terminal.onData((data) => {
      const id = sessionRef.current
      if (id) void native.writeTerminalInput(id, Array.from(encoder.current.encode(data)))
    })
    const bellDisposable = terminal.onBell(() => { setBell(true); window.setTimeout(() => setBell(false), 180) })
    if (settings.copyOnSelect) terminal.onSelectionChange(() => { const selection = terminal.getSelection(); if (selection) void navigator.clipboard.writeText(selection) })
    requestAnimationFrame(() => { try { fit.fit() } catch { /* Hidden panes are fitted when visible. */ } })
    return () => {
      input.dispose(); bellDisposable.dispose(); terminal.dispose()
      terminalRef.current = undefined; fitRef.current = undefined; searchRef.current = undefined
    }
    // xterm is created once for the lifetime of the pane.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.fontFamily = settings.terminalFontFamily
    terminal.options.fontSize = settings.terminalFontSize
    terminal.options.lineHeight = settings.terminalLineHeight
    terminal.options.cursorStyle = settings.cursorStyle
    terminal.options.scrollback = settings.scrollbackSize
    requestAnimationFrame(() => fitRef.current?.fit())
  }, [settings.cursorStyle, settings.scrollbackSize, settings.terminalFontFamily, settings.terminalFontSize, settings.terminalLineHeight])

  useEffect(() => {
    sessionRef.current = sessionId
    const terminal = terminalRef.current
    if (!terminal || !sessionId) return
    terminal.reset()
    const generation = ++replayGeneration.current
    let cancelled = false
    historyReady.current = false
    writeInFlight.current = true
    nextSequence.current = 0
    void native.terminalSessionStatus(sessionId).then(async (current) => {
      if (cancelled || generation !== replayGeneration.current) return
      await writeTerminal(new Uint8Array(current.outputTail))
      if (cancelled || generation !== replayGeneration.current) return
      nextSequence.current = current.nextSequence
      historyReady.current = true
      terminalRuntime.acknowledge(sessionId, current.nextSequence - 1)
      setReplayVersion((value) => value + 1)
    }).catch(() => {
      if (cancelled || generation !== replayGeneration.current) return
      // A transient status-replay failure must not permanently block subsequent live output.
      nextSequence.current = terminalRuntime.getSessionSnapshot(sessionId).chunks[0]?.sequence ?? 0
      historyReady.current = true
      setReplayVersion((value) => value + 1)
    }).finally(() => {
      if (!cancelled && generation === replayGeneration.current) writeInFlight.current = false
    })
    return () => {
      cancelled = true
      replayGeneration.current += 1
      historyReady.current = false
      writeInFlight.current = false
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || !historyReady.current || writeInFlight.current) return

    // If the bounded renderer queue had to evict output while xterm was busy, replay the
    // authoritative native tail. Waiting forever for an evicted sequence is what previously
    // made a noisy terminal appear frozen even though its PTY was still healthy.
    if (runtime.droppedThroughSequence !== undefined && runtime.droppedThroughSequence >= nextSequence.current) {
      const generation = ++replayGeneration.current
      const fallbackSequence = runtime.chunks[0]?.sequence ?? nextSequence.current
      historyReady.current = false
      writeInFlight.current = true
      void native.terminalSessionStatus(sessionId).then(async (current) => {
        if (generation !== replayGeneration.current || sessionRef.current !== sessionId) return
        terminalRef.current?.reset()
        await writeTerminal(new Uint8Array(current.outputTail))
        if (generation !== replayGeneration.current || sessionRef.current !== sessionId) return
        nextSequence.current = current.nextSequence
        terminalRuntime.acknowledge(sessionId, current.nextSequence - 1)
        historyReady.current = true
      }).catch(() => {
        if (generation !== replayGeneration.current || sessionRef.current !== sessionId) return
        nextSequence.current = fallbackSequence
        historyReady.current = true
      }).finally(() => {
        if (generation === replayGeneration.current && sessionRef.current === sessionId) {
          writeInFlight.current = false
          setReplayVersion((value) => value + 1)
        }
      })
      return
    }

    const ordered = runtime.chunks
      .filter((chunk) => chunk.sequence >= nextSequence.current)
    const contiguous = [] as typeof ordered
    let bytes = 0
    for (const chunk of ordered) {
      if (chunk.sequence !== nextSequence.current) break
      if (contiguous.length > 0 && bytes + chunk.data.byteLength > MAX_RENDER_BATCH_BYTES) break
      contiguous.push(chunk)
      bytes += chunk.data.byteLength
      nextSequence.current += 1
    }
    if (contiguous.length === 0) return
    const payload = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of contiguous) {
      payload.set(chunk.data, offset)
      offset += chunk.data.byteLength
    }
    const throughSequence = contiguous[contiguous.length - 1].sequence
    writeInFlight.current = true
    void writeTerminal(payload).then(() => {
      if (sessionRef.current === sessionId) terminalRuntime.acknowledge(sessionId, throughSequence)
    }).finally(() => {
      if (sessionRef.current === sessionId) {
        writeInFlight.current = false
        setReplayVersion((value) => value + 1)
      }
    })
  }, [runtime.outputVersion, runtime.chunks, runtime.droppedThroughSequence, replayVersion, sessionId])

  useEffect(() => {
    const target = containerRef.current
    if (!target || !sessionId) return
    let timer = 0
    const resize = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        try {
          fitRef.current?.fit()
          const terminal = terminalRef.current
          if (terminal && terminal.cols > 0 && terminal.rows > 0) {
            const previous = lastNativeSize.current
            if (!previous || previous.sessionId !== sessionId || previous.cols !== terminal.cols || previous.rows !== terminal.rows) {
              lastNativeSize.current = { sessionId, cols: terminal.cols, rows: terminal.rows }
              void native.resizeTerminalSession(sessionId, terminal.cols, terminal.rows)
            }
          }
        } catch { /* The pane may be temporarily hidden during layout changes. */ }
      }, 55)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(target); resize()
    return () => { observer.disconnect(); window.clearTimeout(timer) }
  }, [sessionId, maximized])

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ paneId: string; action: TerminalAction }>).detail
      if (detail.paneId !== assignment.id) return
      const terminal = terminalRef.current
      if (!terminal) return
      if (detail.action === 'search') setSearchOpen(true)
      if (detail.action === 'copy') void copyTerminalOutput(terminal)
      if (detail.action === 'paste') void pasteIntoTerminal(terminal, settings.confirmMultilinePaste)
      if (detail.action === 'select_all') terminal.selectAll()
      if (detail.action === 'clear') terminal.clear()
      if (detail.action === 'focus') terminal.focus()
    }
    window.addEventListener('forgemind:terminal-action', handle)
    return () => window.removeEventListener('forgemind:terminal-action', handle)
  }, [assignment.id, settings.confirmMultilinePaste])

  return <article className={`terminal-pane ${active ? 'active' : ''} ${maximized ? 'maximized' : ''} ${bell ? 'bell' : ''}`} onMouseDown={onFocus} data-pane-id={assignment.id}>
    <header className={`terminal-header ${onHeaderPointerDown ? 'draggable' : ''}`} onPointerDown={onHeaderPointerDown}>
      <span className={`terminal-status status-${currentSession?.status ?? 'loading'}`} aria-label={currentSession?.status ?? 'starting'} />
      <div className="terminal-title"><strong>{assignment.title}</strong><span>{providerLabel(assignment.provider)}</span></div>
      <span className="terminal-path" title={assignment.workingDirectory}>{assignment.workingDirectory}</span>
      <div className="terminal-controls">
        <Button variant="ghost" icon={<Search size={14} />} aria-label="Search terminal" onClick={() => setSearchOpen(true)} />
        <Button variant="ghost" icon={maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />} aria-label={maximized ? 'Restore pane' : 'Maximize pane'} onClick={onMaximize} />
        <Button variant="ghost" icon={<MoreHorizontal size={15} />} aria-label="Pane menu" onClick={(event) => onMenu(event.currentTarget)} />
        <Button variant="ghost" icon={<X size={15} />} aria-label="Close pane" onClick={onClose} />
      </div>
    </header>
    {searchOpen && <div className="terminal-search"><input autoFocus aria-label="Search terminal scrollback" value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); searchRef.current?.findNext(event.target.value, { caseSensitive }) }} onKeyDown={(event) => { if (event.key === 'Enter') searchRef.current?.findNext(searchTerm, { caseSensitive }); if (event.key === 'Escape') setSearchOpen(false) }} placeholder="Find in terminal" /><button className={caseSensitive ? 'enabled' : ''} title="Case sensitive" onClick={() => setCaseSensitive((value) => !value)}>Aa</button><Button variant="ghost" icon={<ChevronDown className="rotate-180" size={14} />} aria-label="Previous match" onClick={() => searchRef.current?.findPrevious(searchTerm, { caseSensitive })} /><Button variant="ghost" icon={<ChevronDown size={14} />} aria-label="Next match" onClick={() => searchRef.current?.findNext(searchTerm, { caseSensitive })} /><Button variant="ghost" icon={<X size={14} />} aria-label="Close search" onClick={() => setSearchOpen(false)} /></div>}
    <div className="xterm-host" ref={containerRef} />
    {!currentSession && !deferred && <div className="terminal-recovery compact"><span>Starting terminal…</span></div>}
    {!currentSession && deferred && <div className="terminal-recovery"><strong>Deferred by restoration budget</strong><span>The Pane remains in the saved layout and can be resumed when needed.</span><button onClick={onRestart}><RotateCw size={12} />Resume Pane</button></div>}
    {currentSession && currentSession.status !== 'running' && <div className="terminal-recovery"><strong>{terminalStateTitle(currentSession)}</strong><span>{terminalStateDetail(currentSession)}</span><button onClick={onRestart}><RotateCw size={12} />Open fresh session</button></div>}
  </article>
}

const terminalTheme = { background: '#0a0c10', foreground: '#d8dde7', cursor: '#72a7ff', cursorAccent: '#0a0c10', selectionBackground: '#315f9b78', black: '#161a22', red: '#ef7d7d', green: '#82c99a', yellow: '#d9bf76', blue: '#72a7ff', magenta: '#b99af7', cyan: '#70c4c9', white: '#d8dde7', brightBlack: '#6f7889', brightWhite: '#f2f5fa' }

async function pasteIntoTerminal(terminal: Terminal, confirmMultiline: boolean) {
  const text = await navigator.clipboard.readText()
  if (text.includes('\n') && confirmMultiline && !window.confirm(`Paste ${text.split(/\r?\n/).length} lines into this terminal?`)) return
  terminal.paste(text)
}

async function copyTerminalOutput(terminal: Terminal) {
  const selection = terminal.getSelection()
  if (selection) {
    await navigator.clipboard.writeText(selection)
    return
  }
  const buffer = terminal.buffer.active
  const lines: string[] = []
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) ?? '')
    // Very large scrollback buffers should not monopolize the renderer while being copied.
    if (index > 0 && index % 500 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  await navigator.clipboard.writeText(lines.join('\n'))
}

function terminalStateTitle(session: TerminalSession) {
  if (session.status === 'disconnected') return 'Previous process is not running'
  if (session.status === 'failed') return 'Terminal failed to start'
  return session.exitCode === undefined ? 'Terminal exited' : `Terminal exited with code ${session.exitCode}`
}

function terminalStateDetail(session: TerminalSession) {
  if (session.droppedOutputBytes > 0) return `${session.droppedOutputBytes.toLocaleString()} output bytes were dropped under backpressure.`
  if (session.status === 'disconnected') return 'Historical output is preserved. Restart the assigned provider or open a fresh shell.'
  return 'Output remains available above.'
}
