import { useEffect, useState } from 'react'
import Home from './components/Home'
import Player from './components/Player'
import Details from './components/Details'
import UpdateModal from './components/UpdateModal'
import { checkUpdate, AppVersion } from './lib/updater'
import { Movie } from './types'

const APP_VERSION = '1.0.0'

export default function App() {
  const [view, setView] = useState<'home' | 'details' | 'player'>('home')
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [updateData, setUpdateData] = useState<AppVersion | null>(null)

  useEffect(() => {
    // Verificar actualizaciones al iniciar la app
    checkUpdate(APP_VERSION).then(({ shouldUpdate, data }) => {
      if (shouldUpdate && data) setUpdateData(data)
    })
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
      {updateData && (
        <UpdateModal 
          version={updateData} 
          onClose={() => setUpdateData(null)} 
        />
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
          onClose={() => setView('home')} 
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
