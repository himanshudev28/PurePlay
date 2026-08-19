import type { Track } from '@/types'
import { CompactTrackRow } from './CompactTrackRow'
import { Skeleton } from './ui'

/**
 * The playable block that opens the home page.
 *
 * The song list used to sit at the very bottom, under nine shelves of cards —
 * so the fastest way to actually start music was to scroll past everything
 * else. Column-flowed inside one card, fifteen songs fit above the fold on a
 * desktop and press-to-play is the first thing on screen.
 */
export function QuickPicks({
  title,
  subtitle,
  tracks,
  loading,
  action,
}: {
  title: string
  subtitle?: string
  tracks: Track[]
  loading?: boolean
  action?: React.ReactNode
}) {
  return (
    <section className="animate-fade-up rounded-2xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur-xl sm:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 px-2">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 truncate text-xs text-ink-400">{subtitle}</p>}
        </div>
        {action}
      </div>

      {/*
        Column-major on wide screens so the list reads top-to-bottom in each
        column, the way the reference layout does — `grid-flow-col` with a
        fixed row count is what produces that, rather than left-to-right wrap.
      */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 md:grid-flow-col md:grid-cols-2 md:grid-rows-[repeat(8,minmax(0,1fr))] xl:grid-cols-3 xl:grid-rows-[repeat(5,minmax(0,1fr))]">
        {loading && !tracks.length
          ? Array.from({ length: 15 }, (_, i) => <Skeleton key={i} className="h-[60px] w-full" />)
          : tracks.map((t) => <CompactTrackRow key={`${t.source}-${t.id}`} track={t} queue={tracks} />)}
      </div>

      {!loading && !tracks.length && (
        <p className="px-2 py-6 text-sm text-ink-400">
          Nothing to play right now — try refreshing in a moment.
        </p>
      )}
    </section>
  )
}
