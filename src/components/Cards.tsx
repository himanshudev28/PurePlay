import { Link } from 'react-router-dom'
import { Play, Music2, Disc3, ListMusic, ArrowRight, type LucideIcon } from 'lucide-react'
import type { Track, Collection, Artist } from '@/types'
import { usePlayer } from '@/store/player'
import { Artwork } from './ui'
import { formatCount } from '@/lib/format'

/**
 * A small corner label so a glance tells song from album from playlist — the
 * three used to be visually identical square cards with no way to tell which
 * action a click would trigger (play vs. open).
 */
function TypeBadge({ label, icon: Icon }: { label: string; icon: LucideIcon }) {
  return (
    <span className="pointer-events-none absolute top-2 left-2 z-10 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white/95 uppercase ring-1 ring-white/15 backdrop-blur-md">
      <Icon size={10} aria-hidden />
      {label}
    </span>
  )
}

export function TrackCard({ track, queue }: { track: Track; queue?: Track[] }) {
  const playTrack = usePlayer((s) => s.playTrack)
  return (
    <div className="group w-[152px] shrink-0 sm:w-[168px] card-hover">
      <button
        onClick={() => void playTrack(track, queue)}
        aria-label={`Play ${track.title} by ${track.artist}`}
        className="relative block w-full rounded-xl"
      >
        <TypeBadge label="Song" icon={Music2} />
        <Artwork src={track.artwork} alt="" className="aspect-square w-full ring-1 ring-white/10" />
        {/* gradient overlay for depth */}
        <span className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <span className="absolute right-2 bottom-2 flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-accent opacity-0 shadow-lg transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 glow-accent">
          {/* the glyph has to clear 3:1 against the accent fill; white doesn't */}
          <Play size={16} fill="currentColor" className="ml-0.5 text-ink-950" />
        </span>
      </button>
      <p className="mt-2 truncate text-sm font-medium text-white">{track.title}</p>
      <p className="truncate text-xs text-ink-400">{track.artist}</p>
      {track.playCount ? (
        // was text-ink-600 — 1.6:1 against the page, effectively invisible
        <p className="mt-0.5 text-[11px] text-ink-400">{formatCount(track.playCount)} plays</p>
      ) : null}
    </div>
  )
}

export function CollectionCard({ collection }: { collection: Collection }) {
  // Default unknown collections to "playlist" wording — a curated set is the
  // safer assumption than claiming a specific album release.
  const isAlbum = collection.kind === 'album'
  const label = isAlbum ? 'Album' : 'Playlist'
  const Icon = isAlbum ? Disc3 : ListMusic

  return (
    <Link
      to={`/playlist/${collection.id}`}
      aria-label={`Open ${label.toLowerCase()} ${collection.title}`}
      className="group w-[152px] shrink-0 sm:w-[168px] card-hover"
    >
      {/* Stacked shadow-panels behind the art signal "a set of tracks", so a
          collection reads differently from a single-song card even before the
          badge is noticed. */}
      <div className="relative">
        <span
          aria-hidden
          className="absolute -top-1.5 left-1/2 h-full w-[88%] -translate-x-1/2 rounded-xl bg-ink-700/50"
        />
        <span
          aria-hidden
          className="absolute -top-0.5 left-1/2 h-full w-[94%] -translate-x-1/2 rounded-xl bg-ink-600/40"
        />
        <div className="relative overflow-hidden rounded-xl ring-1 ring-white/10">
          <TypeBadge label={label} icon={Icon} />
          <Artwork
            src={collection.artwork}
            alt=""
            className="aspect-square w-full transition-transform duration-300 group-hover:scale-105"
          />
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
          {/* "open" affordance — collections navigate, they don't play in place */}
          <span className="absolute right-2 bottom-2 flex h-10 w-10 translate-y-2 items-center justify-center rounded-full bg-white text-ink-950 opacity-0 shadow-lg transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
            <ArrowRight size={16} />
          </span>
        </div>
      </div>
      <p className="mt-2 truncate text-sm font-medium text-white">{collection.title}</p>
      {/* Album search results carry neither an owner nor a song count, and the
          old fallback rendered a confident "0 tracks" under every one of them.
          Unknown is not zero — say the kind rather than something false. */}
      <p className="truncate text-xs text-ink-400">
        {collection.owner ??
          (collection.trackCount
            ? `${collection.trackCount} track${collection.trackCount === 1 ? '' : 's'}`
            : label)}
      </p>
    </Link>
  )
}

export function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <Link to={`/artist/${artist.id}`} className="group w-[132px] shrink-0 text-center card-hover">
      <Artwork
        src={artist.avatar}
        alt=""
        rounded="rounded-full"
        className="aspect-square w-full ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-105"
      />
      <p className="mt-2 truncate text-sm font-medium text-white">{artist.name}</p>
      {/* Round art already marks an artist; the label keeps parity with the
          badges on the square cards for screen-reader and glance clarity. */}
      <p className="truncate text-[11px] font-semibold tracking-wide text-ink-400 uppercase">Artist</p>
      {artist.followers ? (
        <p className="truncate text-xs text-ink-400">{formatCount(artist.followers)} followers</p>
      ) : null}
    </Link>
  )
}
