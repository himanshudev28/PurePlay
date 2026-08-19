import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw, Home } from 'lucide-react'
import { Button } from './ui'

/**
 * Anything thrown while rendering a page used to unmount the whole React tree
 * and leave a white screen — no message, no way back, and playback gone with
 * it. This catches the throw, keeps the rest of the app mounted, and offers the
 * two things that actually recover: retry this page, or go home.
 *
 * Scoped around the routes rather than the whole app on purpose: the player,
 * the queue and the audio element live outside it, so a broken page never
 * stops the music.
 */
interface Props {
  children: ReactNode
  /** Changing this resets the boundary — pass the route key so navigating away
   *  from a broken page clears the error instead of stranding the user. */
  resetKey?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No telemetry backend to ship this to, but the stack in the console is the
    // difference between "it went blank" and a reproducible bug report.
    console.error('[ui] render failed:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-2xl border border-ink-800 bg-ink-900/60 px-6 py-14 text-center"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-dim text-accent">
          <AlertTriangle size={22} />
        </span>
        <div className="space-y-1.5">
          <p className="font-display text-lg font-bold text-white">This page hit a snag</p>
          <p className="text-sm text-ink-400">
            The rest of the app is fine — your music is still playing. Try loading this page again.
          </p>
          {/* The message is the one clue a user can pass on in a bug report. */}
          <p className="pt-1 font-mono text-[11px] break-words text-ink-400">{error.message}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="accent" size="sm" onClick={() => this.setState({ error: null })}>
            <RotateCcw size={14} />
            Try again
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              this.setState({ error: null })
              window.location.assign('/')
            }}
          >
            <Home size={14} />
            Go home
          </Button>
        </div>
      </div>
    )
  }
}
