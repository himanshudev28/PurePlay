/**
 * Same-origin proxy for the JioSaavn API, running on Vercel's Edge Network.
 *
 * Fixes two things that break direct browser calls to the public instances:
 *   1. CORS — the app now calls /api/saavn/* (same origin), so there's no
 *      cross-origin request and no missing Access-Control-Allow-Origin header.
 *   2. Rate limiting (429) — successful responses are cached at Vercel's CDN
 *      (s-maxage), so a given query hits the upstream about once per hour for
 *      the WHOLE site instead of once per user. That keeps us far under the
 *      public instances' limits. It also fails over between upstreams.
 *
 * Set VITE_JIOSAAVN_API to your own self-hosted instance to bypass all of this.
 */
export const config = { runtime: 'edge' }

const UPSTREAMS = ['https://saavn.sumit.co/api', 'https://saavn.dev/api']

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/api\/saavn\/?/, '')
  const search = url.search

  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
  }

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  let lastStatus = 502
  for (const base of UPSTREAMS) {
    try {
      const upstream = await fetch(`${base}/${path}${search}`, {
        headers: { accept: 'application/json' },
      })

      // Rate-limited or upstream error → try the next mirror.
      if (upstream.status === 429 || upstream.status >= 500) {
        lastStatus = upstream.status
        continue
      }

      const body = await upstream.text()
      return new Response(body, {
        status: upstream.status,
        headers: {
          ...cors,
          'content-type': 'application/json; charset=utf-8',
          // Cache good responses hard at the edge; don't cache errors.
          'cache-control': upstream.ok
            ? 'public, s-maxage=3600, stale-while-revalidate=86400'
            : 'no-store',
        },
      })
    } catch {
      // network failure — try the next mirror
    }
  }

  return new Response(
    JSON.stringify({ success: false, message: 'All music API upstreams are unavailable' }),
    { status: lastStatus, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } },
  )
}
