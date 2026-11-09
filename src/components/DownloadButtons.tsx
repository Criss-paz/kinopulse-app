import { useEffect, useState } from 'react'
import { APK_URL } from '../lib/updater'

// Chrome/Edge fire this when the site can be installed as an app; not yet in the TS DOM lib.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches
const isWindows = () => /Windows/i.test(navigator.userAgent)

export default function DownloadButtons() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // Already running as the installed app: nothing to offer.
  if (installed) return null

  const installWindows = async () => {
    if (!installPrompt) {
      alert('Abre KinoPulse en Microsoft Edge o Google Chrome y pulsa el icono "Instalar" en la barra de direcciones.\n\nSi ya la instalaste, búscala en el menú Inicio.')
      return
    }
    await installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setInstallPrompt(null)
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 sm:flex-row">
      {isWindows() && (
        <button onClick={installWindows} className="kp-btn kp-btn-primary px-4 py-2 font-bold shadow-2xl">
          Instalar en Windows
        </button>
      )}
      <a href={APK_URL} className="kp-btn kp-btn-primary px-4 py-2 font-bold shadow-2xl">
        Descargar app Android
      </a>
    </div>
  )
}
