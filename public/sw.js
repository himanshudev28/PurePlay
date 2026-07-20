/// <reference lib="webworker" />
/**
 * App-shell service worker.
 *
 * Scope is deliberately narrow: this caches the *application* so it boots with
 * no network. It never caches audio — downloaded tracks live in IndexedDB
 * (see src/lib/db.ts), which is addressable, evictable and inspectable in a way
 * an opaque Cache Storage entry is not.
 */

const VERSION = 'v2'
const SHELL = `shell-${VERSION}`
const ASSETS = `assets-${VERSION}`
const OWNED = [SHELL, ASSETS]

/**
 * Never serve these from cache: catalog APIs and audio streams.
 *
 * Matched on PATH, not the full URL. Matching the whole href against /audius/
 * also matched every artwork URL (they are served from *.audius.co content
 * nodes), which silently disabled the image cache this worker exists to provide.
 */
const BYPASS_PATH = [
  /^\/v1\//, // Audius REST
  /^\/v3\.0\//, // Jamendo REST
  /cidstream/, // Audius audio blobs
  /\/tracks\/.*\/stream/,
  /\.(mp3|m4a|ogg|flac|wav)$/i,
]

const IMAGE = /\.(png|jpe?g|webp|avif|gif|svg)$/i

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['/', '/index.html']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // only delete caches this worker owns — an exact check, so we never evict
      // storage belonging to something else on the origin
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => (k.startsWith('shell-') || k.startsWith('assets-')) && !OWNED.includes(k))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (BYPASS_PATH.some((re) => re.test(url.pathname))) return

  // Navigations: network-first so deploys land immediately, cache as the
  // offline fallback. Without this the app is a blank page with no connection.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only cache a genuine success. Cache.put stores 404s and 500s
          // happily, and a single bad deploy would otherwise become the
          // permanent offline shell.
          if (res.ok && res.status === 200) {
            const copy = res.clone()
            void caches.open(SHELL).then((c) => c.put('/index.html', copy)).catch(() => {})
          }
          return res
        })
        .catch(() =>
          caches
            .match('/index.html')
            .then((r) => r ?? new Response('Offline', { status: 503, statusText: 'Offline' })),
        ),
    )
    return
  }

  // Same-origin build assets are content-hashed, so cache-first is safe.
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok && res.status === 200) {
              const copy = res.clone()
              void caches.open(ASSETS).then((c) => c.put(req, copy)).catch(() => {})
            }
            return res
          }),
      ),
    )
    return
  }

  // Artwork: stale-while-revalidate keeps the library looking right offline.
  if (IMAGE.test(url.pathname)) {
    event.respondWith(
      caches.open(ASSETS).then((cache) =>
        cache.match(req).then((hit) => {
          const net = fetch(req)
            .then((res) => {
              // opaque (no-cors) responses have status 0 and can't be validated;
              // caching them would poison the cache with possible errors
              if (res.ok && res.status === 200) void cache.put(req, res.clone()).catch(() => {})
              return res
            })
            .catch(() => hit ?? Response.error())
          // serve cache immediately when we have it, refresh in the background
          return hit ?? net
        }),
      ),
    )
  }
})
