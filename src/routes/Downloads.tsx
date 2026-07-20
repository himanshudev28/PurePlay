import { useCallback, useEffect, useState } from 'react'
import { HardDriveDownload, Play, WifiOff } from 'lucide-react'
import type { Track } from '@/types'
import { listDownloads, storageUsage } from '@/lib/db'
import { usePlayer } from '@/store/player'
import { TrackRow } from '@/components/TrackRow'
import { EmptyState, Button, Skeleton, ErrorNote } from '@/components/ui'
import { formatBytes } from '@/lib/format'

export default function Downloads() {
  const [items, setItems] = useState<{ track: Track; size: number; savedAt: number }[]>([])
  const [usage, setUsage] = useState({ used: 0, quota: 0 })
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(navigator.onLine)
  const playQueue = usePlayer((s) => s.playQueue)

  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void Promise.all([listDownloads(), storageUsage()])
      .then(([list, u]) => {
        setItems(list)
        setUsage(u)
        setError(null)
      })
      // IndexedDB can be unavailable (private windows, blocked storage). Without
      // this the skeleton spins forever with only a console rejection.
      .catch((e: Error) => setError(e.message || 'Could not read offline storage'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    refresh()
    // re-check whenever a download completes elsewhere in the app
    const onFocus = () => refresh()
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [refresh])

  const tracks = items.map((i) => i.track)
  const totalSize = items.reduce((sum, i) => sum + i.size, 0)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-white">
            <HardDriveDownload size={26} className="text-accent" />
            Downloads
          </h1>
          <p className="mt-1 text-sm text-ink-400">
            {items.length} songs · {formatBytes(totalSize)}
            {usage.quota > 0 && ` · ${formatBytes(usage.quota - usage.used)} free`}
          </p>
        </div>
        {tracks.length > 0 && (
          <Button variant="accent" onClick={() => void playQueue(tracks, 0)}>
            <Play size={15} fill="currentColor" />
            Play offline
          </Button>
        )}
      </header>

      {!online && (
        <div className="flex items-center gap-2 rounded-xl border border-accent-dim bg-accent-dim/30 px-4 py-3 text-sm text-accent-soft">
          <WifiOff size={15} />
          You're offline — only downloaded songs will play.
        </div>
      )}

      {error && <ErrorNote message={error} onRetry={refresh} />}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<HardDriveDownload size={30} />}
          title="Nothing downloaded"
          hint="Hit the download icon on any track to keep it on this device. Downloads work without a connection."
        />
      ) : (
        <div className="space-y-0.5">
          {items.map(({ track }, i) => (
            <TrackRow key={`${track.source}-${track.id}`} track={track} index={i} queue={tracks} />
          ))}
        </div>
      )}
    </div>
  )
}
