import { setSeen } from './library'

// An entry with time 0 means "no progress, on purpose" (finished or restarted). It is kept instead
// of deleted so a synced device doesn't bring the old position back.
export interface WatchProgress {
  time: number
  duration: number
  updatedAt: number
}

const STORAGE_KEY = 'kp_watch_progress_v1'
const FINISHED = 0.95

export function getAllProgress(): Record<string, WatchProgress> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function replaceAllProgress(all: Record<string, WatchProgress>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    window.dispatchEvent(new Event('kp-progress-updated'))
  } catch {
    // ignore storage errors
  }
}

export function getMovieProgress(movieId: string): WatchProgress | null {
  const all = getAllProgress()
  const item = all[movieId]
  if (!item || item.time < 15) return null
  if (item.duration > 0 && item.time / item.duration > 0.95) return null
  return item
}

export function saveMovieProgress(movieId: string, time: number, duration: number): void {
  if (!isFinite(time) || !isFinite(duration) || duration <= 0) return
  try {
    const all = getAllProgress()
    if (time / duration >= FINISHED) {
      all[movieId] = { time: 0, duration: Math.floor(duration), updatedAt: Date.now() }
      setSeen(movieId, true)
    } else if (time >= 10) {
      all[movieId] = { time: Math.floor(time), duration: Math.floor(duration), updatedAt: Date.now() }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    window.dispatchEvent(new Event('kp-progress-updated'))
  } catch {
    // ignore storage errors
  }
}

export function clearMovieProgress(movieId: string): void {
  try {
    const all = getAllProgress()
    if (!all[movieId]) return
    all[movieId] = { ...all[movieId], time: 0, updatedAt: Date.now() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    window.dispatchEvent(new Event('kp-progress-updated'))
  } catch {
    // ignore
  }
}

export function formatTimeMMSS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = (s % 60).toString().padStart(2, '0')
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
