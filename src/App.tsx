import { useEffect, useRef, useState } from 'react'
import Home from './components/Home'
import Player from './components/Player'
import Details from './components/Details'
import Downloads from './components/Downloads'
import UpdateModal from './components/UpdateModal'
import DownloadButtons from './components/DownloadButtons'
import TopBar, { ExitDialog, canExit } from './components/TopBar'
import { App as NativeApp } from '@capacitor/app'
import { isNativeApp, isUpdateRequired, UPDATE_CHECK_MS } from './lib/updater'
import { focusEl, initSpatialNav } from './lib/spatial'

const focusTopBar = () => {
  const first = document.querySelector<HTMLElement>('header [data-nav]')
  if (first) focusEl(first)
}
import { clearMovieProgress, getMovieProgress } from './lib/progress'
import { Movie } from './types'

export default function App() {
  const [view, setView] = useState<'home' | 'details' | 'player' | 'downloads'>('home')
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
  const [startAt, setStartAt] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [updateRequired, setUpdateRequired] = useState(false)
  const [exitOpen, setExitOpen] = useState(false)

  useEffect(() => {
    if (!isNativeApp()) return
    // Al abrir, cada pocos minutos (aunque se esté viendo una película) y al volver a la app.
    const check = () => isUpdateRequired().then((required) => required && setUpdateRequired(true))
    check()
    const timer = setInterval(check, UPDATE_CHECK_MS)
    const resume = NativeApp.addListener('resume', check)
    return () => {
      clearInterval(timer)
      resume.then((h) => h.remove())
    }
  }, [])

  // Atrás (control remoto, Esc o botón de Android): cierra lo que haya encima; en el inicio ofrece salir.
  // Desde una fila de películas, Atrás sube directo a la barra de arriba; ya en ella, ofrece salir.
  const goBack = useRef(() => {})
  const lastBack = useRef(0)
  goBack.current = () => {
    // Algunas TVs entregan la misma pulsación como tecla y como botón de Android: contarla una vez.
    const now = Date.now()
    if (now - lastBack.current < 400) return
    lastBack.current = now
    const inTopBar = !!document.activeElement?.closest('header')
    if (exitOpen) setExitOpen(false)
    else if (view === 'player') setView('details')
    else if (view !== 'home') setView('home')
    else if (searchQuery) setSearchQuery('')
    else if (!inTopBar) focusTopBar()
    else if (canExit()) setExitOpen(true)
  }

  useEffect(() => initSpatialNav(() => goBack.current()), [])

  useEffect(() => {
    if (!isNativeApp()) return
    const back = NativeApp.addListener('backButton', () => goBack.current())
    return () => {
      back.then((h) => h.remove())
    }
  }, [])

  const openDetails =(m: Movie) => {
    setSelectedMovie(m)
    setView('details')
  }

  // Reproduce desde donde se quedó (si hay progreso guardado) o, con fromStart, desde el principio.
  const playMovie = (m: Movie, fromStart = false) => {
    if (fromStart) clearMovieProgress(m.id)
    setStartAt(fromStart ? 0 : getMovieProgress(m.id)?.time ?? 0)
    setSelectedMovie(m)
    setView('player')
  }

  // Al salir del reproductor se vuelve a la ficha (Continuar / Desde el principio), no al inicio.
  const closePlayer = () => {
    setView('details')
  }

  return (
    <div className="min-h-screen bg-obsidian-950 text-white selection:bg-pulse-cyan selection:text-obsidian-950 font-sans">
      {updateRequired && <UpdateModal />}

      {view === 'home' && !isNativeApp() && (
        <DownloadButtons onOpenDownloads={() => setView('downloads')} />
      )}

      {view === 'downloads' && <Downloads onBack={() => setView('home')} />}

      {exitOpen && <ExitDialog onCancel={() => setExitOpen(false)} />}

      {view === 'home' && (
        <TopBar searchQuery={searchQuery} onSearch={setSearchQuery} onExit={() => setExitOpen(true)} />
      )}

      {view === 'home' && (
        <Home
          onOpen={openDetails}
          onPlay={playMovie}
          searchQuery={searchQuery}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          lastOpenedId={selectedMovie?.id}
        />
      )}

      {view === 'details' && selectedMovie && (
        <Details
          movie={selectedMovie}
          onBack={() => setView('home')}
          onPlay={(fromStart) => playMovie(selectedMovie, fromStart)}
        />
      )}

      {view === 'player' && selectedMovie && (
        <Player
          movie={selectedMovie}
          startAt={startAt}
          onExit={closePlayer}
        />
      )}
    </div>
  )
}
