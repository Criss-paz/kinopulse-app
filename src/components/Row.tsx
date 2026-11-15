import { useRef, type ReactNode } from 'react'
import type { Movie } from '../types'
import { formatTimeMMSS, type WatchProgress } from '../lib/progress'

// Fila horizontal; con ratón muestra flechas para avanzar/retroceder una pantalla.
export function Row({ group, children }: { group: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const page = (dir: 1 | -1) => {
    const el = ref.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }
  return (
    <div className="group/row relative">
      <button tabIndex={-1} className="kp-row-arrow left-0" onClick={() => page(-1)} aria-label="Anterior">
        ‹
      </button>
      <div ref={ref} data-nav-group={group} className="kp-row flex gap-3 overflow-x-auto px-4 py-4 md:gap-5 md:px-12">
        {children}
      </div>
      <button tabIndex={-1} className="kp-row-arrow right-0" onClick={() => page(1)} aria-label="Siguiente">
        ›
      </button>
    </div>
  )
}

interface CardProps {
  movie: Movie
  onOpen: (m: Movie) => void
  onHover?: (m: Movie) => void
  progress?: WatchProgress
  seen?: boolean
  /** Texto bajo el título en lugar del año (p. ej. «Parte 2 · 1990»). */
  note?: string
  /** La película de la ficha abierta, dentro de la fila de su saga. */
  current?: boolean
}

export function MovieCard({ movie: m, onOpen, onHover, progress: p, seen, note, current }: CardProps) {
  const pct = p && p.time >= 15 && p.duration > 0 ? Math.min(95, Math.max(5, (p.time / p.duration) * 100)) : 0
  return (
    <button
      data-nav
      data-movie-id={m.id}
      className={`kp-card group relative aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-xl bg-obsidian-800 sm:w-40 md:w-48 ${current ? 'ring-2 ring-pulse-cyan' : ''}`}
      onFocus={onHover && (() => onHover(m))}
      onMouseEnter={onHover && (() => onHover(m))}
      onClick={() => onOpen(m)}
      aria-label={`${m.title} (${m.year})${seen ? ', ya vista' : ''}`}
    >
      <img src={m.poster} alt="" loading="lazy" className={`h-full w-full object-cover ${seen ? 'opacity-60' : ''}`} />
      {seen && <span className="absolute right-2 top-2 rounded-full bg-black/75 px-2 py-0.5 text-xs font-bold text-pulse-cyan">✓ Vista</span>}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-2 pb-3 text-left">
        <p className="truncate text-sm font-semibold text-white">{m.title}</p>
        <p className="truncate text-xs text-white/60">{pct > 0 ? `Quedaste en ${formatTimeMMSS(p!.time)}` : note ?? m.year}</p>
      </div>
      {pct > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/25">
          <div className="h-full bg-pulse-red" style={{ width: `${pct}%` }} />
        </div>
      )}
    </button>
  )
}
