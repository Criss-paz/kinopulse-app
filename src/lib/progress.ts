export interface WatchProgress {
  time: number
  duration: number
  updatedAt: number
}

const STORAGE_KEY = 'kp_watch_progress_v1'

export function getAllProgress(): Record<string, WatchProgress> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
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
    if (time / duration >= 0.95) {
      delete all[movieId]
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
    delete all[movieId]
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
