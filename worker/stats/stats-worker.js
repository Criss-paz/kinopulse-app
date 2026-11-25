// KinoPulse usage stats (Cloudflare Worker + D1).
//
//   POST /ping   {id, platform, version, watching}   anonymous heartbeat, one per minute while the app is open
//   POST /play   {id, movie}                         a movie was actually watched (not just opened)
//   POST /report {id, movie, kind, platform}         a movie failed to play, or the viewer reported a problem with it
//   GET  /top                                        ids of the most watched movies of the last 30 days (public, no counts)
//   POST /suggest {id, text}                         a movie a viewer would like added (a few per device and day)
//   POST /suggest/done {sid}  (admin password)       mark a suggestion as handled, so it leaves the list
//   POST /sync   {id, code?, data}                   save a device's progress and list; without code, makes a new one
//   GET  /sync?code=XXXXXXXX                         what was saved under that code
//   GET  /stats?from=YYYY-MM-DD&to=YYYY-MM-DD        everything the admin panel shows, for that range of days
//        Authorization: Bearer <password>             (default: the last 7 days)
//
// Days are counted in local time, TZ_OFFSET_MIN minutes from UTC (wrangler.toml; -360 = Central America).
// Before that setting existed they were UTC days, so the oldest history may be shifted by those hours.
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
// err_* are sent by the player on its own when a movie fails; the rest are picked by the viewer.
const REPORT_KINDS = ['err_network', 'err_decode', 'err_format', 'no_carga', 'tirones', 'audio', 'subtitulos', 'otro']
// Sync codes: 8 characters, without the ones that get confused when read aloud or typed (0/O, 1/I).
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE = /^[A-HJ-NP-Z2-9]{8}$/
const MAX_SYNC_CHARS = 200000
const MAX_RANGE_DAYS = 120
const MAX_SUGGESTION_CHARS = 200
const MAX_SUGGESTIONS_PER_DAY = 5 // per device
const DAY = /^\d{4}-\d{2}-\d{2}$/

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS devices (
     id TEXT PRIMARY KEY, platform TEXT NOT NULL, version TEXT NOT NULL,
     first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, watching TEXT)`,
  `CREATE INDEX IF NOT EXISTS devices_last_seen ON devices (last_seen)`,
  `CREATE TABLE IF NOT EXISTS daily (day TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (day, id)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS plays (movie TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (movie, day)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS auth_fails (ip TEXT NOT NULL, ts INTEGER NOT NULL)`,
  // One row per device, movie, kind and day: the same device repeating a report does not inflate the count.
  `CREATE TABLE IF NOT EXISTS reports (day TEXT NOT NULL, id TEXT NOT NULL, movie TEXT NOT NULL, kind TEXT NOT NULL, platform TEXT NOT NULL,
     PRIMARY KEY (day, id, movie, kind)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS sync (code TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL)`,
  // Who came each day and from what: kind of device (phone, tablet, tv, pc) and browser (or the app).
  `CREATE TABLE IF NOT EXISTS suggestions (sid INTEGER PRIMARY KEY, day TEXT NOT NULL, id TEXT NOT NULL, text TEXT NOT NULL,
     created INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS suggestions_day_id ON suggestions (day, id)`,
  `CREATE TABLE IF NOT EXISTS visits (day TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, browser TEXT NOT NULL,
     PRIMARY KEY (day, id)) WITHOUT ROWID`,
]
// Columns added after the first deploy. ALTER fails once the column exists, and that is fine.
const MIGRATIONS = [`ALTER TABLE devices ADD COLUMN kind TEXT`, `ALTER TABLE devices ADD COLUMN browser TEXT`]

// Tables are created on the first request of each isolate, so deploying needs no migration step.
let ready
const ensureSchema = (db) =>
  (ready ??= db
    .batch(SCHEMA.map((q) => db.prepare(q)))
    .then(() => Promise.all(MIGRATIONS.map((q) => db.prepare(q).run().catch(() => undefined))))
    .catch((e) => ((ready = undefined), Promise.reject(e))))

const now = () => Math.floor(Date.now() / 1000)
let offsetS = 0 // set from env.TZ_OFFSET_MIN on every request
const dayOf = (ts) => new Date((ts + offsetS) * 1000).toISOString().slice(0, 10)
// Seconds since the epoch at the local midnight that starts that day.
const startOf = (day) => Date.parse(`${day}T00:00:00Z`) / 1000 - offsetS
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_S * 1000).toISOString().slice(0, 10)

// The app inside a TV or phone reports its platform; in a browser, the user agent says the rest.
function kindOf(platform, ua) {
  if (platform === 'tv') return 'tv'
  if (platform === 'android') return 'phone'
  if (/SmartTV|SMART-TV|Tizen|Web0S|webOS|HbbTV|BRAVIA|AFT\w|CrKey/i.test(ua)) return 'tv'
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet'
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'phone'
  return 'pc'
}

function browserOf(platform, ua) {
  if (platform === 'tv' || platform === 'android') return 'App KinoPulse'
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet'
  if (/Edg(e|A|iOS)?\//i.test(ua)) return 'Edge'
  if (/OPR\/|Opera/i.test(ua)) return 'Opera'
  if (/Firefox|FxiOS/i.test(ua)) return 'Firefox'
  if (/CriOS|Chrome\//i.test(ua)) return 'Chrome'
  if (/Safari\//i.test(ua)) return 'Safari'
  return 'Otro'
}

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

async function readBody(request, maxChars = 500) {
  // The app sends JSON as text/plain so the browser skips the CORS preflight on every heartbeat.
  const text = await request.text()
  if (text.length > maxChars) return null
  try {
    const body = JSON.parse(text)
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

async function ping(db, body, ua) {
  const { id, platform, version, watching } = body
  if (!UUID.test(id) || !PLATFORMS.includes(platform)) return false
  const ver = String(version ?? '').slice(0, 20)
  const movie = typeof watching === 'string' && MOVIE.test(watching) ? watching : null
  const kind = kindOf(platform, ua)
  const browser = browserOf(platform, ua)
  const ts = now()
  await db.batch([
    db
      .prepare(
        `INSERT INTO devices (id, platform, version, first_seen, last_seen, watching, kind, browser) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7)
         ON CONFLICT (id) DO UPDATE SET platform = ?2, version = ?3, last_seen = ?4, watching = ?5, kind = ?6, browser = ?7`,
      )
      .bind(id, platform, ver, ts, movie, kind, browser),
    db.prepare(`INSERT OR IGNORE INTO daily (day, id) VALUES (?1, ?2)`).bind(dayOf(ts), id),
    db
      .prepare(`INSERT INTO visits (day, id, kind, browser) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (day, id) DO UPDATE SET kind = ?3, browser = ?4`)
      .bind(dayOf(ts), id, kind, browser),
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

async function report(db, body) {
  const { id, movie, kind, platform } = body
  if (!UUID.test(id) || !MOVIE.test(movie) || !REPORT_KINDS.includes(kind) || !PLATFORMS.includes(platform)) return false
  await db.prepare(`INSERT OR IGNORE INTO reports (day, id, movie, kind, platform) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(dayOf(now()), id, movie, kind, platform).run()
  return true
}

async function suggest(db, body) {
  const { id, text } = body
  if (!UUID.test(id) || typeof text !== 'string') return false
  // Plain text only: control characters out, spaces collapsed.
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SUGGESTION_CHARS)
  if (clean.length < 2) return false
  const ts = now()
  const day = dayOf(ts)
  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM suggestions WHERE day = ?1 AND id = ?2`).bind(day, id).first()
  if (n >= MAX_SUGGESTIONS_PER_DAY) return false
  await db.prepare(`INSERT INTO suggestions (day, id, text, created) VALUES (?1, ?2, ?3, ?4)`).bind(day, id, clean, ts).run()
  return true
}

async function top(db) {
  const { results } = await db
    .prepare(`SELECT movie FROM plays WHERE day >= ?1 GROUP BY movie ORDER BY SUM(n) DESC LIMIT 20`)
    .bind(dayOf(now() - 29 * DAY_S))
    .all()
  return results.map((r) => r.movie)
}

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('')
}

// Returns the code the data was saved under, or null if the request is invalid or the code unknown.
async function syncSave(db, body) {
  const { id, code, data } = body
  if (!UUID.test(id) || !data || typeof data !== 'object') return null
  const text = JSON.stringify(data)
  const ts = now()
  if (code !== undefined) {
    if (!CODE.test(code)) return null
    const done = await db.prepare(`UPDATE sync SET data = ?2, updated = ?3 WHERE code = ?1`).bind(code, text, ts).run()
    return done.meta.changes ? code : null
  }
  const fresh = newCode()
  await db.batch([
    // A device owns one code at a time, and codes nobody has used in a year are dropped.
    db.prepare(`DELETE FROM sync WHERE owner = ?1 OR updated < ?2`).bind(id, ts - 365 * DAY_S),
    db.prepare(`INSERT INTO sync (code, owner, data, updated) VALUES (?1, ?2, ?3, ?4)`).bind(fresh, id, text, ts),
  ])
  return fresh
}

async function syncLoad(db, code) {
  if (!CODE.test(code || '')) return null
  const row = await db.prepare(`SELECT data, updated FROM sync WHERE code = ?1`).bind(code).first()
  return row ? { data: JSON.parse(row.data), updated: row.updated } : null
}

async function stats(db) {
  const ts = now()
  const today = dayOf(ts)
  const since = (days) => dayOf(ts - (days - 1) * DAY_S)
  const online = ts - ONLINE_WINDOW_S
  const [totals, platforms, versions, watching, days, topWeek, topAll, problems] = await db.batch([
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
    db.prepare(`SELECT movie, kind, platform, COUNT(*) AS n FROM reports WHERE day >= ?1 GROUP BY movie, kind, platform ORDER BY n DESC, movie LIMIT 40`).bind(since(30)),
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
    problems: problems.results,
  }
}

// What the panel shows for the days from..to (both included), plus what is happening right now.
async function rangeStats(db, from, to) {
  const ts = now()
  const online = ts - ONLINE_WINDOW_S
  const t0 = startOf(from)
  const t1 = startOf(addDays(to, 1))
  // Installs: the app on a TV or phone, or the web app installed on a computer or phone (PWA). A device
  // that uninstalls never says so; "active" means it opened the app in the last 30 days.
  const kindSql = `COALESCE(kind, CASE platform WHEN 'tv' THEN 'tv' WHEN 'android' THEN 'phone' ELSE 'pc' END)`
  const [live, liveKinds, watching, installs, totals, perDay, newPerDay, playsPerDay, kinds, browsers, top, problems, first, suggestions] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS online, SUM(watching IS NOT NULL) AS watching FROM devices WHERE last_seen >= ?1`).bind(online),
    db.prepare(`SELECT ${kindSql} AS kind, COUNT(*) AS n FROM devices WHERE last_seen >= ?1 GROUP BY 1 ORDER BY n DESC`).bind(online),
    db
      .prepare(`SELECT watching AS movie, COUNT(*) AS devices FROM devices WHERE last_seen >= ?1 AND watching IS NOT NULL GROUP BY watching ORDER BY devices DESC LIMIT 20`)
      .bind(online),
    db
      .prepare(
        `SELECT ${kindSql} AS kind, COUNT(*) AS total, SUM(last_seen >= ?1) AS active FROM devices
         WHERE platform IN ('tv', 'android', 'pwa') GROUP BY 1 ORDER BY total DESC`,
      )
      .bind(ts - 30 * DAY_S),
    db
      .prepare(
        `SELECT
           (SELECT COUNT(DISTINCT id) FROM daily WHERE day BETWEEN ?1 AND ?2) AS users,
           (SELECT COUNT(*) FROM devices WHERE first_seen >= ?3 AND first_seen < ?4) AS new_devices,
           (SELECT COALESCE(SUM(n), 0) FROM plays WHERE day BETWEEN ?1 AND ?2) AS plays,
           (SELECT COUNT(*) FROM devices) AS devices_total,
           (SELECT COALESCE(SUM(n), 0) FROM plays) AS plays_total`,
      )
      .bind(from, to, t0, t1),
    db.prepare(`SELECT day, COUNT(*) AS users FROM daily WHERE day BETWEEN ?1 AND ?2 GROUP BY day`).bind(from, to),
    db
      .prepare(`SELECT date(first_seen + ?3, 'unixepoch') AS day, COUNT(*) AS n FROM devices WHERE first_seen >= ?1 AND first_seen < ?2 GROUP BY 1`)
      .bind(t0, t1, offsetS),
    db.prepare(`SELECT day, SUM(n) AS plays FROM plays WHERE day BETWEEN ?1 AND ?2 GROUP BY day`).bind(from, to),
    db.prepare(`SELECT kind, COUNT(DISTINCT id) AS users FROM visits WHERE day BETWEEN ?1 AND ?2 GROUP BY kind ORDER BY users DESC`).bind(from, to),
    db.prepare(`SELECT browser, COUNT(DISTINCT id) AS users FROM visits WHERE day BETWEEN ?1 AND ?2 GROUP BY browser ORDER BY users DESC`).bind(from, to),
    db.prepare(`SELECT movie, SUM(n) AS plays FROM plays WHERE day BETWEEN ?1 AND ?2 GROUP BY movie ORDER BY plays DESC LIMIT 15`).bind(from, to),
    db
      .prepare(`SELECT movie, kind, platform, COUNT(*) AS n FROM reports WHERE day BETWEEN ?1 AND ?2 GROUP BY movie, kind, platform ORDER BY n DESC, movie LIMIT 40`)
      .bind(from, to),
    db.prepare(`SELECT MIN(day) AS daily, (SELECT MIN(day) FROM visits) AS visits FROM daily`),
    db.prepare(`SELECT sid, text, created FROM suggestions WHERE done = 0 ORDER BY created DESC LIMIT 100`),
  ])
  // Every day of the range, zeros included, so the chart has no gaps.
  const users = new Map(perDay.results.map((r) => [r.day, r.users]))
  const fresh = new Map(newPerDay.results.map((r) => [r.day, r.n]))
  const plays = new Map(playsPerDay.results.map((r) => [r.day, r.plays]))
  const days = []
  for (let d = from; d <= to; d = addDays(d, 1)) days.push({ day: d, users: users.get(d) ?? 0, new: fresh.get(d) ?? 0, plays: plays.get(d) ?? 0 })
  const sum = (rows, key) => rows.reduce((s, r) => s + (r[key] ?? 0), 0)
  return {
    from,
    to,
    today: dayOf(ts),
    firstDay: first.results[0].daily,
    detailSince: first.results[0].visits,
    live: { online: live.results[0].online ?? 0, watching: live.results[0].watching ?? 0, byKind: liveKinds.results, watchingNow: watching.results },
    installs: { total: sum(installs.results, 'total'), active: sum(installs.results, 'active'), byKind: installs.results },
    range: { ...totals.results[0], days, byKind: kinds.results, byBrowser: browsers.results, top: top.results, problems: problems.results },
    suggestions: suggestions.results,
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
    const reply = (status, body, cache = 'no-store') =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' },
      })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })

    const { pathname, searchParams } = new URL(request.url)
    try {
      await ensureSchema(env.DB)
      offsetS = (Number(env.TZ_OFFSET_MIN) || 0) * 60
      const write = request.method === 'POST' && new Map([['/ping', ping], ['/play', play], ['/report', report], ['/suggest', suggest]]).get(pathname)
      if (write) {
        const body = await readBody(request)
        const ok = body && (await write(env.DB, body, request.headers.get('User-Agent') || ''))
        return reply(ok ? 204 : 400)
      }
      if (request.method === 'GET' && pathname === '/top') return reply(200, await top(env.DB), 'public, max-age=600')
      if (pathname === '/sync' && request.method === 'POST') {
        const body = await readBody(request, MAX_SYNC_CHARS)
        if (!body) return reply(400)
        const code = await syncSave(env.DB, body)
        return code ? reply(200, { code }) : reply(404, { error: 404 })
      }
      if (pathname === '/sync' && request.method === 'GET') {
        const saved = await syncLoad(env.DB, searchParams.get('code'))
        return saved ? reply(200, saved) : reply(404, { error: 404 })
      }
      if (request.method === 'POST' && pathname === '/suggest/done') {
        const status = await authorize(request, env, env.DB)
        if (status !== 200) return reply(status, { error: status })
        const body = await readBody(request)
        if (!body || !Number.isInteger(body.sid)) return reply(400)
        await env.DB.prepare(`UPDATE suggestions SET done = 1 WHERE sid = ?1`).bind(body.sid).run()
        return reply(204)
      }
      if (request.method === 'GET' && pathname === '/stats') {
        const status = await authorize(request, env, env.DB)
        if (status !== 200) return reply(status, { error: status })
        const today = dayOf(now())
        let to = searchParams.get('to') || today
        let from = searchParams.get('from') || addDays(to, -6)
        if (!DAY.test(from) || !DAY.test(to) || from > to) return reply(400, { error: 400 })
        if (to > today) to = today
        if (from > to) from = to
        if (from < addDays(to, -(MAX_RANGE_DAYS - 1))) from = addDays(to, -(MAX_RANGE_DAYS - 1))
        // The older fields stay for installed apps whose admin panel still reads them.
        const [legacy, range] = await Promise.all([stats(env.DB), rangeStats(env.DB, from, to)])
        return reply(200, { ...legacy, ...range })
      }
      return reply(404, { error: 404 })
    } catch (e) {
      console.error(e)
      return reply(500, { error: 500 })
    }
  },
}
