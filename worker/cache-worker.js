// KinoPulse transparent edge cache (Cloudflare Worker).
//
//   GET https://<worker>/?u=<encoded upstream URL>
//
// Only allow-listed public hosts are proxied. The upstream URL is visible in the request and echoed
// back in X-Upstream-Url — this is a performance cache, not an obfuscation layer. Range requests are
// forwarded so seeking works, and Cloudflare's cache serves repeat viewers from the edge.
// HLS playlists are rewritten so their segments also go through the cache.

const ALLOWED_HOSTS = [/(^|\.)archive\.org$/, /(^|\.)huggingface\.co$/, /(^|\.)hf\.co$/, /^test-streams\.mux\.dev$/]
const BLOCKED_UA = /(curl|wget|python-requests|scrapy|httpclient|go-http-client|libwww)/i

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
}

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim())
  const ok = allowed.includes('*') || allowed.includes(origin)
  return ok
    ? {
        'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : origin,
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
        Vary: 'Origin',
      }
    : null
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || ''
    const corsHeaders = cors(origin, env)
    if (origin && !corsHeaders) return new Response('Origin not allowed', { status: 403, headers: securityHeaders })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET, HEAD' } })
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
    if (env.BLOCK_BOTS !== 'false' && BLOCKED_UA.test(request.headers.get('User-Agent') || '')) {
      return new Response('Forbidden', { status: 403, headers: securityHeaders })
    }

    const self = new URL(request.url)
    let upstream
    try {
      upstream = new URL(self.searchParams.get('u') || '')
    } catch {
      return new Response('Missing or invalid ?u=', { status: 400, headers: securityHeaders })
    }
    if (upstream.protocol !== 'https:' || !ALLOWED_HOSTS.some((re) => re.test(upstream.hostname))) {
      return new Response('Host not allowed', { status: 403, headers: securityHeaders })
    }

    const range = request.headers.get('Range')
    const res = await fetch(upstream.toString(), {
      method: request.method,
      headers: range ? { Range: range } : {},
      redirect: 'follow',
      cf: { cacheEverything: true, cacheTtl: 60 * 60 * 24 * 7 },
    })

    const headers = new Headers(res.headers)
    for (const [k, v] of Object.entries({ ...securityHeaders, ...corsHeaders })) headers.set(k, v)
    headers.set('X-Upstream-Url', upstream.toString())
    headers.delete('Set-Cookie')

    const isPlaylist = /\.m3u8(\?|$)/.test(upstream.pathname) || (res.headers.get('Content-Type') || '').includes('mpegurl')
    if (isPlaylist && res.ok && request.method === 'GET') {
      const text = await res.text()
      const rewritten = text
        .split('\n')
        .map((line) => {
          const t = line.trim()
          const wrap = (u) => `${self.origin}/?u=${encodeURIComponent(new URL(u, upstream).toString())}`
          if (t && !t.startsWith('#')) return wrap(t)
          return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${wrap(u)}"`)
        })
        .join('\n')
      headers.delete('Content-Length')
      headers.set('Cache-Control', 'public, max-age=60')
      return new Response(rewritten, { status: res.status, headers })
    }

    headers.set('Cache-Control', 'public, max-age=86400')
    return new Response(res.body, { status: res.status, headers })
  },
}
