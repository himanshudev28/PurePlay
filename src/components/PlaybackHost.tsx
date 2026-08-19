import { useEffect, useRef } from 'react'
import clsx from 'clsx'
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
  const docked = usePlayer((s) => s.videoDocked)
  const fullPlayerOpen = usePlayer((s) => s.fullPlayerOpen)
  const barVisible = usePlayer((s) => s.playerViewMode === 'bar')

  /*
    Where the frame sits.

    It is one node that never moves in the DOM — re-parenting an iframe reloads
    it, which would restart the song — so every placement below is a CSS change
    on that same element.

      docked  the full player is showing the video: fill the stage, above the
              overlay. The overlay is z-50 and the frame used to be z-50 too, so
              it painted underneath — pressing "Video" appeared to do nothing.
      float   a corner thumbnail while the user is elsewhere in the app, sitting
              clear of the player bar and the mobile tab bar instead of on top
              of them, and below the full player rather than punching through it.
      hidden  no video track loaded.

    YouTube's Terms of Service require the player stay visible during playback,
    so `hidden` only ever applies when no YouTube track is loaded at all.
  */
  const floatOffset = barVisible
    ? 'bottom-[calc(178px+env(safe-area-inset-bottom,0px))] sm:bottom-[116px]'
    : 'bottom-[calc(92px+env(safe-area-inset-bottom,0px))] sm:bottom-6'
  const placement = !videoActive
    ? 'pointer-events-none fixed h-0 w-0 overflow-hidden opacity-0'
    : docked && fullPlayerOpen
      ? 'fixed left-1/2 top-1/2 z-[60] aspect-video w-[min(92vw,780px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/15 bg-black shadow-2xl'
      : clsx(
          'fixed right-[max(0.75rem,env(safe-area-inset-right,0px))] z-40 aspect-video overflow-hidden border border-ink-700 bg-black shadow-2xl sm:right-[max(1rem,env(safe-area-inset-right,0px))]',
          floatOffset,
          expanded
            ? 'w-[min(356px,calc(100vw-1.5rem))] rounded-xl sm:w-[390px]'
            : 'w-[min(152px,calc(100vw-1.5rem))] rounded-lg',
        )

  return (
    <>
      <audio ref={audioRef} preload="metadata" />

      {/* Always mounted, never unmounted — remounting destroys the player. */}
      <div aria-hidden={!videoActive} className={placement}>
        <div ref={videoRef} className="h-full w-full" />
      </div>
    </>
  )
}
