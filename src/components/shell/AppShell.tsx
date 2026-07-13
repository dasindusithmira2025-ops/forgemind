import type { ReactNode } from 'react'

/**
 * The workspace shell frame: title bar, a single canonical sidebar that owns its own width,
 * the terminal canvas, and a status bar. There is no activity rail — Project/Workspace
 * navigation lives entirely in the sidebar.
 */
export function AppShell({
  titleBar,
  sidebar,
  canvas,
  statusBar,
  sidebarOpen = true,
  className = '',
  children,
}: {
  titleBar: ReactNode
  sidebar?: ReactNode
  canvas: ReactNode
  statusBar?: ReactNode
  sidebarOpen?: boolean
  className?: string
  children?: ReactNode
}) {
  return (
    <main className={`app-shell ${className}`}>
      <header className="app-titlebar">{titleBar}</header>
      <div className="app-workarea">
        {sidebarOpen && sidebar}
        <section className="app-canvas">{canvas}</section>
      </div>
      {statusBar && <footer className="app-statusbar">{statusBar}</footer>}
      {children}
    </main>
  )
}
