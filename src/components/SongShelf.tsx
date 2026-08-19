import type { Track } from '@/types'
import { useIsCompact } from '@/hooks/useMediaQuery'
import { CompactTrackRow } from './CompactTrackRow'
import { TrackCard } from './Cards'
import { Skeleton } from './ui'

/** Rows per column in the phone layout — four fits a shelf under 260px tall. */
const ROWS = 4

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * The contents of a song shelf, in whichever form the width can afford.
 *
 * On a desktop the square cards are worth their space. On a phone one card is
 * ~212px tall and the row shows barely two of them, so nine shelves of songs
 * became a very long scroll that displayed almost nothing — the artwork was
 * eating the page. At phone widths this switches to the same dense line used
 * by Quick picks, stacked four-deep into columns that page sideways: same
 * height as one card, four times the songs, and the swipe gesture the shelf
 * already had.
 *
 * Renders as direct children of a `.shelf` flex scroller in both modes.
 */
export function SongShelfItems({
  tracks,
  queue,
  keyPrefix,
  loading,
  skeletons = 8,
}: {
  tracks: Track[]
  /** Playback queue, when the shelf plays into a wider list than it shows. */
  queue?: Track[]
  /** Distinguishes the same track appearing on more than one shelf. */
  keyPrefix?: string
  loading?: boolean
  skeletons?: number
}) {
  const compact = useIsCompact()
  const list = queue ?? tracks
  const key = (t: Track) => `${keyPrefix ?? ''}${t.source}-${t.id}`

  if (loading && !tracks.length) {
    return compact ? (
      <>
        {Array.from({ length: 2 }, (_, i) => (
          <Skeleton key={i} className="h-[248px] w-[86vw] max-w-[420px] shrink-0" />
        ))}
      </>
    ) : (
      <>
        {Array.from({ length: skeletons }, (_, i) => (
          <Skeleton key={i} className="h-[212px] w-[152px] shrink-0 sm:w-[168px]" />
        ))}
      </>
    )
  }

  if (compact) {
    return (
      <>
        {chunk(tracks, ROWS).map((column) => (
          // Keyed by its first track so re-ordering a shelf doesn't reshuffle rows.
          <div key={key(column[0])} className="w-[86vw] max-w-[420px] shrink-0 space-y-0.5">
            {column.map((t) => (
              <CompactTrackRow key={key(t)} track={t} queue={list} />
            ))}
          </div>
        ))}
      </>
    )
  }

  return (
    <>
      {tracks.map((t) => (
        <TrackCard key={key(t)} track={t} queue={list} />
      ))}
    </>
  )
}
