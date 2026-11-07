import { useEffect } from 'react'
import type { Movie } from '../types'
import { formatDuration } from '../lib/catalog'
import { focusFirst } from '../lib/spatial'

export default function Details({ movie, onPlay, onBack }: { movie: Movie; onPlay: () => void; onBack: () => void }) {
  useEffect(() => {
    focusFirst()
  }, [movie])

  return (
    <div data-nav-scope className="fixed inset-0 z-40 overflow-y-auto bg-obsidian-950">
      <img src={movie.backdrop} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-md" />
      <div className="absolute inset-0 bg-gradient-to-t from-obsidian-950 via-obsidian-950/60 to-obsidian-950/30" />
      <div className="relative mx-auto flex min-h-full max-w-6xl flex-col gap-8 px-4 py-10 md:flex-row md:items-center md:px-12">
        <img src={movie.poster} alt="" className="mx-auto w-48 rounded-2xl shadow-2xl shadow-black md:mx-0 md:w-72" />
        <div className="flex-1 space-y-5">
          <h1 className="text-4xl font-black text-white md:text-6xl">{movie.title}</h1>
          <p className="text-white/70">
            {movie.year} · {formatDuration(movie.duration)} · {movie.rating}
          </p>
          <p className="max-w-2xl text-lg leading-relaxed text-white/90">{movie.synopsis}</p>
          <p className="text-sm text-white/50">
            Licencia: {movie.license} ·{' '}
            <a href={movie.source} target="_blank" rel="noopener noreferrer" className="underline">
              fuente
            </a>
          </p>
          <div className="flex gap-3 pt-2">
            <button data-nav data-nav-autofocus className="kp-btn kp-btn-primary" onClick={onPlay}>
              ▶ Reproducir
            </button>
            <button data-nav className="kp-btn" onClick={onBack}>
              ← Volver
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
