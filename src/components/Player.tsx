import { useCallback, useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import type { Movie } from '../types'
import { mirrorUrl, streamUrl } from '../lib/config'
import { saveMovieProgress, clearMovieProgress } from '../lib/progress'
import { PLAY_AFTER_MS, setWatching, trackPlay } from '../lib/stats'
import { dirOf, focusEl } from '../lib/spatial'

const HIDE_AFTER = 3000
const SEEK_STEP = 10
// Holding an arrow on the seek bar speeds up: 10 s per step, then 30 s, then 60 s. The jump is
// applied once the key is released (or after a short pause), so the video seeks once, not 40 times.
const SCRUB_COMMIT_MS = 450
const scrubStep = (repeats: number) => (repeats < 5 ? SEEK_STEP : repeats < 15 ? 30 : 60)

const UNSUPPORTED = 'Este navegador no puede reproducir el formato de esta película. Prueba en la app de Android/TV o en Microsoft Edge.'

// Safari on iPhone can only fullscreen the <video> itself; it has no Element.requestFullscreen.
type IOSVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void }

const fmt = (s: number) => {
  if (!isFinite(s)) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return h ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export default function Player({ movie, startAt = 0, onExit }: { movie: Movie; startAt?: number; onExit: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const scrubRef = useRef<number | null>(null)
  const scrubRepeats = useRef(0)
  const scrubTimer = useRef<number>()
  const playRef = useRef<HTMLButtonElement>(null)
  const hideTimer = useRef<number>()
  const lastSavedRef = useRef<number>(0)
  const appliedStartRef = useRef<boolean>(false)
  const resumeRetried = useRef(false)
  const mirrorTried = useRef(false)
  const mirrorResumeAt = useRef(0)
  const visibleRef = useRef(true)
  const [visible, setVisibleState] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [waiting, setWaiting] = useState(true)
  const [error, setError] = useState('')
  const [subIndex, setSubIndex] = useState(-1)
  const [flash, setFlash] = useState('')
  const [scrub, setScrubState] = useState<number | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [audioWarning, setAudioWarning] = useState(false)
  const subs = movie.subtitles ?? []

  const setScrub = (t: number | null) => {
    scrubRef.current = t
    setScrubState(t)
  }

  const setVisible = (v: boolean) => {
    visibleRef.current = v
    setVisibleState(v)
  }

  useEffect(() => {
    appliedStartRef.current = false
    resumeRetried.current = false
    mirrorTried.current = false
    mirrorResumeAt.current = 0
    const video = videoRef.current!
    const src = streamUrl(movie.stream)
    let hls: Hls | undefined
    if (movie.type === 'hls' && Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 120, backBufferLength: 60, capLevelToPlayerSize: true, enableWorker: true })
      hls.loadSource(src)
      hls.attachMedia(video)
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls!.startLoad()
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls!.recoverMediaError()
        else setError('No se pudo reproducir este stream.')
      })
    } else {
      video.src = src
    }
    video.play().catch(() => setPlaying(false))
    return () => {
      if (video.currentTime > 10 && video.duration > 0) {
        saveMovieProgress(movie.id, video.currentTime, video.duration)
      }
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [movie])

  useEffect(() => {
    setWatching(movie.id)
    const played = window.setTimeout(() => trackPlay(movie.id), PLAY_AFTER_MS)
    return () => {
      window.clearTimeout(played)
      setWatching(null)
    }
  }, [movie.id])

  useEffect(() => {
    const tracks = videoRef.current?.textTracks
    if (!tracks) return
    for (let i = 0; i < tracks.length; i++) tracks[i].mode = i === subIndex ? 'showing' : 'disabled'
  }, [subIndex])

  const poke = useCallback(() => {
    // Con los controles ocultos no se refresca el reloj (ver onTimeUpdate): al reaparecer,
    // se pone al día de una vez para que no muestre el tiempo de hace un rato.
    if (!visibleRef.current && videoRef.current) setTime(videoRef.current.currentTime)
    setVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) setVisible(false)
    }, HIDE_AFTER)
  }, [])

  useEffect(() => {
    poke()
    if (playRef.current) focusEl(playRef.current)
    return () => window.clearTimeout(hideTimer.current)
  }, [poke])

  const toggle = useCallback(() => {
    const v = videoRef.current!
    if (v.paused) v.play().catch(() => undefined)
    else v.pause()
  }, [])

  const seek = useCallback((delta: number) => {
    const v = videoRef.current!
    v.currentTime = Math.max(0, Math.min((v.duration || 0) - 1, v.currentTime + delta))
    if (v.duration > 0) saveMovieProgress(movie.id, v.currentTime, v.duration)
    setFlash(delta > 0 ? `+${delta}s` : `${delta}s`)
    window.setTimeout(() => setFlash(''), 600)
  }, [movie.id])

  const restart = useCallback(() => {
    const v = videoRef.current!
    v.currentTime = 0
    setTime(0)
    clearMovieProgress(movie.id)
    v.play().catch(() => undefined)
    setFlash('⏮ Desde el principio')
    window.setTimeout(() => setFlash(''), 900)
  }, [movie.id])

  const commitScrub = useCallback(() => {
    window.clearTimeout(scrubTimer.current)
    const t = scrubRef.current
    scrubRepeats.current = 0
    if (t === null) return
    const v = videoRef.current!
    v.currentTime = t
    setTime(t)
    if (v.duration > 0) saveMovieProgress(movie.id, t, v.duration)
    setScrub(null)
  }, [movie.id])

  // Arrow keys on the seek bar: move a preview marker, accelerating while held, and jump once.
  const scrubBy = useCallback((dir: 1 | -1, repeat: boolean) => {
    const v = videoRef.current!
    if (!v.duration) return
    scrubRepeats.current = repeat ? scrubRepeats.current + 1 : 0
    const from = scrubRef.current ?? v.currentTime
    setScrub(Math.max(0, Math.min(v.duration - 1, from + dir * scrubStep(scrubRepeats.current))))
    window.clearTimeout(scrubTimer.current)
    scrubTimer.current = window.setTimeout(commitScrub, SCRUB_COMMIT_MS)
  }, [commitScrub])

  // Mouse/touch on the seek bar: drag the marker freely, the video jumps on release.
  const timeAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (videoRef.current?.duration || 0)
  }

  const toggleFullscreen = useCallback(() => {
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void }
    const root = rootRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      ;(document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())
      return
    }
    if (root?.requestFullscreen) {
      root.requestFullscreen().then(() => {
        // En el móvil, gira a horizontal; donde no se pueda (PC, TV) se ignora.
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
        o?.lock?.('landscape').catch(() => undefined)
      }).catch(() => undefined)
    } else if (root?.webkitRequestFullscreen) root.webkitRequestFullscreen()
    else (videoRef.current as IOSVideo | null)?.webkitEnterFullscreen?.()
  }, [])

  useEffect(() => {
    const onChange = () => setFullscreen(!!(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
      window.clearTimeout(scrubTimer.current)
      // Al salir del reproductor, la app vuelve a su tamaño normal.
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
      ;(screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = dirOf(e)
      const wasVisible = visibleRef.current
      poke()
      const onSeekBar = (document.activeElement as HTMLElement | null)?.dataset.seekbar !== undefined
      if (e.key === 'MediaPlayPause' || e.key === ' ') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'MediaFastForward') seek(SEEK_STEP)
      else if (e.key === 'MediaRewind') seek(-SEEK_STEP)
      else if ((dir === 'left' || dir === 'right') && onSeekBar) {
        e.preventDefault()
        e.stopPropagation()
        scrubBy(dir === 'right' ? 1 : -1, e.repeat)
      } else if ((dir === 'left' || dir === 'right') && !wasVisible) {
        e.preventDefault()
        e.stopPropagation()
        seek(dir === 'right' ? SEEK_STEP : -SEEK_STEP)
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        toggleFullscreen()
      } else if (!wasVisible && (e.key === 'Enter' || dir)) {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Enter') toggle()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [poke, seek, toggle, scrubBy, toggleFullscreen])

  const shown = scrub ?? time
  const progress = duration ? (shown / duration) * 100 : 0
  const bufPct = duration ? (buffered / duration) * 100 : 0

  return (
    <div ref={rootRef} data-nav-scope className="fixed inset-0 z-50 bg-black" onMouseMove={poke} onTouchStart={poke}>
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        // "auto": el navegador llena el buffer en cuanto abre la pelicula, en vez de
        // esperar a tener solo los metadatos y arrancar justo al limite.
        preload="auto"
        playsInline
        poster={movie.backdrop}
        onClick={toggle}
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          seek(e.clientX - r.left > r.width / 2 ? SEEK_STEP : -SEEK_STEP)
        }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          setDuration(v.duration)
          if (mirrorResumeAt.current > 0) {
            // Recién cambiado al espejo: sigue donde iba la película.
            v.currentTime = Math.min(mirrorResumeAt.current, v.duration - 5)
            mirrorResumeAt.current = 0
            appliedStartRef.current = true
          } else if (!appliedStartRef.current && startAt > 0 && startAt < v.duration - 5) {
            v.currentTime = startAt
            setTime(startAt)
            appliedStartRef.current = true
          }
        }}
        onPlay={() => {
          setPlaying(true)
          poke()
        }}
        onPause={(e) => {
          setPlaying(false)
          setVisible(true)
          const v = e.currentTarget
          if (v.duration > 0) saveMovieProgress(movie.id, v.currentTime, v.duration)
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget
          // Repintar el reproductor cuatro veces por segundo le quita tiempo al decodificador
          // y en TVs y móviles modestos la imagen se ve a tirones. Con los controles ocultos
          // no hay nada que actualizar en pantalla, así que no se toca el estado.
          if (visibleRef.current || scrubRef.current !== null) setTime(v.currentTime)
          const now = Date.now()
          if (now - lastSavedRef.current >= 5000 && v.duration > 0) {
            lastSavedRef.current = now
            saveMovieProgress(movie.id, v.currentTime, v.duration)
          }
        }}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onProgress={(e) => {
          if (!visibleRef.current) return
          const b = e.currentTarget.buffered
          if (b.length) setBuffered(b.end(b.length - 1))
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={(e) => {
          setWaiting(false)
          // Sin decodificador (p. ej. HEVC en Chrome/Firefox) suena el audio pero la imagen queda negra.
          const v = e.currentTarget
          window.setTimeout(() => {
            if (!v.paused && v.currentTime > 0 && v.videoWidth === 0) setError(UNSUPPORTED)
            // Al revés: audio sin decodificador (p. ej. AC3/DTS en Chrome/Firefox) = imagen sin sonido.
            // Todas las películas tienen audio, así que 0 bytes decodificados significa formato no soportado.
            const decoded = (v as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; mozHasAudio?: boolean })
            if (!v.paused && v.currentTime > 1 && (decoded.webkitAudioDecodedByteCount === 0 || decoded.mozHasAudio === false)) {
              setAudioWarning(true)
            }
          }, 2500)
        }}
        onCanPlay={(e) => {
          setWaiting(false)
          // Algunas TVs ignoran el salto pedido en loadedmetadata y arrancan en 0: se repite una vez aquí.
          const v = e.currentTarget
          // Solo en el primer canplay: después, un canplay viene de un salto del usuario (p. ej. Reiniciar).
          if (resumeRetried.current) return
          resumeRetried.current = true
          if (appliedStartRef.current && startAt > 0 && v.currentTime < startAt - 5) v.currentTime = startAt
        }}
        onEnded={() => {
          clearMovieProgress(movie.id)
          onExit()
        }}
        onError={(e) => {
          const v = e.currentTarget
          // Antes de rendirse, una vez: la misma película desde el servidor espejo.
          const mirror = movie.type === 'mp4' && !mirrorTried.current ? mirrorUrl(movie.stream) : null
          if (mirror) {
            mirrorTried.current = true
            mirrorResumeAt.current = v.currentTime > 0 ? v.currentTime : appliedStartRef.current ? 0 : startAt
            resumeRetried.current = true
            v.src = streamUrl(mirror)
            v.play().catch(() => setPlaying(false))
            return
          }
          setError(v.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? UNSUPPORTED : 'No se pudo cargar el video. Revisa tu conexión.')
        }}
      >
        {subs.map((s) => (
          <track key={s.lang} kind="subtitles" srcLang={s.lang} label={s.label} src={s.src} />
        ))}
      </video>

      {waiting && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="h-16 w-16 animate-spin rounded-full border-4 border-white/20 border-t-pulse-cyan" />
        </div>
      )}
      {flash && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="rounded-full bg-black/60 px-8 py-4 text-4xl font-bold text-white">{flash}</div>
        </div>
      )}
      {audioWarning && !error && (
        <div className="absolute inset-x-4 top-24 z-10 mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-black/85 p-4 text-white md:top-32">
          <span className="text-2xl">🔇</span>
          <p className="flex-1 text-sm md:text-base">
            Este navegador no puede reproducir el audio de esta película. Prueba en la app de Android/TV o en Microsoft Edge.
          </p>
          <button className="kp-btn kp-btn-sm" onClick={() => setAudioWarning(false)} aria-label="Cerrar aviso">
            ✕
          </button>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/80 p-6 text-center">
          <div>
            <p className="mb-6 text-xl text-white">{error}</p>
            <button data-nav className="kp-btn kp-btn-primary" onClick={onExit}>
              Volver
            </button>
          </div>
        </div>
      )}

      <div className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-500 ${visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
        <div className="bg-gradient-to-b from-black/80 to-transparent p-6 md:p-10">
          <button data-nav className="kp-btn" onClick={onExit}>
            ← Volver
          </button>
          <h1 className="mt-4 text-2xl font-bold text-white md:text-4xl">{movie.title}</h1>
        </div>

        <div className="bg-gradient-to-t from-black/90 to-transparent p-6 md:p-10">
          <div className="mb-3 flex justify-between text-sm text-white/80 md:text-lg">
            <span className={scrub !== null ? 'font-bold text-pulse-cyan' : ''}>{fmt(shown)}</span>
            <span>-{fmt(Math.max(0, duration - shown))}</span>
          </div>
          {/* Zona táctil alta (py-3) alrededor de una barra fina, para atinarle fácil con el dedo o el ratón. */}
          <div
            ref={barRef}
            data-nav
            data-seekbar
            tabIndex={0}
            role="slider"
            aria-label="Progreso (mantén izquierda/derecha para avanzar más rápido)"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(shown)}
            className="kp-seekbar group/bar relative mb-4 cursor-pointer touch-none rounded-full py-3"
            onPointerDown={(e) => {
              if (!duration) return
              e.currentTarget.setPointerCapture(e.pointerId)
              setScrub(timeAt(e.clientX))
              poke()
            }}
            onPointerMove={(e) => {
              if (scrubRef.current === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return
              setScrub(timeAt(e.clientX))
              poke()
            }}
            onPointerUp={commitScrub}
            onPointerCancel={() => setScrub(null)}
          >
            <div className="relative h-2 rounded-full bg-white/20 transition-[height] group-hover/bar:h-3 group-focus-visible/bar:h-3">
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufPct}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-pulse-red" style={{ width: `${progress}%` }} />
              <div className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-lg group-hover/bar:h-6 group-hover/bar:w-6" style={{ left: `${progress}%` }} />
              {scrub !== null && (
                <div className="absolute bottom-6 -translate-x-1/2 rounded-lg bg-black/85 px-3 py-1 text-lg font-bold text-white" style={{ left: `${progress}%` }}>
                  {fmt(scrub)}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 md:gap-4">
            <button data-nav className="kp-btn" onClick={restart} aria-label="Reiniciar desde el principio">
              ⏮<span className="hidden sm:inline">Reiniciar</span>
            </button>
            <button data-nav className="kp-btn" onClick={() => seek(-SEEK_STEP)} aria-label="Atrasar 10 segundos">
              ⟲ 10
            </button>
            <button ref={playRef} data-nav className="kp-btn kp-btn-primary min-w-[9rem]" onClick={toggle}>
              {playing ? '❚❚ Pausa' : '▶ Reproducir'}
            </button>
            <button data-nav className="kp-btn" onClick={() => seek(SEEK_STEP)} aria-label="Adelantar 10 segundos">
              10 ⟳
            </button>
            <button data-nav className="kp-btn" onClick={toggleFullscreen} aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}>
              {fullscreen ? '🗗' : '⛶'}
              <span className="hidden sm:inline">{fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}</span>
            </button>
            <div className="ml-auto flex flex-wrap gap-2">
              <button data-nav className={`kp-btn ${subIndex === -1 ? 'kp-btn-active' : ''}`} onClick={() => setSubIndex(-1)}>
                CC Off
              </button>
              {subs.map((s, i) => (
                <button key={s.lang} data-nav className={`kp-btn ${subIndex === i ? 'kp-btn-active' : ''}`} onClick={() => setSubIndex(i)}>
                  CC {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
