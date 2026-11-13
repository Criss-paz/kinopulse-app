import { App } from '@capacitor/app'
import { STATS_URL, isNative } from './config'

// Anonymous usage stats (worker/stats/stats-worker.js). The id is a random UUID made up on first
// launch: it tells installs apart, nothing else. With STATS_URL empty, none of this does anything.

const ID_KEY = 'kp_device_id'
const PING_MS = 60 * 1000
// A movie counts as played once it has been on screen this long, not when the player merely opens.
export const PLAY_AFTER_MS = 60 * 1000

export type Platform = 'tv' | 'android' | 'pwa' | 'web'

export interface Stats {
  at: number
  devices: number
  online: number
  watching: number
  new_today: number
  active_today: number
  active_7d: number
  active_30d: number
  plays_today: number
  plays_total: number
  platforms: { platform: Platform; devices: number; online: number }[]
  versions: { version: string; devices: number }[]
  watchingNow: { movie: string; devices: number }[]
  days: { day: string; devices: number }[]
  topWeek: { movie: string; plays: number }[]
  topAll: { movie: string; plays: number }[]
}

export const statsEnabled = () => STATS_URL !== ''

const endpoint = (path: string) => `${STATS_URL.replace(/\/$/, '')}${path}`

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  // Old TV WebViews lack randomUUID.
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function deviceId(): string {
  try {
    let id = localStorage.getItem(ID_KEY)
    if (!id) {
      id = uuid()
      localStorage.setItem(ID_KEY, id)
    }
    return id
  } catch {
    // No storage: still counted as online, just as a new device each launch.
    return (sessionId ??= uuid())
  }
}
let sessionId: string | undefined

function platform(): Platform {
  if (isNative()) return /\bTV\b|AFT|BRAVIA|SHIELD|Chromecast/i.test(navigator.userAgent) ? 'tv' : 'android'
  return window.matchMedia('(display-mode: standalone)').matches ? 'pwa' : 'web'
}

let version = 'web'
let watching: string | null = null

function post(path: string, body: object) {
  // text/plain keeps this a "simple" request, so there is no CORS preflight per heartbeat.
  fetch(endpoint(path), { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' }, keepalive: true }).catch(() => undefined)
}

function ping() {
  if (document.visibilityState !== 'visible') return
  post('/ping', { id: deviceId(), platform: platform(), version, watching })
}

export function startHeartbeat(): () => void {
  if (!statsEnabled()) return () => undefined
  let timer = 0
  const begin = () => {
    ping()
    timer = window.setInterval(ping, PING_MS)
  }
  if (isNative()) {
    App.getInfo()
      .then((info) => (version = info.version))
      .catch(() => undefined)
      .then(begin)
  } else begin()
  document.addEventListener('visibilitychange', ping)
  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', ping)
  }
}

// Called by the player: what this device is watching right now (null when it stops).
export function setWatching(movieId: string | null) {
  if (!statsEnabled() || watching === movieId) return
  watching = movieId
  ping()
}

export function trackPlay(movieId: string) {
  if (statsEnabled()) post('/play', { id: deviceId(), movie: movieId })
}

export class StatsError extends Error {
  constructor(public status: number) {
    super(`stats ${status}`)
  }
}

export async function fetchStats(password: string): Promise<Stats> {
  const res = await fetch(endpoint('/stats'), { headers: { Authorization: `Bearer ${password}` }, cache: 'no-store' })
  if (!res.ok) throw new StatsError(res.status)
  return (await res.json()) as Stats
}
