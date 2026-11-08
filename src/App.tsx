import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { Movie, View } from './types'
import Home from './components/Home'
import Details from './components/Details'
import Downloads from './components/Downloads'
import LegalModal from './components/LegalModal'
import { focusEl, focusFirst, initSpatialNav } from './lib/spatial'
import { isNative } from './lib/config'

const Player = lazy(() => import('./components/Player'))

const initialStack = (): View[] =>
  /descargar/.test(location.hash) || /\/descargar\/?$/.test(location.pathname) ? [{ name: 'home' }, { name: 'downloads' }] : [{ name: 'home' }]

export default function App() {
  const [stack, setStack] = useState<View[]>(initialStack)
  const [legal, setLegal] = useState(false)
  const returnFocus = useRef<HTMLElement[]>([])
  const view = stack[stack.length - 1]

  const push = useCallback((v: View) => {
    returnFocus.current.push(document.activeElement as HTMLElement)
    setStack((s) => [...s, v])
  }, [])

  const back = useCallback(() => {
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
  }, [legal, stack.length])

  useEffect(() => initSpatialNav(back), [back])

  // Android hardware / remote Back button.
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
  const play = (m: Movie) => push({ name: 'player', movie: m })
  const underlayHidden = view.name !== 'home'

  return (
    <div className="min-h-screen bg-obsidian-950 text-white">
      <div aria-hidden={underlayHidden} className={underlayHidden ? 'invisible' : ''}>
        <header className="fixed inset-x-0 top-0 z-30 flex items-center gap-4 bg-obsidian-950/85 px-4 py-3 backdrop-blur-md md:px-12">
          <img src="./logo.svg" alt="KinoPulse" className="h-8 w-auto md:h-10" />
          <nav className="ml-auto flex gap-2" data-nav-group="nav">
            <button data-nav className="kp-btn kp-btn-sm" onClick={() => push({ name: 'downloads' })}>
              ⬇ Descargar
            </button>
            <button data-nav className="kp-btn kp-btn-sm" onClick={() => setLegal(true)}>
              Aviso legal
            </button>
          </nav>
        </header>
        <Home onOpen={open} onPlay={play} />
        <footer className="px-4 pb-10 text-center text-xs text-white/40 md:px-12">
          Solo cine de dominio público y con licencias abiertas ·{' '}
          <button className="underline" onClick={() => setLegal(true)}>
            Aviso legal y licencias
          </button>
        </footer>
      </div>

      {view.name === 'details' && <Details movie={view.movie} onPlay={() => play(view.movie)} onBack={back} />}
      {view.name === 'player' && (
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-black" />}>
          <Player movie={view.movie} onExit={back} />
        </Suspense>
      )}
      {view.name === 'downloads' && <Downloads onBack={back} />}
      {legal && <LegalModal onClose={back} />}
    </div>
  )
}
