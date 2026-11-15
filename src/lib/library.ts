// "Mi lista" and the movies marked as watched, kept on this device.
//
// Each entry is a timestamp: positive = switched on at that moment, negative = switched off. Keeping
// the "off" is what lets two synced devices agree on a removal instead of bringing the movie back.

const STORAGE_KEY = 'kp_library_v1'
const HIDE_SEEN_KEY = 'kp_hide_seen'

export interface Library {
  list: Record<string, number>
  seen: Record<string, number>
}

export function getLibrary(): Library {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<Library>
    return { list: raw.list ?? {}, seen: raw.seen ?? {} }
  } catch {
    return { list: {}, seen: {} }
  }
}

export function saveLibrary(lib: Library): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lib))
    window.dispatchEvent(new Event('kp-library-updated'))
  } catch {
    // ignore storage errors
  }
}

function set(kind: keyof Library, movieId: string, on: boolean) {
  const lib = getLibrary()
  if (lib[kind][movieId] > 0 === on) return
  lib[kind][movieId] = on ? Date.now() : -Date.now()
  saveLibrary(lib)
}

export const inList = (movieId: string) => getLibrary().list[movieId] > 0
export const isSeen = (movieId: string) => getLibrary().seen[movieId] > 0
export const setInList = (movieId: string, on: boolean) => set('list', movieId, on)
export const setSeen = (movieId: string, on: boolean) => set('seen', movieId, on)

export function hideSeen(): boolean {
  try {
    return localStorage.getItem(HIDE_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function setHideSeen(on: boolean): void {
  try {
    localStorage.setItem(HIDE_SEEN_KEY, on ? '1' : '0')
    window.dispatchEvent(new Event('kp-library-updated'))
  } catch {
    // ignore storage errors
  }
}
