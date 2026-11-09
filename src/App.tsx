import { useEffect, useState } from 'react'
import Home from './components/Home'
import Player from './components/Player'
import Details from './components/Details'
import UpdateModal from './components/UpdateModal'
import DownloadButtons from './components/DownloadButtons'
import { App as NativeApp } from '@capacitor/app'
import { isNativeApp, isUpdateRequired, UPDATE_CHECK_MS } from './lib/updater'
import { Movie } from './types'

export default function App() {
  const [view, setView] = useState<'home' | 'details' | 'player'>('home')
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
  const [searchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [updateRequired, setUpdateRequired] = useState(false)

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

  const openDetails = (m: Movie) => {
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
