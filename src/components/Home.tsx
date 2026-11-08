import { useEffect, useState } from 'react'
import type { Movie } from '../types'
import { categories, formatDuration, movies, moviesByCategory, refreshLiveCatalog } from '../lib/catalog'
import { getAllProgress, formatTimeMMSS } from '../lib/progress'
import { focusFirst } from '../lib/spatial'

interface Props {
  onOpen: (m: Movie) => void
  onPlay: (m: Movie) => void
  searchQuery: string
  selectedCategory: string
  onSelectCategory: (id: string) => void
}

export default function Home({ onOpen, onPlay, searchQuery, selectedCategory, onSelectCategory }: Props) {
  const [, setTick] = useState(0)
  const [hero, setHero] = useState<Movie>(() => movies[0])

  useEffect(() => {
    focusFirst()
    refreshLiveCatalog()
    const rerender = () => {
      setTick((t) => t + 1)
      setHero((prev) => movies.find((m) => m.id === prev?.id) || movies[0])
    }
    window.addEventListener('kp-catalog-updated', rerender)
    window.addEventListener('kp-progress-updated', rerender)
    return () => {
      window.removeEventListener('kp-catalog-updated', rerender)
      window.removeEventListener('kp-progress-updated', rerender)
    }
  }, [])

  const progressMap = getAllProgress()
  const q = searchQuery.trim().toLowerCase()

  const matchesSearch = (m: Movie) =>
    !q ||
    m.title.toLowerCase().includes(q) ||
    m.synopsis.toLowerCase().includes(q) ||
    String(m.year).includes(q)

  const continueWatching = movies
    .filter((m) => {
      const p = progressMap[m.id]
      return p && p.time >= 15 && p.duration > 0 && p.time / p.duration < 0.95 && matchesSearch(m)
    })
    .sort((a, b) => (progressMap[b.id]?.updatedAt || 0) - (progressMap[a.id]?.updatedAt || 0))

  if (!hero) return null

  const renderCard = (m: Movie) => {
    const p = progressMap[m.id]
    const pct = p && p.duration > 0 ? Math.min(95, Math.max(5, (p.time / p.duration) * 100)) : 0
    return (
      <button
        key={m.id}
        data-nav
        className="kp-card group relative aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-xl bg-obsidian-800 sm:w-40 md:w-48"
        onFocus={() => setHero(m)}
        onMouseEnter={() => setHero(m)}
        onClick={() => onOpen(m)}
        aria-label={`${m.title} (${m.year})`}
      >
        <img src={m.poster} alt="" loading="lazy" className="h-full w-full object-cover" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-2 pb-3 text-left">
          <p className="truncate text-sm font-semibold text-white">{m.title}</p>
          <p className="text-xs text-white/60">
            {pct > 0 ? `Quedaste en ${formatTimeMMSS(p.time)}` : m.year}
          </p>
        </div>
        {pct > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/25">
            <div className="h-full bg-pulse-red" style={{ width: `${pct}%` }} />
          </div>
        )}
      </button>
    )
  }

  // Categor?as que realmente tienen pel?culas cargadas
  const activeCategories = categories.filter((c) => moviesByCategory(c.id).length > 0)

  // Filtrar seg?n categor?a o b?squeda
  const filteredMovies = movies.filter((m) => {
    const catOk = selectedCategory === 'all' || m.category === selectedCategory
    return catOk && matchesSearch(m)
  })

  return (
    <main>
      {/* Hero Banner */}
      <section className="relative h-[58vh] min-h-[340px] w-full overflow-hidden md:h-[68vh]">
        <img src={hero.backdrop} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-sm" />
        <div className="absolute inset-0 bg-gradient-to-r from-obsidian-950 via-obsidian-950/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-obsidian-950 via-transparent to-transparent" />
        <div className="relative flex h-full max-w-3xl flex-col justify-end gap-3 px-4 pb-8 md:px-12">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-pulse-cyan">Destacado</p>
          <h1 className="text-3xl font-black text-white md:text-5xl">{hero.title}</h1>
          <p className="text-sm text-white/70 md:text-base">
            {hero.year} ? {formatDuration(hero.duration)} ? {hero.rating}
          </p>
          <p className="line-clamp-2 text-sm text-white/85 md:text-base">{hero.synopsis}</p>
          <div className="flex gap-3 pt-1" data-nav-group="hero">
            <button data-nav data-nav-autofocus className="kp-btn kp-btn-primary" onClick={() => onPlay(hero)}>
              ? Reproducir
            </button>
            <button data-nav className="kp-btn" onClick={() => onOpen(hero)}>
              ? M?s informaci?n
            </button>
          </div>
        </div>
      </section>

      {/* Barra de Filtros de Categor?as (Navegable con Control Remoto) */}
      <div className="relative z-10 px-4 pt-2 pb-4 md:px-12">
        <div data-nav-group="category-chips" className="flex items-center gap-2 overflow-x-auto py-2">
          <button
            data-nav
            onClick={() => onSelectCategory('all')}
            className={`kp-btn kp-btn-sm shrink-0 ${selectedCategory === 'all' ? 'kp-btn-primary' : ''}`}
          >
            Todas
          </button>
          {activeCategories.map((c) => (
            <button
              key={c.id}
              data-nav
              onClick={() => onSelectCategory(c.id)}
              className={`kp-btn kp-btn-sm shrink-0 ${selectedCategory === c.id ? 'kp-btn-primary' : ''}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="relative space-y-8 pb-16">
        {/* Si el usuario est? buscando texto o eligi? una categor?a espec?fica, mostrar cuadr?cula filtrada */}
        {(q !== '' || selectedCategory !== 'all') ? (
          <section className="px-4 md:px-12">
            <h2 className="mb-4 text-xl font-bold text-white md:text-2xl">
              {q !== ''
                ? `Resultados para "${searchQuery}" (${filteredMovies.length})`
                : activeCategories.find((c) => c.id === selectedCategory)?.name || 'Pel?culas'}
            </h2>
            {filteredMovies.length === 0 ? (
              <p className="py-12 text-center text-white/60">
                No se encontraron pel?culas que coincidan con tu b?squeda.
              </p>
            ) : (
              <div data-nav-group="filtered-grid" className="flex flex-wrap gap-4 py-2 md:gap-6">
                {filteredMovies.map(renderCard)}
              </div>
            )}
          </section>
        ) : (
          <>
            {continueWatching.length > 0 && (
              <section>
                <h2 className="mb-3 px-4 text-xl font-bold text-white md:px-12 md:text-2xl">Continuar viendo</h2>
                <div data-nav-group="continue-watching" className="kp-row flex gap-3 overflow-x-auto px-4 py-4 md:gap-5 md:px-12">
                  {continueWatching.map(renderCard)}
                </div>
              </section>
            )}

            {activeCategories.map((c) => {
              const list = moviesByCategory(c.id)
              if (!list.length) return null
              return (
                <section key={c.id}>
                  <h2 className="mb-3 px-4 text-xl font-bold text-white md:px-12 md:text-2xl">{c.name}</h2>
                  <div data-nav-group={c.id} className="kp-row flex gap-3 overflow-x-auto px-4 py-4 md:gap-5 md:px-12">
                    {list.map(renderCard)}
                  </div>
                </section>
              )
            })}
          </>
        )}
      </div>
    </main>
  )
}
