import { useEffect, useRef, useState } from 'react'
import Home from './components/Home'
import Player from './components/Player'
import Details from './components/Details'
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
import { Movie } from './types'

export default function App() {
  const [view, setView] = useState<'home' | 'details' | 'player'>('home')
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
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

  const playMovie = (m: Movie) => {
    setSelectedMovie(m)
    setView('player')
  }

  const closePlayer = () => {
    setView('home')
  }

  return (
    <div className="min-h-screen bg-obsidian-950 text-white selection:bg-pulse-cyan selection:text-obsidian-950 font-sans">
      {updateRequired && <UpdateModal />}

      {view === 'home' && !isNativeApp() && (
        <DownloadButtons />
      )}

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
        />
      )}

      {view === 'details' && selectedMovie && (
        <Details
          movie={selectedMovie}
          onBack={() => setView('home')}
          onPlay={() => setView('player')}
        />
      )}

      {view === 'player' && selectedMovie && (
        <Player
          movie={selectedMovie}
          onExit={closePlayer}
        />
      )}
    </div>
  )
}
