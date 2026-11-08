import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { Movie, View } from './types'
import Home from './components/Home'
import Details from './components/Details'
import Downloads from './components/Downloads'
import LegalModal from './components/LegalModal'
import { focusEl, focusFirst, initSpatialNav } from './lib/spatial'
import { APK_URL, REPO, isNative } from './lib/config'
import { getMovieProgress, clearMovieProgress, formatTimeMMSS } from './lib/progress'
import { refreshLiveCatalog } from './lib/catalog'

const Player = lazy(() => import('./components/Player'))

const initialStack = (): View[] =>
  /descargar/.test(location.hash) || /\/descargar\/?$/.test(location.pathname) ? [{ name: 'home' }, { name: 'downloads' }] : [{ name: 'home' }]

export default function App() {
  const [stack, setStack] = useState<View[]>(initialStack)
  const [legal, setLegal] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [toast, setToast] = useState('')
  const [resumePrompt, setResumePrompt] = useState<{ movie: Movie; savedTime: number } | null>(null)
  const [updateRelease, setUpdateRelease] = useState<{ tag: string; notes: string } | null>(null)
  const returnFocus = useRef<HTMLElement[]>([])
  const view = stack[stack.length - 1]

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 3000)
  }, [])

  const push = useCallback((v: View) => {
    returnFocus.current.push(document.activeElement as HTMLElement)
    setStack((s) => [...s, v])
  }, [])

  const back = useCallback(() => {
    if (resumePrompt) {
      setResumePrompt(null)
      requestAnimationFrame(() => focusFirst())
      return true
    }
    if (updateRelease) {
      setUpdateRelease(null)
      requestAnimationFrame(() => focusFirst())
      return true
    }
    if (legal) {
      setLegal(false)
      return true
    }
    if (stack.length > 1) {
      setStack((s) => s.slice(0, -1))
      const el = returnFocus.current.pop()
      requestAnimationFrame(() => (el?.isConnected ? focusEl(el) : focusFirst()))
      return true
    }
    return false
  }, [legal, resumePrompt, updateRelease, stack.length])

  useEffect(() => initSpatialNav(back), [back])

  // Verifica si hay nuevo APK en GitHub Releases y actualiza el catálogo en vivo
  const checkUpdatesAndSync = useCallback(async (manual = false) => {
    if (manual) setSyncing(true)
    try {
      await refreshLiveCatalog()
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest?t=${Date.now()}`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        const latestTag = (data?.tag_name as string | undefined) || ''
        if (latestTag) {
          const installedTag = localStorage.getItem('kp_installed_release_tag')
          const dismissedTag = sessionStorage.getItem('kp_dismissed_release_tag')
          if (!installedTag) {
            localStorage.setItem('kp_installed_release_tag', latestTag)
          } else if (installedTag !== latestTag && (manual || dismissedTag !== latestTag)) {
            setUpdateRelease({ tag: latestTag, notes: data?.name || `KinoPulse ${latestTag}` })
            if (manual) setSyncing(false)
            return
          }
        }
      }
      if (manual) {
        if ('caches' in window) {
          const keys = await caches.keys()
          await Promise.all(keys.map((k) => caches.delete(k)))
        }
        showToast('Catálogo sincronizado al día. Reiniciando...')
        window.setTimeout(() => window.location.reload(), 900)
      }
    } catch {
      if (manual) showToast('Error al sincronizar. Verifica tu conexión.')
    } finally {
      if (manual) setSyncing(false)
    }
  }, [showToast])

  // Auto-sincronizar al iniciar y cada vez que la TV o celular despierte la app
  useEffect(() => {
    checkUpdatesAndSync(false)
    const onWake = () => {
      if (document.visibilityState === 'visible') {
        checkUpdatesAndSync(false)
      }
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    return () => {
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
    }
  }, [checkUpdatesAndSync])

  useEffect(() => {
    if (resumePrompt || updateRelease) {
      requestAnimationFrame(() => focusFirst())
    }
  }, [resumePrompt, updateRelease])

  // Botón Atrás físico del control remoto Android TV
  useEffect(() => {
    if (!isNative()) return
    let remove: (() => void) | undefined
    import('@capacitor/app').then(({ App: CapApp }) =>
      CapApp.addListener('backButton', () => {
        if (!back()) CapApp.exitApp()
      }).then((h) => (remove = () => h.remove())),
    )
    return () => remove?.()
  }, [back])

  useEffect(() => {
    if (view.name === 'downloads') history.replaceState(null, '', '#/descargar')
    else if (location.hash) history.replaceState(null, '', location.pathname)
  }, [view])

  const open = (m: Movie) => push({ name: 'details', movie: m })

  const play = (m: Movie) => {
    const saved = getMovieProgress(m.id)
    if (saved && saved.time >= 15) {
      setResumePrompt({ movie: m, savedTime: saved.time })
    } else {
      push({ name: 'player', movie: m, startAt: 0 })
    }
  }

  const startPlayback = (m: Movie, startAt: number) => {
    if (startAt === 0) clearMovieProgress(m.id)
    setResumePrompt(null)
    push({ name: 'player', movie: m, startAt })
  }

  const triggerUpdateInstall = () => {
    if (!updateRelease) return
    localStorage.setItem('kp_installed_release_tag', updateRelease.tag)
    setUpdateRelease(null)
    window.open(APK_URL, '_blank')
  }

  const dismissUpdate = () => {
    if (updateRelease) sessionStorage.setItem('kp_dismissed_release_tag', updateRelease.tag)
    setUpdateRelease(null)
    requestAnimationFrame(() => focusFirst())
  }

  const exitOrRestartApp = () => {
    if (isNative()) {
      import('@capacitor/app').then(({ App: CapApp }) => CapApp.exitApp())
    } else {
      window.location.reload()
    }
  }

  const underlayHidden = view.name !== 'home'

  return (
    <div className="min-h-screen bg-obsidian-950 text-white">
      {toast && (
        <div className="fixed top-16 left-1/2 z-50 -translate-x-1/2 rounded-full border border-pulse-cyan/40 bg-obsidian-900/95 px-6 py-2.5 text-sm font-semibold text-white shadow-2xl">
          {toast}
        </div>
      )}

      <div aria-hidden={underlayHidden} className={underlayHidden ? 'invisible' : ''}>
        <header className="fixed inset-x-0 top-0 z-30 flex flex-wrap items-center gap-3 bg-obsidian-950/85 px-4 py-3 backdrop-blur-md md:px-12">
          <img src="./logo.svg" alt="KinoPulse" className="h-8 w-auto md:h-10" />
          <nav className="ml-auto flex flex-wrap items-center gap-2" data-nav-group="nav">
            <button
              data-nav
              className="kp-btn kp-btn-sm"
              onClick={() => checkUpdatesAndSync(true)}
              disabled={syncing}
            >
              {syncing ? '⟳ Sincronizando...' : '🔄 Actualizar'}
            </button>
            <button data-nav className="kp-btn kp-btn-sm" onClick={() => push({ name: 'downloads' })}>
              ⬇ Descargar App
            </button>
            <button data-nav className="kp-btn kp-btn-sm" onClick={() => setLegal(true)}>
              Info
            </button>
            <button
              data-nav
              className="kp-btn kp-btn-sm border-pulse-red/40 text-red-200"
              onClick={exitOrRestartApp}
            >
              ⏻ Salir
            </button>
          </nav>
        </header>
        <Home onOpen={open} onPlay={play} />
        <footer className="px-4 pb-10 text-center text-xs text-white/40 md:px-12">
          KinoPulse Streaming · Android TV, Mobile & Web
        </footer>
      </div>

      {view.name === 'details' && <Details movie={view.movie} onPlay={() => play(view.movie)} onBack={back} />}
      {view.name === 'player' && (
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-black" />}>
          <Player movie={view.movie} startAt={view.startAt} onExit={back} />
        </Suspense>
      )}
      {view.name === 'downloads' && <Downloads onBack={back} />}
      {legal && <LegalModal onClose={back} />}

      {/* Modal: ¿Reanudar o empezar desde cero? */}
      {resumePrompt && (
        <div data-nav-scope className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-obsidian-900 p-6 text-center shadow-2xl">
            <img src={resumePrompt.movie.poster} alt="" className="mx-auto mb-4 h-36 w-24 rounded-lg object-cover shadow-lg" />
            <h2 className="text-2xl font-bold text-white">{resumePrompt.movie.title}</h2>
            <p className="mt-2 text-sm text-white/70">
              Dejaste esta película en el minuto <span className="font-semibold text-pulse-cyan">{formatTimeMMSS(resumePrompt.savedTime)}</span>. ¿Deseas retomar donde te quedaste?
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                data-nav
                data-nav-autofocus
                className="kp-btn kp-btn-primary w-full justify-center"
                onClick={() => startPlayback(resumePrompt.movie, resumePrompt.savedTime)}
              >
                ▶ Reanudar ({formatTimeMMSS(resumePrompt.savedTime)})
              </button>
              <button
                data-nav
                className="kp-btn w-full justify-center"
                onClick={() => startPlayback(resumePrompt.movie, 0)}
              >
                ↺ Empezar desde el principio
              </button>
              <button
                data-nav
                className="kp-btn w-full justify-center opacity-75"
                onClick={() => setResumePrompt(null)}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Aviso de Nueva Actualización de la App */}
      {updateRelease && (
        <div data-nav-scope className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-pulse-red/40 bg-obsidian-900 p-6 text-center shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-widest text-pulse-cyan">Nueva Versión Disponible</p>
            <h2 className="mt-2 text-2xl font-black text-white">{updateRelease.notes}</h2>
            <p className="mt-2 text-sm text-white/75">
              Hay una actualización de KinoPulse lista para instalar con mejoras de rendimiento y nuevas funciones.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                data-nav
                data-nav-autofocus
                className="kp-btn kp-btn-primary w-full justify-center"
                onClick={triggerUpdateInstall}
              >
                ⬇ Actualizar ahora ({updateRelease.tag})
              </button>
              <button
                data-nav
                className="kp-btn w-full justify-center"
                onClick={dismissUpdate}
              >
                Más tarde
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
