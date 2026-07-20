import { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import type { Track, Collection } from '@/types'
import { source } from '@/services'
import { usePlayer } from '@/store/player'
import { useLibrary } from '@/store/library'
import { TrackCard, CollectionCard } from '@/components/Cards'
import { TrackRow } from '@/components/TrackRow'
import { SectionHeader, Skeleton, Button, ErrorNote, Artwork } from '@/components/ui'

export default function Home() {
  const [trending, setTrending] = useState<Track[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const playQueue = usePlayer((s) => s.playQueue)
  const recent = useLibrary((s) => s.recent)

  const load = () => {
    setLoading(true)
    setError(null)
    Promise.all([source.trending(40), source.featuredCollections(12).catch(() => [])])
      .then(([t, c]) => {
        setTrending(t)
        setCollections(c)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const hero = trending[0]

  if (error) {
    return (
      <div className="pt-4">
        <ErrorNote message={`Couldn't load the catalog: ${error}`} onRetry={load} />
      </div>
    )
  }

  return (
    <div className="space-y-10">
      {/* hero */}
      {loading ? (
        <Skeleton className="h-64 w-full rounded-2xl sm:h-80" />
      ) : hero ? (
        <section className="relative overflow-hidden rounded-2xl border border-ink-800">
          <div className="absolute inset-0">
            <Artwork src={hero.artwork} alt="" rounded="rounded-none" className="h-full w-full" />
            <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/85 to-ink-950/20" />
          </div>
          <div className="relative px-6 py-14 sm:px-10 sm:py-20">
            <p className="text-xs font-medium tracking-[0.2em] text-ink-400 uppercase">Trending now</p>
            <h1 className="mt-2 max-w-xl text-4xl leading-[1.05] font-bold tracking-tight text-white sm:text-6xl">
              {hero.title}
            </h1>
            <p className="mt-3 text-sm text-ink-300">{hero.artist}</p>
            <Button size="lg" variant="solid" className="mt-6" onClick={() => void playQueue(trending, 0)}>
              <Play size={17} fill="currentColor" />
              Play trending
            </Button>
          </div>
        </section>
      ) : null}

      {/* recently played */}
      {recent.length > 0 && (
        <section>
          <SectionHeader title="Jump back in" />
          <div className="shelf">
            {recent.slice(0, 12).map((t) => (
              <TrackCard key={`recent-${t.source}-${t.id}`} track={t} queue={recent} />
            ))}
          </div>
        </section>
      )}

      {/* trending shelf */}
      <section>
        <SectionHeader
          title="Trending"
          action={
            <Button size="sm" variant="ghost" onClick={() => void playQueue(trending, 0)}>
              Play all
            </Button>
          }
        />
        <div className="shelf">
          {loading
            ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[212px] w-[168px] shrink-0" />)
            : trending.slice(0, 20).map((t) => <TrackCard key={`${t.source}-${t.id}`} track={t} queue={trending} />)}
        </div>
      </section>

      {/* playlists */}
      {collections.length > 0 && (
        <section>
          <SectionHeader title="Featured playlists" />
          <div className="shelf">
            {collections.map((c) => (
              <CollectionCard key={`${c.source}-${c.id}`} collection={c} />
            ))}
          </div>
        </section>
      )}

      {/* long list */}
      <section>
        <SectionHeader title="More to hear" />
        <div className="space-y-0.5">
          {loading
            ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-14 w-full" />)
            : trending.slice(20, 40).map((t, i) => (
                <TrackRow key={`${t.source}-${t.id}`} track={t} index={i} queue={trending.slice(20, 40)} />
              ))}
        </div>
      </section>
    </div>
  )
}
