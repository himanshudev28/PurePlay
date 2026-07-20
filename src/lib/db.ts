import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Track } from '@/types'

/** key downloads by source+id so the same title from two catalogs can coexist */
export const keyOf = (t: Track) => `${t.source}:${t.id}`

interface DownloadRecord {
  /** always keyOf(track) — the primary key */
  key: string
  track: Track
  size: number
  savedAt: number
}

interface ListenFreeDB extends DBSchema {
  /** metadata for everything the user has downloaded */
  downloads: {
    key: string
    value: DownloadRecord
    indexes: { 'by-date': number }
  }
  /** the actual audio bytes, kept separate so metadata reads stay cheap */
  blobs: {
    key: string
    value: { id: string; blob: Blob; mime: string }
  }
}

let dbPromise: Promise<IDBPDatabase<ListenFreeDB>> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB<ListenFreeDB>('listenfree', 2, {
      upgrade(d, oldVersion) {
        // v1 keyed `downloads` on 'track.id' while every read used keyOf() —
        // so records were written under one key and looked up under another.
        // The stores are a pure cache, so the fix is to drop and recreate.
        if (oldVersion > 0) {
          if (d.objectStoreNames.contains('downloads')) d.deleteObjectStore('downloads')
          if (d.objectStoreNames.contains('blobs')) d.deleteObjectStore('blobs')
        }
        const dl = d.createObjectStore('downloads', { keyPath: 'key' })
        dl.createIndex('by-date', 'savedAt')
        d.createObjectStore('blobs', { keyPath: 'id' })
      },

      // A version change cannot proceed while another tab holds the old
      // connection open. Without these handlers openDB simply never settles —
      // every caller awaits forever, with no error to show. That is the worst
      // possible failure mode: downloads silently do nothing.
      blocked() {
        console.warn('[db] upgrade blocked by another open tab')
      },
      blocking() {
        // we are the stale connection holding up someone else's upgrade
        void dbPromise?.then((d) => d.close())
        dbPromise = null
      },
      terminated() {
        // the browser killed the connection; drop the cache so we reconnect
        dbPromise = null
      },
    })

    // never cache a rejected connection — the next call should be able to retry
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

export async function listDownloads(): Promise<DownloadRecord[]> {
  const d = await db()
  const all = await d.getAllFromIndex('downloads', 'by-date')
  return all.reverse()
}

export async function isDownloaded(track: Track): Promise<boolean> {
  const d = await db()
  return (await d.getKey('downloads', keyOf(track))) !== undefined
}

export async function downloadedIds(): Promise<Set<string>> {
  const d = await db()
  return new Set(await d.getAllKeys('downloads'))
}

/**
 * Streams the audio into IndexedDB, reporting progress. A failed download
 * leaves no partial record — re-running starts clean.
 */
export async function saveDownload(
  track: Track,
  url: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)

  const total = Number(res.headers.get('content-length')) || 0
  const mime = res.headers.get('content-type') || 'audio/mpeg'

  let blob: Blob
  if (res.body && total > 0) {
    const reader = res.body.getReader()
    const chunks: BlobPart[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value as BlobPart)
      received += value.byteLength
      onProgress?.(received / total)
    }
    blob = new Blob(chunks, { type: mime })
  } else {
    // no content-length (chunked) — fall back to a single buffered read
    blob = await res.blob()
    onProgress?.(1)
  }

  const key = keyOf(track)
  const d = await db()
  const tx = d.transaction(['downloads', 'blobs'], 'readwrite')
  await Promise.all([
    tx.objectStore('blobs').put({ id: key, blob, mime }),
    tx.objectStore('downloads').put({ key, track, size: blob.size, savedAt: Date.now() }),
    tx.done,
  ])
}

/** Object URL for an offline track, or null when it isn't cached. */
export async function offlineUrl(track: Track): Promise<string | null> {
  const d = await db()
  const rec = await d.get('blobs', keyOf(track))
  return rec ? URL.createObjectURL(rec.blob) : null
}

export async function removeDownload(track: Track): Promise<void> {
  const key = keyOf(track)
  const d = await db()
  const tx = d.transaction(['downloads', 'blobs'], 'readwrite')
  await Promise.all([
    tx.objectStore('downloads').delete(key),
    tx.objectStore('blobs').delete(key),
    tx.done,
  ])
}

export async function storageUsage(): Promise<{ used: number; quota: number }> {
  if (!navigator.storage?.estimate) return { used: 0, quota: 0 }
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  return { used: usage, quota }
}
