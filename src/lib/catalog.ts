import raw from '../data/catalog.json'
import type { Catalog, Movie } from '../types'

const catalog = raw as Catalog

export const categories = catalog.categories
export const movies: Movie[] = catalog.movies.filter((m) => !m.draft && m.stream)

export const moviesByCategory = (id: string) => movies.filter((m) => m.category === id)

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h} h ${m} min` : `${m} min`
}
