import { useEffect, useRef, useState } from 'react'
import type { Movie } from '../types'
import { formatDuration } from '../lib/catalog'
import { getLibrary, setInList, setSeen } from '../lib/library'
import { getAllProgress, getMovieProgress, formatTimeMMSS } from '../lib/progress'
import { sagaOf, similarTo } from '../lib/sagas'
import { focusFirst } from '../lib/spatial'
import { reportProblem, statsEnabled, type ReportKind } from '../lib/stats'
import { MovieCard, Row } from './Row'

const PROBLEMS: [kind: ReportKind, label: string][] = [
  ['no_carga', 'No carga o no se reproduce'],
  ['tirones', 'Se ve a tirones o se traba'],
  ['audio', 'Sin sonido o audio mal'],
  ['subtitulos', 'Idioma o subtítulos equivocados'],
  ['otro', 'Otra cosa'],
]

interface Props {
  movie: Movie
  onPlay: (fromStart?: boolean) => void
  onOpen: (m: Movie) => void
  onBack: () => void
}

export default function Details({ movie, onPlay, onOpen, onBack }: Props) {
  const [, setTick] = useState(0)
  // 'ask' muestra las opciones; 'sent' da las gracias.
  const [report, setReport] = useState<'' | 'ask' | 'sent'>('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Abrir otra película desde las filas de abajo reutiliza esta ficha: vuelve arriba.
    scrollRef.current?.scrollTo({ top: 0 })
    setReport('')
    focusFirst()
  }, [movie])

  // Al volver del reproductor, el último progreso se guarda justo después de dibujar esta ficha.
  useEffect(() => {
    const refresh = () => setTick((t) => t + 1)
    window.addEventListener('kp-progress-updated', refresh)
    window.addEventListener('kp-library-updated', refresh)
    return () => {
      window.removeEventListener('kp-progress-updated', refresh)
      window.removeEventListener('kp-library-updated', refresh)
    }
  }, [])

  const saved = getMovieProgress(movie.id)
  const library = getLibrary()
  const progressMap = getAllProgress()
  const listed = library.list[movie.id] > 0
  const seen = library.seen[movie.id] > 0
  const saga = sagaOf(movie.id)
  const similar = similarTo(movie)

  const card = (m: Movie, note?: string) => (
    <MovieCard key={m.id} movie={m} onOpen={onOpen} progress={progressMap[m.id]} seen={library.seen[m.id] > 0} note={note} current={m.id === movie.id} />
  )

  return (
    <div ref={scrollRef} data-nav-scope className="fixed inset-0 z-40 overflow-y-auto bg-obsidian-950">
      <img src={movie.backdrop} alt="" className="fixed inset-0 h-full w-full scale-110 object-cover opacity-30 blur-md" />
      <div className="fixed inset-0 bg-gradient-to-t from-obsidian-950 via-obsidian-950/60 to-obsidian-950/30" />
      <div className="relative mx-auto flex min-h-[78vh] max-w-6xl flex-col gap-8 px-4 py-10 md:flex-row md:items-center md:px-12">
        <img src={movie.poster} alt="" className="mx-auto w-48 rounded-2xl shadow-2xl shadow-black md:mx-0 md:w-72" />
        <div className="flex-1 space-y-5">
          <h1 className="text-4xl font-black text-white md:text-6xl">{movie.title}</h1>
          <p className="text-white/70">
            {movie.year} · {formatDuration(movie.duration)} · {movie.rating}
            {seen && <span className="ml-3 font-semibold text-pulse-cyan">✓ Ya la viste</span>}
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
          <div data-nav-group="details-play" className="flex flex-wrap gap-3 pt-2">
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
          <div data-nav-group="details-more" className="flex flex-wrap gap-3">
            <button data-nav className={`kp-btn kp-btn-sm ${listed ? 'kp-btn-active' : ''}`} onClick={() => setInList(movie.id, !listed)} aria-pressed={listed}>
              {listed ? '★ En mi lista' : '☆ Mi lista'}
            </button>
            <button data-nav className={`kp-btn kp-btn-sm ${seen ? 'kp-btn-active' : ''}`} onClick={() => setSeen(movie.id, !seen)} aria-pressed={seen}>
              {seen ? '✓ Vista (quitar)' : 'Marcar como vista'}
            </button>
            {statsEnabled() && report !== 'sent' && (
              <button data-nav className={`kp-btn kp-btn-sm ${report === 'ask' ? 'kp-btn-active' : ''}`} onClick={() => setReport(report === 'ask' ? '' : 'ask')} aria-expanded={report === 'ask'}>
                ⚠ Reportar un problema
              </button>
            )}
          </div>
          {report === 'ask' && (
            <div data-nav-group="details-report" className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-white/70">¿Qué pasa con esta película?</span>
              {PROBLEMS.map(([kind, label]) => (
                <button
                  key={kind}
                  data-nav
                  className="kp-btn kp-btn-sm"
                  onClick={() => {
                    reportProblem(movie.id, kind)
                    setReport('sent')
                    // El botón pulsado desaparece; sin esto el control remoto se queda sin foco.
                    requestAnimationFrame(focusFirst)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {report === 'sent' && <p className="text-sm font-medium text-pulse-cyan">Gracias, quedó reportada. La vamos a revisar.</p>}
        </div>
      </div>

      <div className="relative space-y-8 pb-16">
        {saga && (
          <section>
            <h2 className="mb-3 px-4 text-xl font-bold text-white md:px-12 md:text-2xl">Saga {saga.name}, en orden</h2>
            <Row group="details-saga">{saga.movies.map((m, i) => card(m, `${i + 1} de ${saga.movies.length} · ${m.year}`))}</Row>
          </section>
        )}
        {similar.length > 0 && (
          <section>
            <h2 className="mb-3 px-4 text-xl font-bold text-white md:px-12 md:text-2xl">Parecidas a esta</h2>
            <Row group="details-similar">{similar.map((m) => card(m))}</Row>
          </section>
        )}
      </div>
    </div>
  )
}
