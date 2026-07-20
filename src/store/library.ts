import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Track } from '@/types'
import { keyOf } from '@/lib/db'

export interface UserPlaylist {
  id: string
  name: string
  createdAt: number
  tracks: Track[]
}

interface LibraryState {
  favorites: Track[]
  playlists: UserPlaylist[]
  recent: Track[]

  isFavorite: (track: Track) => boolean
  toggleFavorite: (track: Track) => void
  createPlaylist: (name: string) => string
  renamePlaylist: (id: string, name: string) => void
  deletePlaylist: (id: string) => void
  addToPlaylist: (playlistId: string, track: Track) => void
  removeFromPlaylist: (playlistId: string, trackKey: string) => void
  pushRecent: (track: Track) => void
}

const MAX_RECENT = 30

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      favorites: [],
      playlists: [],
      recent: [],

      isFavorite: (track) => get().favorites.some((t) => keyOf(t) === keyOf(track)),

      toggleFavorite: (track) =>
        set((s) => ({
          favorites: s.favorites.some((t) => keyOf(t) === keyOf(track))
            ? s.favorites.filter((t) => keyOf(t) !== keyOf(track))
            : [track, ...s.favorites],
        })),

      createPlaylist: (name) => {
        const id = crypto.randomUUID()
        set((s) => ({
          playlists: [{ id, name, createdAt: Date.now(), tracks: [] }, ...s.playlists],
        }))
        return id
      },

      renamePlaylist: (id, name) =>
        set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, name } : p)) })),

      deletePlaylist: (id) => set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) })),

      addToPlaylist: (playlistId, track) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId && !p.tracks.some((t) => keyOf(t) === keyOf(track))
              ? { ...p, tracks: [...p.tracks, track] }
              : p,
          ),
        })),

      removeFromPlaylist: (playlistId, trackKey) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId ? { ...p, tracks: p.tracks.filter((t) => keyOf(t) !== trackKey) } : p,
          ),
        })),

      pushRecent: (track) =>
        set((s) => ({
          recent: [track, ...s.recent.filter((t) => keyOf(t) !== keyOf(track))].slice(0, MAX_RECENT),
        })),
    }),
    { name: 'lf:library' },
  ),
)
