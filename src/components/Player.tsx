import { useCallback, useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import type { Movie } from '../types'
import { streamUrl } from '../lib/config'
import { focusEl } from '../lib/spatial'

const HIDE_AFTER = 3000
const SEEK_STEP = 10

const fmt = (s: number) => {
  if (!isFinite(s)) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return h ? `${h}:${m.toString().padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export default function Player({ movie, onExit }: { movie: Movie; onExit: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playRef = useRef<HTMLButtonElement>(null)
  const hideTimer = useRef<number>()
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
  const subs = movie.subtitles ?? []

  const setVisible = (v: boolean) => {
    visibleRef.current = v
    setVisibleState(v)
  }

  // Source setup: hls.js where MSE exists, native HLS (Safari / some WebViews) otherwise, plain MP4 for direct files.
  useEffect(() => {
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
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [movie])

  useEffect(() => {
    const tracks = videoRef.current?.textTracks
    if (!tracks) return
    for (let i = 0; i < tracks.length; i++) tracks[i].mode = i === subIndex ? 'showing' : 'disabled'
  }, [subIndex])

  const poke = useCallback(() => {
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
    setFlash(delta > 0 ? `+${delta}s` : `${delta}s`)
    window.setTimeout(() => setFlash(''), 600)
  }, [])

  // Captured before the global D-pad engine: with hidden controls, arrows seek and Enter toggles playback.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const wasVisible = visibleRef.current
      poke()
      const onSeekBar = (document.activeElement as HTMLElement | null)?.dataset.seekbar !== undefined
      if (e.key === 'MediaPlayPause' || e.key === ' ') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'MediaFastForward') seek(SEEK_STEP)
      else if (e.key === 'MediaRewind') seek(-SEEK_STEP)
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (!wasVisible || onSeekBar)) {
        e.preventDefault()
        e.stopPropagation()
        seek(e.key === 'ArrowRight' ? SEEK_STEP : -SEEK_STEP)
      } else if (!wasVisible && (e.key === 'Enter' || e.key.startsWith('Arrow'))) {
        // First key press only wakes the controls (Enter also toggles playback).
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Enter') toggle()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [poke, seek, toggle])

  const progress = duration ? (time / duration) * 100 : 0
  const bufPct = duration ? (buffered / duration) * 100 : 0

  return (
    <div data-nav-scope className="fixed inset-0 z-50 bg-black" onMouseMove={poke} onTouchStart={poke}>
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        preload="metadata"
        playsInline
        poster={movie.backdrop}
        onClick={toggle}
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          seek(e.clientX - r.left > r.width / 2 ? SEEK_STEP : -SEEK_STEP)
        }}
        onPlay={() => {
          setPlaying(true)
          poke()
        }}
        onPause={() => {
          setPlaying(false)
          setVisible(true)
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onProgress={(e) => {
          const b = e.currentTarget.buffered
          if (b.length) setBuffered(b.end(b.length - 1))
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onEnded={onExit}
        onError={() => setError('No se pudo cargar el video. Revisa tu conexión.')}
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
            <span>{fmt(time)}</span>
            <span>-{fmt(Math.max(0, duration - time))}</span>
          </div>
          <div
            data-nav
            data-seekbar
            tabIndex={0}
            role="slider"
            aria-label="Progreso (izquierda/derecha para moverse 10 s)"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            className="kp-seekbar relative mb-6 h-3 cursor-pointer rounded-full bg-white/20"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              const v = videoRef.current!
              v.currentTime = ((e.clientX - r.left) / r.width) * (v.duration || 0)
            }}
          >
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufPct}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-pulse-red" style={{ width: `${progress}%` }} />
            <div className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-lg" style={{ left: `${progress}%` }} />
          </div>

          <div className="flex flex-wrap items-center gap-3 md:gap-4">
            <button data-nav className="kp-btn" onClick={() => seek(-SEEK_STEP)} aria-label="Atrasar 10 segundos">
              ⟲ 10
            </button>
            <button ref={playRef} data-nav className="kp-btn kp-btn-primary min-w-[9rem]" onClick={toggle}>
              {playing ? '❚❚ Pausa' : '▶ Reproducir'}
            </button>
            <button data-nav className="kp-btn" onClick={() => seek(SEEK_STEP)} aria-label="Adelantar 10 segundos">
              10 ⟳
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
