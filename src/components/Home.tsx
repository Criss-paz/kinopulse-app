import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Movie } from '../types'
import { categories, formatDuration, movies, moviesByCategory, refreshLiveCatalog } from '../lib/catalog'
import { DONATE_URL } from '../lib/config'
import { getLibrary, hideSeen, setHideSeen } from '../lib/library'
import { getAllProgress } from '../lib/progress'
import { categoryOrder } from '../lib/sagas'
import { focusFirst } from '../lib/spatial'
import { cachedTop, refreshTop } from '../lib/stats'
import { MovieCard, Row } from './Row'

interface Props {
  onOpen: (m: Movie) => void
  onPlay: (m: Movie) => void
  searchQuery: string
  selectedCategory: string
  onSelectCategory: (id: string) => void
  onOpenMore: () => void
  /** Película que se abrió por última vez: al volver, el foco regresa a su tarjeta. */
  lastOpenedId?: string
}

// Abrir una película desmonta el inicio, así que su posición se guarda aquí (fuera del
// componente, que es lo que se destruye) y se restaura al volver. Sin esto, volver de una
// ficha o del reproductor dejaba al usuario arriba del todo, perdiendo la fila donde estaba.
let savedView: { y: number; rows: Record<string, number> } | null = null

// «Mi lista» se elige en la misma barra que las categorías.
const MY_LIST = 'mylist'
const RECENT_COUNT = 20

// Cada botón de filtro va pasando por sus opciones al pulsarlo: con control remoto es un solo
// botón por filtro en vez de un menú desplegable.
const SORTS: [label: string, compare: ((a: Movie, b: Movie) => number) | null][] = [
  ['Recomendado', null],
  ['Más nuevas', (a, b) => b.year - a.year],
  ['Más antiguas', (a, b) => a.year - b.year],
  ['A–Z', (a, b) => a.title.localeCompare(b.title, 'es')],
  ['Más cortas', (a, b) => a.duration - b.duration],
  ['Más largas', (a, b) => b.duration - a.duration],
]
const YEARS: [label: string, test: (year: number) => boolean][] = [
  ['Todos', () => true],
  ['2020 en adelante', (y) => y >= 2020],
  ['2010 – 2019', (y) => y >= 2010 && y < 2020],
  ['2000 – 2009', (y) => y >= 2000 && y < 2010],
  ['Antes de 2000', (y) => y < 2000],
]
const LENGTHS: [label: string, test: (min: number) => boolean][] = [
  ['Cualquiera', () => true],
  ['Menos de 1 h 40', (d) => d < 100],
  ['1 h 40 a 2 h 10', (d) => d >= 100 && d <= 130],
  ['Más de 2 h 10', (d) => d > 130],
]

// Fuera del componente por lo mismo que savedView: que al volver de una ficha sigan puestos.
let savedFilters = { sort: 0, year: 0, length: 0 }

// Los ids son correlativos (kp_001, kp_002…): el más alto es la película agregada más reciente.
const idNumber = (m: Movie) => Number(m.id.replace(/\D/g, '')) || 0

export default function Home({ onOpen, onPlay, searchQuery, selectedCategory, onSelectCategory, onOpenMore, lastOpenedId }: Props) {
  const [, setTick] = useState(0)
  const [hero, setHero] = useState<Movie>(() => movies[0])
  const [filters, setFiltersState] = useState(savedFilters)
  const setFilters = (next: typeof savedFilters) => {
    savedFilters = next
    setFiltersState(next)
  }

  // En una ref para que el efecto sea solo de montaje/desmontaje: si fuera dependencia,
  // cambiar de película con el inicio montado volvería a mover el foco.
  const lastOpenedRef = useRef(lastOpenedId)
  lastOpenedRef.current = lastOpenedId

  // Antes de que el navegador pinte: así no se ve el salto al inicio y de vuelta.
  useLayoutEffect(() => {
    const rows = () => document.querySelectorAll<HTMLElement>('main [data-nav-group]')

    const restore = () => {
      if (!savedView) return
      window.scrollTo({ top: savedView.y, behavior: 'auto' })
      rows().forEach((row) => {
        const left = savedView!.rows[row.dataset.navGroup ?? '']
        if (left != null) row.scrollLeft = left
      })
    }

    if (savedView) {
      restore()
      // Las portadas son lazy: si alguna llega tarde, la altura cambia y la posición se
      // va. Un segundo intento tras el primer fotograma la deja en su sitio.
      requestAnimationFrame(restore)
      // El foco se devuelve a la tarjeta de la que se salió, sin mover el scroll que
      // acabamos de restaurar (focusEl lo recentraría).
      const openedId = lastOpenedRef.current
      const card = openedId
        ? document.querySelector<HTMLElement>(`main [data-movie-id="${CSS.escape(openedId)}"]`)
        : null
      if (card) card.focus({ preventScroll: true })
      else focusFirst()
    } else {
      focusFirst()
    }

    return () => {
      const map: Record<string, number> = {}
      rows().forEach((row) => {
        const key = row.dataset.navGroup
        if (key) map[key] = row.scrollLeft
      })
      savedView = { y: window.scrollY, rows: map }
    }
  }, [])

  useEffect(() => {
    refreshLiveCatalog()
    refreshTop()
    const rerender = () => {
      setTick((t) => t + 1)
      setHero((prev) => movies.find((m) => m.id === prev?.id) || movies[0])
    }
    window.addEventListener('kp-catalog-updated', rerender)
    window.addEventListener('kp-progress-updated', rerender)
    window.addEventListener('kp-library-updated', rerender)
    window.addEventListener('kp-top-updated', rerender)
    return () => {
      window.removeEventListener('kp-catalog-updated', rerender)
      window.removeEventListener('kp-progress-updated', rerender)
      window.removeEventListener('kp-library-updated', rerender)
      window.removeEventListener('kp-top-updated', rerender)
    }
  }, [])

  const progressMap = getAllProgress()
  const library = getLibrary()
  const seen = (m: Movie) => library.seen[m.id] > 0
  const hidingSeen = hideSeen()
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

  const renderCard = (m: Movie) => (
    <MovieCard key={m.id} movie={m} onOpen={onOpen} onHover={setHero} progress={progressMap[m.id]} seen={seen(m)} />
  )

  // Con «Ocultar vistas», las ya vistas salen de las filas para descubrir; no de las propias
  // (Mi lista, Continuar viendo) ni de una búsqueda por nombre.
  const unseen = (list: Movie[]) => (hidingSeen ? list.filter((m) => !seen(m)) : list)

  const myList = movies.filter((m) => library.list[m.id] > 0).sort((a, b) => library.list[b.id] - library.list[a.id])
  const recent = unseen([...movies].sort((a, b) => idNumber(b) - idNumber(a)).slice(0, RECENT_COUNT))
  const mostWatched = unseen(cachedTop().map((id) => movies.find((m) => m.id === id)).filter((m): m is Movie => !!m))

  // Categorías que realmente tienen películas cargadas
  const activeCategories = categories.filter((c) => moviesByCategory(c.id).length > 0)

  const filtering = filters.sort !== 0 || filters.year !== 0 || filters.length !== 0
  const showGrid = q !== '' || selectedCategory !== 'all' || filtering

  // Filtrar según categoría, búsqueda y filtros
  const compare = SORTS[filters.sort][1]
  const matching = (selectedCategory === MY_LIST ? myList : movies).filter((m) => {
    const catOk = selectedCategory === 'all' || selectedCategory === MY_LIST || m.category === selectedCategory
    return catOk && matchesSearch(m) && YEARS[filters.year][1](m.year) && LENGTHS[filters.length][1](m.duration)
  })
  const filteredMovies = q !== '' || selectedCategory === MY_LIST ? matching : unseen(matching)
  if (compare) filteredMovies.sort(compare)

  const gridTitle =
    q !== ''
      ? `Resultados para "${searchQuery}" (${filteredMovies.length})`
      : `${selectedCategory === MY_LIST ? 'Mi lista' : activeCategories.find((c) => c.id === selectedCategory)?.name || 'Todas las películas'} (${filteredMovies.length})`

  const cycle = (key: keyof typeof savedFilters, options: unknown[]) => setFilters({ ...filters, [key]: (filters[key] + 1) % options.length })

  return (
    <main>
      {/* Hero Banner (oculto al buscar para que los resultados queden a la vista) */}
      {q === '' && <section className="relative h-[58vh] min-h-[340px] w-full overflow-hidden md:h-[68vh]">
        <img src={hero.backdrop} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-sm" />
        <div className="absolute inset-0 bg-gradient-to-r from-obsidian-950 via-obsidian-950/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-obsidian-950 via-transparent to-transparent" />
        <div className="relative flex h-full max-w-3xl flex-col justify-end gap-3 px-4 pb-8 md:px-12">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-pulse-cyan">Destacado</p>
          <h1 className="text-3xl font-black text-white md:text-5xl">{hero.title}</h1>
          <p className="text-sm text-white/70 md:text-base">
            {hero.year} • {formatDuration(hero.duration)} • {hero.rating}
          </p>
          <p className="line-clamp-2 text-sm text-white/85 md:text-base">{hero.synopsis}</p>
          <div className="flex gap-3 pt-1" data-nav-group="hero">
            <button data-nav data-nav-autofocus className="kp-btn kp-btn-primary" onClick={() => onPlay(hero)}>
              ▶ Reproducir
            </button>
            <button data-nav className="kp-btn" onClick={() => onOpen(hero)}>
              ℹ Más información
            </button>
          </div>
        </div>
      </section>}

      {/* Barra de Filtros de Categorías (Navegable con Control Remoto) */}
      <div className="relative z-10 px-4 pt-2 pb-4 md:px-12">
        <div data-nav-group="category-chips" className="flex items-center gap-2 overflow-x-auto py-2">
          <button
            data-nav
            onClick={() => onSelectCategory('all')}
            className={`kp-btn kp-btn-sm shrink-0 ${selectedCategory === 'all' ? 'kp-btn-primary' : ''}`}
          >
            Todas
          </button>
          {(myList.length > 0 || selectedCategory === MY_LIST) && (
            <button
              data-nav
              onClick={() => onSelectCategory(MY_LIST)}
              className={`kp-btn kp-btn-sm shrink-0 ${selectedCategory === MY_LIST ? 'kp-btn-primary' : ''}`}
            >
              ★ Mi lista
            </button>
          )}
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
        <div data-nav-group="filters" className="flex items-center gap-2 overflow-x-auto py-2">
          <button data-nav className={`kp-btn kp-btn-sm shrink-0 ${filters.sort ? 'kp-btn-active' : ''}`} onClick={() => cycle('sort', SORTS)}>
            ⇅ Orden: {SORTS[filters.sort][0]}
          </button>
          <button data-nav className={`kp-btn kp-btn-sm shrink-0 ${filters.year ? 'kp-btn-active' : ''}`} onClick={() => cycle('year', YEARS)}>
            Año: {YEARS[filters.year][0]}
          </button>
          <button data-nav className={`kp-btn kp-btn-sm shrink-0 ${filters.length ? 'kp-btn-active' : ''}`} onClick={() => cycle('length', LENGTHS)}>
            Duración: {LENGTHS[filters.length][0]}
          </button>
          <button data-nav className={`kp-btn kp-btn-sm shrink-0 ${hidingSeen ? 'kp-btn-active' : ''}`} onClick={() => setHideSeen(!hidingSeen)} aria-pressed={hidingSeen}>
            {hidingSeen ? '✓ Ocultando las ya vistas' : 'Ocultar las ya vistas'}
          </button>
          {filtering && (
            <button data-nav className="kp-btn kp-btn-sm shrink-0" onClick={() => setFilters({ sort: 0, year: 0, length: 0 })}>
              ✕ Quitar filtros
            </button>
          )}
        </div>
      </div>

      <div className="relative space-y-8 pb-16">
        {/* Si el usuario está buscando texto o eligió una categoría específica, mostrar cuadrícula filtrada */}
        {showGrid ? (
          <section className="px-4 md:px-12">
            <h2 className="mb-4 text-xl font-bold text-white md:text-2xl">
              {gridTitle}
            </h2>
            {filteredMovies.length === 0 ? (
              <p className="py-12 text-center text-white/60">
                {selectedCategory === MY_LIST && !q && !filtering
                  ? 'Tu lista está vacía. Abre una película y pulsa «Mi lista» para guardarla aquí.'
                  : 'No se encontraron películas que coincidan con tu búsqueda.'}
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
                <Row group="continue-watching">{continueWatching.map(renderCard)}</Row>
              </section>
            )}

            {myList.length > 0 && (
              <section>
                <h2 className="mb-3 px-4 text-xl font-bold text-white md:px-12 md:text-2xl">★ Mi lista</h2>
                <Row group="my-list">{myList.map(renderCard)}</Row>
              </section>
            )}

            {recent.length > 0 && (
              <section>
                <h2 className="mb-3 px-4 text-xl font-bold text-white md:px-12 md:text-2xl">Recién agregadas</h2>
                <Row group="recent">{recent.map(renderCard)}</Row>
              </section>
            )}

            {mostWatched.length > 0 && (
              <section>
                <h2 className="mb-3 px-4 text-xl font-bold text-white md:px-12 md:text-2xl">Lo más visto en KinoPulse</h2>
                <Row group="most-watched">{mostWatched.map(renderCard)}</Row>
              </section>
            )}

            {activeCategories.map((c) => {
              const list = unseen(categoryOrder(moviesByCategory(c.id)))
              if (!list.length) return null
              return (
                <section key={c.id}>
                  <h2 className="mb-3 px-4 text-xl font-bold text-white md:px-12 md:text-2xl">{c.name}</h2>
                  <Row group={c.id}>{list.map(renderCard)}</Row>
                </section>
              )
            })}
          </>
        )}

        {DONATE_URL && q === '' && (
          <section className="px-4 md:px-12">
            <div data-nav-group="donate" className="kp-panel md:flex-row md:items-center md:justify-between">
              <div>
                <p className="kp-panel-title">☕ ¿Te gusta KinoPulse?</p>
                <p className="text-white/70">Invítame un café: es gratis y sin anuncios, y cualquier monto ayuda a mantenerla.</p>
              </div>
              <button data-nav className="kp-btn shrink-0" onClick={onOpenMore}>
                Invitar un café
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
