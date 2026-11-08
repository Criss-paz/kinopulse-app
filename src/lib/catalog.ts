import raw from '../data/catalog.json'
import type { Catalog, Category, Movie } from '../types'
import { REPO } from './config'

const CACHE_KEY = 'kp_live_catalog_cache_v1'
const LIVE_CATALOG_URL = `https://raw.githubusercontent.com/${REPO}/main/src/data/catalog.json`

function loadInitialCatalog(): Catalog {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (cached) {
      const parsed = JSON.parse(cached) as Catalog
      if (Array.isArray(parsed.movies) && parsed.movies.length > 0) {
        return parsed
      }
    }
  } catch {
    // fallback to bundled
  }
  return raw as Catalog
}

let currentCatalog: Catalog = loadInitialCatalog()

export let categories: Category[] = currentCatalog.categories
export let movies: Movie[] = currentCatalog.movies.filter((m) => !m.draft && m.stream)

export const moviesByCategory = (id: string) => movies.filter((m) => m.category === id)

export async function refreshLiveCatalog(): Promise<boolean> {
  try {
    const res = await fetch(`${LIVE_CATALOG_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return false
    const live = (await res.json()) as Catalog
    if (!live || !Array.isArray(live.movies) || !Array.isArray(live.categories)) return false
    currentCatalog = live
    categories = live.categories
    movies = live.movies.filter((m) => !m.draft && m.stream)
    localStorage.setItem(CACHE_KEY, JSON.stringify(live))
    window.dispatchEvent(new Event('kp-catalog-updated'))
    return true
  } catch {
    return false
  }
}

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h} h ${m} min` : `${m} min`
}
