import { useEffect, useState } from 'react'
import type { Movie } from '../types'
import { formatDuration } from '../lib/catalog'
import { getMovieProgress, formatTimeMMSS } from '../lib/progress'
import { focusFirst } from '../lib/spatial'

export default function Details({ movie, onPlay, onBack }: { movie: Movie; onPlay: (fromStart?: boolean) => void; onBack: () => void }) {
  const [, setTick] = useState(0)

  useEffect(() => {
    focusFirst()
  }, [movie])

  // Al volver del reproductor, el último progreso se guarda justo después de dibujar esta ficha.
  useEffect(() => {
    const refresh = () => setTick((t) => t + 1)
    window.addEventListener('kp-progress-updated', refresh)
    return () => window.removeEventListener('kp-progress-updated', refresh)
  }, [])

  const saved = getMovieProgress(movie.id)

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
          {saved && (
            <div className="max-w-md space-y-1.5">
              <p className="text-sm font-medium text-pulse-cyan">
                En progreso: {formatTimeMMSS(saved.time)} / {formatTimeMMSS(saved.duration)}
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full bg-pulse-red"
                  style={{ width: `${Math.min(95, (saved.time / saved.duration) * 100)}%` }}
                />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            <button data-nav data-nav-autofocus className="kp-btn kp-btn-primary" onClick={() => onPlay()}>
              ▶ {saved ? `Continuar (${formatTimeMMSS(saved.time)})` : 'Reproducir'}
            </button>
            {saved && (
              <button data-nav className="kp-btn" onClick={() => onPlay(true)}>
                ⟲ Desde el principio
              </button>
            )}
            <button data-nav className="kp-btn" onClick={onBack}>
              ← Volver
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
