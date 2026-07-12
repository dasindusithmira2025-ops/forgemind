import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { ChevronDown, Maximize2, Minimize2, MoreHorizontal, RotateCw, Search, Square, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { native } from '../../native/commands'
import { onTerminalOutput } from '../../native/events'
import type { AppSettings, PaneAssignment, TerminalSession } from '../../native/types'
import { providerLabel } from '../../shared/layout'
import type { TerminalAction } from './terminalActions'

interface TerminalPaneProps {
  assignment: PaneAssignment
  session?: TerminalSession
  active: boolean
  maximized: boolean
  settings: AppSettings
  onFocus: () => void
  onMaximize: () => void
  onClose: () => void
  onRestart: () => void
  onStop: () => void
  onMenu: (anchor: HTMLElement) => void
}

export function TerminalPane({ assignment, session, active, maximized, settings, onFocus, onMaximize, onClose, onRestart, onStop, onMenu }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | undefined>(undefined)
  const fitRef = useRef<FitAddon | undefined>(undefined)
  const searchRef = useRef<SearchAddon | undefined>(undefined)
  const sessionRef = useRef<string | undefined>(undefined)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [bell, setBell] = useState(false)
  const [elapsed, setElapsed] = useState('0:00')
  const encoder = useRef(new TextEncoder())
  const sessionId = session?.id
  const sessionProvider = session?.provider
  const sessionStartedAt = session?.startedAt

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
  }, [settings])

  useEffect(() => {
    sessionRef.current = sessionId
    const terminal = terminalRef.current
    if (!terminal || !sessionId || !sessionProvider) return
    terminal.reset()
    terminal.writeln(`\x1b[38;2;127;136;151mForgeMind connected to ${providerLabel(sessionProvider)}\x1b[0m`)
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    let nextSequence = 0
    const pending = new Map<number, Uint8Array>()
    const flush = () => {
      while (pending.has(nextSequence)) {
        terminal.write(pending.get(nextSequence)!)
        pending.delete(nextSequence++)
      }
    }
    void onTerminalOutput((event) => {
      if (event.sessionId !== sessionId || event.sequence < nextSequence) return
      pending.set(event.sequence, new Uint8Array(event.data)); flush()
    }).then((unlisten) => {
      if (cancelled) unlisten(); else unsubscribe = unlisten
      return native.terminalSessionStatus(sessionId)
    }).then((current) => {
      if (cancelled) return
      if (current.outputTail.length > 0) terminal.write(new Uint8Array(current.outputTail))
      nextSequence = current.nextSequence
      for (const sequence of pending.keys()) if (sequence < nextSequence) pending.delete(sequence)
      flush()
    }).catch(() => undefined)
    return () => { cancelled = true; unsubscribe?.() }
  }, [sessionId, sessionProvider])

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
          if (terminal && terminal.cols > 0 && terminal.rows > 0) void native.resizeTerminalSession(sessionId, terminal.cols, terminal.rows)
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
      if (detail.action === 'copy') void navigator.clipboard.writeText(terminal.getSelection() || bufferText(terminal))
      if (detail.action === 'paste') void pasteIntoTerminal(terminal, settings.confirmMultilinePaste)
      if (detail.action === 'select_all') terminal.selectAll()
      if (detail.action === 'clear') terminal.clear()
      if (detail.action === 'focus') terminal.focus()
    }
    window.addEventListener('forgemind:terminal-action', handle)
    return () => window.removeEventListener('forgemind:terminal-action', handle)
  }, [assignment.id, settings.confirmMultilinePaste])

  useEffect(() => {
    if (!sessionStartedAt) return
    const update = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - new Date(sessionStartedAt).getTime()) / 1000))
      setElapsed(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`)
    }
    update(); const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [sessionId, sessionStartedAt])

  return <article className={`terminal-pane ${active ? 'active' : ''} ${maximized ? 'maximized' : ''} ${bell ? 'bell' : ''}`} onMouseDown={onFocus} data-pane-id={assignment.id}>
    <header className="terminal-header">
      <span className={`terminal-status status-${session?.status ?? 'loading'}`} aria-label={session?.status ?? 'starting'} />
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
    <footer className="terminal-footer"><span>{session?.status === 'running' ? `Running ${elapsed}` : session ? `Exited${session.exitCode !== undefined ? ` with code ${session.exitCode}` : ''}` : 'Starting terminal...'}</span><div>{session?.status === 'running' ? <><button onClick={onRestart}><RotateCw size={12} />Restart</button><button onClick={onStop}><Square size={11} />Stop</button></> : <button onClick={onRestart}><RotateCw size={12} />Open fresh session</button>}</div></footer>
  </article>
}

const terminalTheme = { background: '#0a0c10', foreground: '#d8dde7', cursor: '#72a7ff', cursorAccent: '#0a0c10', selectionBackground: '#315f9b78', black: '#161a22', red: '#ef7d7d', green: '#82c99a', yellow: '#d9bf76', blue: '#72a7ff', magenta: '#b99af7', cyan: '#70c4c9', white: '#d8dde7', brightBlack: '#6f7889', brightWhite: '#f2f5fa' }

async function pasteIntoTerminal(terminal: Terminal, confirmMultiline: boolean) {
  const text = await navigator.clipboard.readText()
  if (text.includes('\n') && confirmMultiline && !window.confirm(`Paste ${text.split(/\r?\n/).length} lines into this terminal?`)) return
  terminal.paste(text)
}

function bufferText(terminal: Terminal): string {
  const buffer = terminal.buffer.active
  const lines: string[] = []
  for (let index = 0; index < buffer.length; index += 1) lines.push(buffer.getLine(index)?.translateToString(true) ?? '')
  return lines.join('\n')
}
