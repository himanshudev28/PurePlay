import { useCallback, useEffect, useRef, useState } from 'react'
import type { Track } from '@/types'
import { sourceFor } from '@/services'
import { isDownloaded, saveDownload, removeDownload, keyOf } from '@/lib/db'

type Status = 'idle' | 'downloading' | 'done' | 'error'

/**
 * IndexedDB is not reactive, so a tiny pub/sub keeps every row showing the same
 * download state without each one re-querying the database.
 */
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())

/** Tracks with a download in flight, so a second row for the same track can't start another. */
const inFlight = new Set<string>()

export function useDownloads(track: Track | null) {
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const supported = track ? sourceFor(track.source).downloadable : false
  const key = track ? keyOf(track) : ''

  const resetTimer = useRef<number | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  const refresh = useCallback(() => {
    if (!track) return
    void isDownloaded(track).then((has) => {
      if (!mounted.current) return
      // never stomp on a download that's actively running
      setStatus((s) => (s === 'downloading' ? s : has ? 'done' : 'idle'))
    })
  }, [track])

  useEffect(() => {
    refresh()
    listeners.add(refresh)
    return () => {
      listeners.delete(refresh)
    }
  }, [refresh])

  const download = useCallback(async () => {
    // `track` is nullable (the full player renders before anything is loaded),
    // so narrow it here rather than asserting further down.
    if (!track || !supported || inFlight.has(key)) return

    // a pending "error -> idle" reset must not fire mid-retry and make the row
    // look fresh while a fetch is still running
    if (resetTimer.current) {
      clearTimeout(resetTimer.current)
      resetTimer.current = null
    }

    inFlight.add(key)
    setStatus('downloading')
    setProgress(0)
    try {
      const src = sourceFor(track.source)
      // downloadUrl when the adapter distinguishes them (see MusicSource docs)
      const url = await (src.downloadUrl ? src.downloadUrl(track) : src.streamUrl(track))
      await saveDownload(track, url, (p) => mounted.current && setProgress(p))
      if (mounted.current) setStatus('done')
      notify()
    } catch (e) {
      // Swallowing this entirely makes a failed download indistinguishable from
      // one that never started — surface it rather than failing invisibly.
      const message = e instanceof Error ? e.message : 'Download failed'
      console.error('[download]', track.title, message)
      if (!mounted.current) return
      setError(message)
      setStatus('error')
      resetTimer.current = window.setTimeout(() => {
        resetTimer.current = null
        if (mounted.current) {
          setStatus('idle')
          setError(null)
        }
      }, 2500)
    } finally {
      inFlight.delete(key)
    }
  }, [track, supported, key])

  const remove = useCallback(async () => {
    if (!track) return
    await removeDownload(track)
    if (mounted.current) setStatus('idle')
    notify()
  }, [track])

  return { status, progress, error, download, remove, supported, key }
}

export { notify as notifyDownloadsChanged }

/**
 * Subscribe to download add/remove events. The Downloads page previously only
 * re-read IndexedDB on window focus, so deleting a track from its own list left
 * the row (and the storage totals) on screen until you tabbed away and back.
 */
export function subscribeDownloads(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
