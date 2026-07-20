import { useEffect, useRef } from 'react'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { initEngines, engineFor } from '@/playback'

/**
 * Owns the DOM both engines drive, mounted once for the app's lifetime.
 *
 * The YouTube frame lives here but is *portaled visually* by PlayerBar: the
 * node must stay mounted (destroying it tears down the player mid-track), so
 * it is positioned by CSS rather than moved between parents.
 */
export function PlaybackHost() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const videoRef = useRef<HTMLDivElement>(null)
  const ready = useRef(false)

  const sync = usePlayer((s) => s._sync)
  const next = usePlayer((s) => s.next)
  const pushRecent = useLibrary((s) => s.pushRecent)

  useEffect(() => {
    if (ready.current || !audioRef.current || !videoRef.current) return
    ready.current = true

    initEngines(audioRef.current, videoRef.current)

    const callbacks = {
      onPlay: () => sync({ playing: true }),
      onPause: () => sync({ playing: false }),
      onTime: (position: number, duration: number) => sync({ position, duration }),
      onEnded: () => void next(true),
      onError: (message: string) => sync({ error: message, playing: false, loading: false }),
      onLoading: (loading: boolean) => sync({ loading }),
    }

    // both engines report into the same store
    engineFor('audius')?.attach(callbacks)
    engineFor('youtube')?.attach(callbacks)
  }, [sync, next])

  // record plays into "recently played" once a track actually starts
  const current = usePlayer((s) => s.current)
  const playing = usePlayer((s) => s.playing)
  useEffect(() => {
    if (current && playing) pushRecent(current)
  }, [current, playing, pushRecent])

  // keyboard transport controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return
      // the YouTube iframe handles its own keys once focused
      if (el.tagName === 'IFRAME') return

      const p = usePlayer.getState()
      if (e.code === 'Space') {
        e.preventDefault()
        p.toggle()
      } else if (e.code === 'ArrowRight' && e.shiftKey) {
        void p.next()
      } else if (e.code === 'ArrowLeft' && e.shiftKey) {
        void p.prev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const videoActive = usePlayer((s) => s.videoActive)
  const expanded = usePlayer((s) => s.videoExpanded)

  return (
    <>
      <audio ref={audioRef} preload="metadata" />

      {/*
        Always mounted, never unmounted — remounting would destroy the YouTube
        player. Visibility and size are driven by state instead.

        YouTube's Terms of Service require the player stay visible during
        playback, so the "hidden" case only applies when no YouTube track is
        loaded at all.
      */}
      <div
        aria-hidden={!videoActive}
        className={
          videoActive
            ? expanded
              ? 'fixed right-4 bottom-[104px] z-50 h-[200px] w-[356px] overflow-hidden rounded-xl border border-ink-700 bg-black shadow-2xl sm:h-[220px] sm:w-[390px]'
              : 'fixed right-4 bottom-[104px] z-50 h-[86px] w-[152px] overflow-hidden rounded-lg border border-ink-700 bg-black shadow-2xl'
            : 'pointer-events-none fixed h-0 w-0 overflow-hidden opacity-0'
        }
      >
        <div ref={videoRef} className="h-full w-full" />
      </div>
    </>
  )
}
