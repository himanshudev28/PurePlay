import { Link } from 'react-router-dom'
import { Play } from 'lucide-react'
import type { Track, Collection, Artist } from '@/types'
import { usePlayer } from '@/store/player'
import { Artwork } from './ui'
import { formatCount } from '@/lib/format'

export function TrackCard({ track, queue }: { track: Track; queue?: Track[] }) {
  const playTrack = usePlayer((s) => s.playTrack)
  return (
    <div className="group w-[152px] shrink-0 sm:w-[168px]">
      <button onClick={() => void playTrack(track, queue)} className="relative block w-full">
        <Artwork src={track.artwork} alt={track.title} className="aspect-square w-full" />
        <span className="absolute right-2 bottom-2 flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-accent opacity-0 shadow-lg transition group-hover:translate-y-0 group-hover:opacity-100">
          <Play size={16} fill="white" className="ml-0.5 text-white" />
        </span>
      </button>
      <p className="mt-2 truncate text-sm font-medium text-white">{track.title}</p>
      <p className="truncate text-xs text-ink-400">{track.artist}</p>
      {track.playCount ? (
        <p className="mt-0.5 text-[11px] text-ink-600">{formatCount(track.playCount)} plays</p>
      ) : null}
    </div>
  )
}

export function CollectionCard({ collection }: { collection: Collection }) {
  return (
    <Link to={`/playlist/${collection.id}`} className="group w-[152px] shrink-0 sm:w-[168px]">
      <Artwork src={collection.artwork} alt={collection.title} className="aspect-square w-full transition group-hover:opacity-85" />
      <p className="mt-2 truncate text-sm font-medium text-white">{collection.title}</p>
      <p className="truncate text-xs text-ink-400">
        {collection.owner ?? `${collection.trackCount ?? 0} tracks`}
      </p>
    </Link>
  )
}

export function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <Link to={`/artist/${artist.id}`} className="group w-[132px] shrink-0 text-center">
      <Artwork
        src={artist.avatar}
        alt={artist.name}
        rounded="rounded-full"
        className="aspect-square w-full transition group-hover:opacity-85"
      />
      <p className="mt-2 truncate text-sm font-medium text-white">{artist.name}</p>
      {artist.followers ? (
        <p className="truncate text-xs text-ink-400">{formatCount(artist.followers)} followers</p>
      ) : null}
    </Link>
  )
}
