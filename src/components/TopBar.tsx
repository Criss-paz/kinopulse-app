import { useEffect, useRef, useState } from 'react'
import { App as NativeApp } from '@capacitor/app'
import { isNativeApp } from '../lib/updater'
import { focusFirst } from '../lib/spatial'

interface Props {
  searchQuery: string
  onSearch: (q: string) => void
  onExit: () => void
  onSecret: () => void
}

const SECRET_HOLD_MS = 2000

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches

// Salir solo tiene sentido donde la app es su propia ventana: Android/TV o la PWA instalada.
export const canExit = () => isNativeApp() || isStandalone()

export function exitApp() {
  if (isNativeApp()) NativeApp.exitApp()
  else window.close()
}

export default function TopBar({ searchQuery, onSearch, onExit, onSecret }: Props) {
  // Holding the logo opens the hidden admin panel.
  const holdTimer = useRef(0)
  const startHold = () => {
    holdTimer.current = window.setTimeout(onSecret, SECRET_HOLD_MS)
  }
  const endHold = () => window.clearTimeout(holdTimer.current)
  useEffect(() => endHold, [])

  const [searchOpen, setSearchOpen] = useState(searchQuery !== '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus()
  }, [searchOpen])

  const searchBtnRef = useRef<HTMLButtonElement>(null)

  const closeSearch = () => {
    onSearch('')
    setSearchOpen(false)
    // El input desaparece; sin esto el control remoto se queda sin foco.
    requestAnimationFrame(() => searchBtnRef.current?.focus())
  }

  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 bg-obsidian-950/95 px-4 shadow-lg shadow-black/40 backdrop-blur py-3 md:px-12">
      <span
        className="mr-auto select-none text-xl font-black tracking-tight text-white md:text-2xl"
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        onContextMenu={(e) => e.preventDefault()}
      >
        Kino<span className="text-pulse-cyan">Pulse</span>
      </span>

      <div data-nav-group="topbar" className="flex items-center gap-2">
        {searchOpen ? (
          <input
            ref={inputRef}
            data-nav
            type="search"
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                closeSearch()
              }
            }}
            placeholder="Buscar películas…"
            aria-label="Buscar películas"
            className="w-40 rounded-full bg-white/10 px-4 py-2 text-white placeholder-white/50 outline-none focus:ring-4 focus:ring-pulse-cyan sm:w-64"
          />
        ) : null}
        <button
          ref={searchBtnRef}
          data-nav
          className="kp-btn kp-btn-sm"
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          aria-label={searchOpen ? 'Cerrar búsqueda' : 'Buscar'}
        >
          {searchOpen ? '✕' : '🔍'}
          <span className="hidden md:inline">{searchOpen ? 'Cerrar' : 'Buscar'}</span>
        </button>
        <button data-nav className="kp-btn kp-btn-sm" onClick={() => window.location.reload()} aria-label="Refrescar">
          ⟳<span className="hidden md:inline">Refrescar</span>
        </button>
        {canExit() && (
          <button data-nav className="kp-btn kp-btn-sm" onClick={onExit} aria-label="Salir de la app">
            ⏻<span className="hidden md:inline">Salir</span>
          </button>
        )}
      </div>

    </header>
  )
}

export function ExitDialog({ onCancel }: { onCancel: () => void }) {
  useEffect(() => {
    focusFirst()
  }, [])

  return (
    <div data-nav-scope className="fixed inset-0 z-[70] grid place-items-center bg-black/80 p-4" role="dialog" aria-modal="true">
      <div className="kp-panel items-center text-center">
        <p className="kp-panel-title">¿Cerrar KinoPulse?</p>
        <p className="text-white/70">La app se apagará hasta que la vuelvas a abrir.</p>
        <div className="flex gap-3">
          <button data-nav data-nav-autofocus className="kp-btn kp-btn-primary" onClick={exitApp}>
            Salir
          </button>
          <button data-nav className="kp-btn" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
