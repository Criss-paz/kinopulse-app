import { getLibrary, saveLibrary, type Library } from './library'
import { getAllProgress, replaceAllProgress, type WatchProgress } from './progress'
import { deviceId, endpoint, statsEnabled } from './stats'

// Sync between devices without accounts: one device makes a short code, the others type it in.
// Every device holding the code merges its progress and list with what is saved under it
// (worker/stats, /sync). Nothing personal is stored: movie ids, positions and timestamps.

const CODE_KEY = 'kp_sync_code'
const PUSH_DELAY_MS = 2 * 60 * 1000

interface Snapshot {
  progress: Record<string, WatchProgress>
  list: Library['list']
  seen: Library['seen']
}

export const syncEnabled = statsEnabled

export function syncCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? ''
  } catch {
    return ''
  }
}

export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`
// Typed codes come with dashes, spaces or lowercase.
export const cleanCode = (typed: string) => typed.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, '')

const snapshot = (): Snapshot => ({ progress: getAllProgress(), ...getLibrary() })

// Latest change wins, per movie. For list/seen the timestamp's sign is the state (see library.ts).
function merge(a: Snapshot, b: Partial<Snapshot>): Snapshot {
  const progress = { ...a.progress }
  for (const [id, p] of Object.entries(b.progress ?? {})) {
    if (p && typeof p.updatedAt === 'number' && (!progress[id] || p.updatedAt > progress[id].updatedAt)) progress[id] = p
  }
  const flags = (x: Record<string, number>, y: Record<string, number> = {}) => {
    const out = { ...x }
    for (const [id, ts] of Object.entries(y)) {
      if (typeof ts === 'number' && Math.abs(ts) > Math.abs(out[id] ?? 0)) out[id] = ts
    }
    return out
  }
  return { progress, list: flags(a.list, b.list), seen: flags(a.seen, b.seen) }
}

// Same content regardless of the order the keys were written in.
const canon = (v: unknown): string =>
  v && typeof v === 'object'
    ? `{${Object.keys(v).sort().map((k) => `${k}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
    : String(v)

let applying = false

function apply(s: Snapshot) {
  // Writing fires the same events that schedule a sync; this one must not schedule itself again.
  applying = true
  try {
    replaceAllProgress(s.progress)
    saveLibrary({ list: s.list, seen: s.seen })
  } finally {
    applying = false
  }
}

async function load(code: string): Promise<Partial<Snapshot> | null> {
  const res = await fetch(`${endpoint('/sync')}?code=${code}`, { cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`sync ${res.status}`)
  return ((await res.json()) as { data: Partial<Snapshot> }).data
}

async function save(data: Snapshot, code?: string): Promise<string | null> {
  // text/plain: a "simple" request, no CORS preflight (same as the heartbeat).
  const res = await fetch(endpoint('/sync'), { method: 'POST', body: JSON.stringify({ id: deviceId(), code, data }), headers: { 'Content-Type': 'text/plain' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`sync ${res.status}`)
  return ((await res.json()) as { code: string }).code
}

function remember(code: string) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code)
    else localStorage.removeItem(CODE_KEY)
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(new Event('kp-sync-updated'))
}

/** Makes a new code holding this device's progress and list. Throws if the server can't be reached. */
export async function createSync(): Promise<string> {
  const code = await save(snapshot())
  if (!code) throw new Error('sync create')
  remember(code)
  return code
}

/** Joins a code made on another device. False if that code doesn't exist. */
export async function joinSync(typed: string): Promise<boolean> {
  const code = cleanCode(typed)
  if (code.length !== 8) return false
  const remote = await load(code)
  if (!remote) return false
  const merged = merge(snapshot(), remote)
  apply(merged)
  await save(merged, code)
  remember(code)
  return true
}

export const leaveSync = () => remember('')

let busy = false

/** Brings this device and the saved copy up to date with each other. Quietly does nothing offline. */
export async function syncNow(): Promise<void> {
  const code = syncCode()
  if (!code || busy || !syncEnabled()) return
  busy = true
  try {
    const remote = await load(code)
    // The code is gone from the server (a year unused, or replaced): stop using it.
    if (!remote) return remember('')
    const local = snapshot()
    const merged = merge(local, remote)
    if (canon(merged) !== canon(local)) apply(merged)
    if (canon(merged) !== canon({ progress: remote.progress ?? {}, list: remote.list ?? {}, seen: remote.seen ?? {} })) await save(merged, code)
  } catch {
    // offline: the next change or launch tries again
  } finally {
    busy = false
  }
}

export function startSync(): () => void {
  if (!syncEnabled()) return () => undefined
  let timer = 0
  const later = () => {
    // Not restarted on every change: the player saves progress every few seconds, and a timer that
    // kept resetting would never fire during a movie.
    if (applying || timer || !syncCode()) return
    timer = window.setTimeout(() => {
      timer = 0
      syncNow()
    }, PUSH_DELAY_MS)
  }
  // Coming back to the app is when another device's progress is most likely waiting.
  const onVisible = () => document.visibilityState === 'visible' && syncNow()
  syncNow()
  window.addEventListener('kp-progress-updated', later)
  window.addEventListener('kp-library-updated', later)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    window.clearTimeout(timer)
    window.removeEventListener('kp-progress-updated', later)
    window.removeEventListener('kp-library-updated', later)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
