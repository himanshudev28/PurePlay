import type { Track } from '@/types'
import { sourceFor } from '@/services'
import { offlineBlob } from '@/lib/db'

/**
 * Saving a song as a real file on the device.
 *
 * "Download for offline" writes the audio into IndexedDB so the app can play
 * it with no network — the right thing for a PWA, and *not* what most people
 * mean when they press a download button. That copy is invisible to the phone's
 * file manager, its music app and its Downloads screen, so the song appeared to
 * download into nowhere.
 *
 * This is the other half: hand the bytes to the browser's own download
 * machinery, so the file lands wherever the device puts downloads.
 */

/** Extension that matches what the server actually sent. */
function extensionFor(mime: string): string {
  const type = mime.split(';')[0].trim().toLowerCase()
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3'
  if (type.includes('mp4') || type.includes('m4a')) return 'm4a'
  if (type.includes('aac')) return 'aac'
  if (type.includes('opus')) return 'opus'
  if (type.includes('ogg')) return 'ogg'
  if (type.includes('webm')) return 'webm'
  if (type.includes('wav')) return 'wav'
  if (type.includes('flac')) return 'flac'
  return 'mp3'
}

/**
 * A filename every filesystem will accept.
 *
 * Slashes, colons and quotes are illegal on one platform or another, and a
 * catalog title carries all three: `Kesariya (From "Brahmastra")`. The length
 * cap keeps Windows' 255-character path limit out of reach.
 */
function safeFilename(track: Track, ext: string): string {
  const cleaned = [...`${track.artist} - ${track.title}`]
    // control characters break some filesystems and are invisible in the rest
    .filter((c) => c >= ' ' && c !== '\u007f')
    .join('')
    // Quotes vanish rather than becoming spaces: a title like
    // `Kesariya (From "Brahmastra")` should not save as `(From Brahmastra )`.
    .replace(/["']/g, '')
    .replace(/[\\/:*?<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return `${cleaned || 'track'}.${ext}`
}

/**
 * iOS ignores an anchor's `download` attribute in some standalone contexts, so
 * the share sheet is the only route to the Files app there.
 */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iP(hone|od|ad)/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; a touch screen is what gives it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function saveViaAnchor(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  // Firefox only honours a programmatic click on an anchor that is in the DOM.
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking straight away can cancel the transfer in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Write `track` to the device as a file.
 *
 * Reuses the offline copy when there is one — those bytes are already on the
 * device, and re-fetching a song the listener has downloaded once spends their
 * data for nothing.
 *
 * Returns how it was saved, so the caller can say the right thing: a share
 * sheet sends the file somewhere the listener picks, a download just saves it.
 */
export async function saveTrackToDevice(
  track: Track,
  signal?: AbortSignal,
): Promise<'downloaded' | 'shared'> {
  const cached = await offlineBlob(track)

  let blob: Blob
  let mime: string
  if (cached) {
    blob = cached.blob
    mime = cached.mime || cached.blob.type || 'audio/mpeg'
  } else {
    const src = sourceFor(track.source)
    if (!src.downloadable) throw new Error(`${src.name} tracks can't be saved as files`)
    const url = await (src.downloadUrl ? src.downloadUrl(track) : src.streamUrl(track))
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(`Couldn't fetch the audio (HTTP ${res.status})`)
    mime = res.headers.get('content-type') || 'audio/mpeg'
    blob = await res.blob()
  }

  const filename = safeFilename(track, extensionFor(mime))

  if (isIOS() && typeof navigator.share === 'function') {
    const file = new File([blob], filename, { type: mime })
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: track.title })
        return 'shared'
      } catch (e) {
        // A cancelled sheet is a decision, not a failure — don't then force a
        // download the listener just declined.
        if (e instanceof DOMException && e.name === 'AbortError') return 'shared'
        // Anything else (the gesture expiring, an unsupported type) falls
        // through to the ordinary download below.
      }
    }
  }

  saveViaAnchor(blob, filename)
  return 'downloaded'
}
