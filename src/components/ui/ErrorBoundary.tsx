import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './Button'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error?: Error
}

/**
 * Top-level safety net. A render-time exception in any screen would otherwise blank the
 * whole window with no way out; here we show the failure and offer a reload so the user
 * can recover without killing the process (native terminals keep running until exit).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the devtools/console; picked up by the native log target in packaged builds.
    console.error('ForgeMind interface error:', error, info.componentStack)
  }

  private reset = () => {
    this.setState({ error: undefined })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="centered-error" role="alert">
        <div className="boundary-card">
          <h1>Something went wrong</h1>
          <p>The ForgeMind interface hit an unexpected error. Your saved workspaces are safe.</p>
          <pre className="boundary-detail">{this.state.error.message}</pre>
          <div className="boundary-actions">
            <Button variant="primary" onClick={() => window.location.reload()}>Reload ForgeMind</Button>
            <Button variant="ghost" onClick={this.reset}>Dismiss</Button>
          </div>
        </div>
      </main>
    )
  }
}
