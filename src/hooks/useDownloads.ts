import { useCallback, useEffect, useRef, useState } from 'react'
import type { Track } from '@/types'
import { sourceFor } from '@/services'
import { isDownloaded, saveDownload, removeDownload, keyOf } from '@/lib/db'
import { saveTrackToDevice } from '@/lib/saveFile'

type Status = 'idle' | 'downloading' | 'done' | 'error'

/** The separate, visible-to-the-device save. See `saveTrackToDevice`. */
type SaveStatus = 'idle' | 'saving' | 'saved' | 'shared' | 'error'

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
  const controller = useRef<AbortController | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (resetTimer.current) clearTimeout(resetTimer.current)
      // stop the transfer, not just the progress UI — without this a multi-MB
      // fetch kept running to completion after the row unmounted
      controller.current?.abort()
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
    controller.current = new AbortController()
    try {
      const src = sourceFor(track.source)
      // downloadUrl when the adapter distinguishes them (see MusicSource docs)
      const url = await (src.downloadUrl ? src.downloadUrl(track) : src.streamUrl(track))
      await saveDownload(track, url, (p) => mounted.current && setProgress(p), controller.current.signal)
      if (mounted.current) setStatus('done')
      notify()
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
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

  /*
    Saving a file to the device, which is a different thing from the offline
    copy above: that one lives in IndexedDB and only this app can see it, and
    people reasonably read a download button as "put the song on my phone".
  */
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const saveTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
  }, [])

  const saveToDevice = useCallback(async () => {
    if (!track || !supported) return
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    setSaveStatus('saving')
    try {
      const how = await saveTrackToDevice(track)
      if (!mounted.current) return
      setSaveStatus(how === 'shared' ? 'shared' : 'saved')
    } catch (e) {
      console.error('[save-to-device]', track.title, e)
      if (!mounted.current) return
      setError(e instanceof Error ? e.message : 'Could not save the file')
      setSaveStatus('error')
    } finally {
      // The result label is transient: the row goes back to offering the save.
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null
        if (mounted.current) setSaveStatus('idle')
      }, 3000)
    }
  }, [track, supported])

  const remove = useCallback(async () => {
    if (!track) return
    await removeDownload(track)
    if (mounted.current) setStatus('idle')
    notify()
  }, [track])

  return { status, progress, error, download, remove, supported, key, saveStatus, saveToDevice }
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
