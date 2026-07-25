import { useEffect, useRef } from 'react'
import type { Track } from '@/types'
import { usePlayer, syncMediaPosition } from '@/store/player'
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
      onTime: (position: number, duration: number) => {
        sync({ position, duration })
        // keep the OS lock-screen scrubber in step with playback
        syncMediaPosition(position, duration)
      },
      onEnded: () => void next(true),
      onError: (message: string) => sync({ error: message, playing: false, loading: false }),
      onLoading: (loading: boolean) => sync({ loading }),
    }

    // both engines report into the same store
    engineFor('audius')?.attach(callbacks)
    engineFor('youtube')?.attach(callbacks)
  }, [sync, next])

  // Record plays into "recently played" once a track actually starts. Keyed on
  // the track, not the playing flag alone — otherwise every pause/resume
  // re-pushed the same track to the top of the list.
  const current = usePlayer((s) => s.current)
  const playing = usePlayer((s) => s.playing)
  const lastRecorded = useRef<Track | null>(null)
  useEffect(() => {
    if (current && playing && lastRecorded.current !== current) {
      lastRecorded.current = current
      pushRecent(current)
    }
  }, [current, playing, pushRecent])

  // keep the OS lock screen / media keys showing the right play-pause state
  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = current ? (playing ? 'playing' : 'paused') : 'none'
    }
  }, [current, playing])

  // keyboard transport controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return
      // Space on a focused button/link must activate that control, not also
      // toggle playback underneath it
      if (e.code === 'Space' && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SELECT')) return

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
