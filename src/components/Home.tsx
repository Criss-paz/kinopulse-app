import { useEffect, useState } from 'react'
import type { Movie } from '../types'
import { categories, formatDuration, movies, moviesByCategory } from '../lib/catalog'
import { focusFirst } from '../lib/spatial'

interface Props {
  onOpen: (m: Movie) => void
  onPlay: (m: Movie) => void
}

export default function Home({ onOpen, onPlay }: Props) {
  const [hero, setHero] = useState<Movie>(movies[0])

  useEffect(() => {
    focusFirst()
  }, [])

  return (
    <main>
      <section className="relative h-[62vh] min-h-[360px] w-full overflow-hidden md:h-[70vh]">
        <img src={hero.backdrop} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-sm" />
        <div className="absolute inset-0 bg-gradient-to-r from-obsidian-950 via-obsidian-950/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-obsidian-950 via-transparent to-transparent" />
        <div className="relative flex h-full max-w-3xl flex-col justify-end gap-4 px-4 pb-10 md:px-12">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-pulse-cyan">Destacado</p>
          <h1 className="text-4xl font-black text-white md:text-6xl">{hero.title}</h1>
          <p className="text-sm text-white/70 md:text-base">
            {hero.year} · {formatDuration(hero.duration)} · {hero.rating} · {hero.license}
          </p>
          <p className="line-clamp-3 text-base text-white/85 md:text-lg">{hero.synopsis}</p>
          <div className="flex gap-3" data-nav-group="hero">
            <button data-nav data-nav-autofocus className="kp-btn kp-btn-primary" onClick={() => onPlay(hero)}>
              ▶ Reproducir
            </button>
            <button data-nav className="kp-btn" onClick={() => onOpen(hero)}>
              ⓘ Más info
            </button>
          </div>
        </div>
      </section>

      <div className="relative -mt-6 space-y-8 pb-16">
        {categories.map((c) => {
          const list = moviesByCategory(c.id)
          if (!list.length) return null
          return (
            <section key={c.id}>
              <h2 className="mb-3 px-4 text-xl font-bold text-white md:px-12 md:text-2xl">{c.name}</h2>
              <div data-nav-group={c.id} className="kp-row flex gap-3 overflow-x-auto px-4 py-4 md:gap-5 md:px-12">
                {list.map((m) => (
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
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 text-left">
                      <p className="truncate text-sm font-semibold text-white">{m.title}</p>
                      <p className="text-xs text-white/60">{m.year}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </main>
  )
}
