/**
 * Server-side YouTube Music bridge (Vercel Node function).
 *
 * ytmusic-api talks to YouTube Music's internal API, which the browser can't do
 * (no CORS). This exposes a thin, cached endpoint the app calls same-origin:
 *
 *   /api/ytmusic?action=searchSongs&q=blinding%20lights
 *   /api/ytmusic?action=searchPlaylists&q=pop
 *   /api/ytmusic?action=searchArtists&q=weeknd
 *
 * Playback still happens through the app's existing YouTube iframe engine
 * (tracks come back with source:"youtube", id:videoId). JioSaavn stays the
 * source for background-capable audio; this only enriches discovery.
 */
import YTMusic from 'ytmusic-api'

// Reused across warm invocations so we don't re-handshake every request.
let clientPromise: Promise<InstanceType<typeof YTMusic>> | null = null
function getClient() {
  if (!clientPromise) {
    const yt = new YTMusic()
    clientPromise = yt.initialize().then(() => yt)
  }
  return clientPromise
}

type AnyReq = { query?: Record<string, string | string[] | undefined>; url?: string }
type AnyRes = {
  status: (code: number) => AnyRes
  json: (body: unknown) => void
  setHeader: (k: string, v: string) => void
}

const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

export default async function handler(req: AnyReq, res: AnyRes) {
  const params = req.query ?? Object.fromEntries(new URL(req.url ?? '', 'http://x').searchParams)
  const action = str(params.action) || 'searchSongs'
  const q = str(params.q)

  try {
    const yt = await getClient()
    let data: unknown = []

    switch (action) {
      case 'searchSongs':
        data = q ? await yt.searchSongs(q) : []
        break
      case 'searchPlaylists':
        data = q ? await yt.searchPlaylists(q) : []
        break
      case 'searchArtists':
        data = q ? await yt.searchArtists(q) : []
        break
      case 'home':
        data = await yt.getHomeSections()
        break
      default:
        res.status(400).json({ error: `unknown action: ${action}` })
        return
    }

    // Cache hard at the edge so a query hits YouTube ~once/hour for the site.
    res.setHeader('cache-control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    res.status(200).json({ data })
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : 'YouTube Music request failed' })
  }
}
