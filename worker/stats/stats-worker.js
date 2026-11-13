// KinoPulse usage stats (Cloudflare Worker + D1).
//
//   POST /ping   {id, platform, version, watching}   anonymous heartbeat, one per minute while the app is open
//   POST /play   {id, movie}                         a movie was actually watched (not just opened)
//   GET  /stats  Authorization: Bearer <password>    everything the admin panel shows
//
// The device id is a random UUID the app makes up on first launch: it identifies an install, not a
// person. No IP, name or account is stored. The admin password lives only here, as the
// ADMIN_PASSWORD secret — the app's code is public, so it must never be checked on the client.

const ONLINE_WINDOW_S = 150 // a device is "online" if it pinged within this many seconds (pings come every 60)
const MAX_FAILS = 10 // wrong passwords allowed per IP...
const FAIL_WINDOW_S = 15 * 60 // ...in this window
const DAY_S = 86400

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MOVIE = /^kp_\d{1,6}$/
const PLATFORMS = ['tv', 'android', 'pwa', 'web']

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS devices (
     id TEXT PRIMARY KEY, platform TEXT NOT NULL, version TEXT NOT NULL,
     first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, watching TEXT)`,
  `CREATE INDEX IF NOT EXISTS devices_last_seen ON devices (last_seen)`,
  `CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (day, id)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS plays (movie TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (movie, day)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS auth_fails (ip TEXT NOT NULL, ts INTEGER NOT NULL)`,
]

// Tables are created on the first request of each isolate, so deploying needs no migration step.
let ready
const ensureSchema = (db) => (ready ??= db.batch(SCHEMA.map((q) => db.prepare(q))).catch((e) => ((ready = undefined), Promise.reject(e))))

const now = () => Math.floor(Date.now() / 1000)
const dayOf = (ts) => new Date(ts * 1000).toISOString().slice(0, 10)

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim())
  if (!allowed.includes('*') && !allowed.includes(origin)) return null
  return {
    'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

async function sameSecret(a, b) {
  // Compare digests, not the strings: the time taken must not reveal how many characters matched.
  const enc = new TextEncoder()
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))])
  const u = new Uint8Array(x)
  const v = new Uint8Array(y)
  let diff = 0
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i]
  return diff === 0
}

async function readBody(request) {
  // The app sends JSON as text/plain so the browser skips the CORS preflight on every heartbeat.
  const text = await request.text()
  if (text.length > 500) return null
  try {
    const body = JSON.parse(text)
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

async function ping(db, body) {
  const { id, platform, version, watching } = body
  if (!UUID.test(id) || !PLATFORMS.includes(platform)) return false
  const ver = String(version ?? '').slice(0, 20)
  const movie = typeof watching === 'string' && MOVIE.test(watching) ? watching : null
  const ts = now()
  await db.batch([
    db
      .prepare(
        `INSERT INTO devices (id, platform, version, first_seen, last_seen, watching) VALUES (?1, ?2, ?3, ?4, ?4, ?5)
         ON CONFLICT (id) DO UPDATE SET platform = ?2, version = ?3, last_seen = ?4, watching = ?5`,
      )
      .bind(id, platform, ver, ts, movie),
    db.prepare(`INSERT OR IGNORE INTO daily (day, id) VALUES (?1, ?2)`).bind(dayOf(ts), id),
  ])
  return true
}

async function play(db, body) {
  const { id, movie } = body
  if (!UUID.test(id) || !MOVIE.test(movie)) return false
  await db
    .prepare(`INSERT INTO plays (movie, day, n) VALUES (?1, ?2, 1) ON CONFLICT (movie, day) DO UPDATE SET n = n + 1`)
    .bind(movie, dayOf(now()))
    .run()
  return true
}

async function stats(db) {
  const ts = now()
  const today = dayOf(ts)
  const since = (days) => dayOf(ts - (days - 1) * DAY_S)
  const online = ts - ONLINE_WINDOW_S
  const [totals, platforms, versions, watching, days, topWeek, topAll] = await db.batch([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM devices) AS devices,
           (SELECT COUNT(*) FROM devices WHERE last_seen >= ?1) AS online,
           (SELECT COUNT(*) FROM devices WHERE last_seen >= ?1 AND watching IS NOT NULL) AS watching,
           (SELECT COUNT(*) FROM devices WHERE first_seen >= ?2) AS new_today,
           (SELECT COUNT(*) FROM daily WHERE day = ?3) AS active_today,
           (SELECT COUNT(DISTINCT id) FROM daily WHERE day >= ?4) AS active_7d,
           (SELECT COUNT(DISTINCT id) FROM daily WHERE day >= ?5) AS active_30d,
           (SELECT COALESCE(SUM(n), 0) FROM plays WHERE day = ?3) AS plays_today,
           (SELECT COALESCE(SUM(n), 0) FROM plays) AS plays_total`,
      )
      .bind(online, ts - (ts % DAY_S), today, since(7), since(30)),
    // Platform and version describe installs still in use, so they count the last 30 days only.
    db
      .prepare(
        `SELECT platform, COUNT(*) AS devices, SUM(last_seen >= ?1) AS online FROM devices WHERE last_seen >= ?2 GROUP BY platform ORDER BY devices DESC`,
      )
      .bind(online, ts - 30 * DAY_S),
    db
      .prepare(`SELECT version, COUNT(*) AS devices FROM devices WHERE last_seen >= ?1 AND platform IN ('tv', 'android') GROUP BY version ORDER BY devices DESC LIMIT 10`)
      .bind(ts - 30 * DAY_S),
    db.prepare(`SELECT watching AS movie, COUNT(*) AS devices FROM devices WHERE last_seen >= ?1 AND watching IS NOT NULL GROUP BY watching ORDER BY devices DESC LIMIT 20`).bind(online),
    db.prepare(`SELECT day, COUNT(*) AS devices FROM daily WHERE day >= ?1 GROUP BY day ORDER BY day DESC`).bind(since(14)),
    db.prepare(`SELECT movie, SUM(n) AS plays FROM plays WHERE day >= ?1 GROUP BY movie ORDER BY plays DESC LIMIT 10`).bind(since(7)),
    db.prepare(`SELECT movie, SUM(n) AS plays FROM plays GROUP BY movie ORDER BY plays DESC LIMIT 10`),
  ])
  return {
    at: ts,
    ...totals.results[0],
    platforms: platforms.results,
    versions: versions.results,
    watchingNow: watching.results,
    days: days.results,
    topWeek: topWeek.results,
    topAll: topAll.results,
  }
}

async function authorize(request, env, db) {
  if (!env.ADMIN_PASSWORD) return 503
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const ts = now()
  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM auth_fails WHERE ip = ?1 AND ts >= ?2`).bind(ip, ts - FAIL_WINDOW_S).first()
  if (n >= MAX_FAILS) return 429
  const given = (request.headers.get('Authorization') || '').replace(/^Bearer /, '')
  if (given && (await sameSecret(given, env.ADMIN_PASSWORD))) return 200
  await db.batch([
    db.prepare(`INSERT INTO auth_fails (ip, ts) VALUES (?1, ?2)`).bind(ip, ts),
    db.prepare(`DELETE FROM auth_fails WHERE ts < ?1`).bind(ts - FAIL_WINDOW_S),
  ])
  return 401
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const headers = cors(origin, env)
    if (origin && !headers) return new Response('Origin not allowed', { status: 403 })
    const reply = (status, body) =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })

    const { pathname } = new URL(request.url)
    try {
      await ensureSchema(env.DB)
      if (request.method === 'POST' && (pathname === '/ping' || pathname === '/play')) {
        const body = await readBody(request)
        const ok = body && (await (pathname === '/ping' ? ping : play)(env.DB, body))
        return reply(ok ? 204 : 400)
      }
      if (request.method === 'GET' && pathname === '/stats') {
        const status = await authorize(request, env, env.DB)
        return status === 200 ? reply(200, await stats(env.DB)) : reply(status, { error: status })
      }
      return reply(404, { error: 404 })
    } catch (e) {
      console.error(e)
      return reply(500, { error: 500 })
    }
  },
}
