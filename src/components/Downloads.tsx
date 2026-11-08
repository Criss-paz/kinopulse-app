import { useEffect, useState } from 'react'
import { APK_URL, DOWNLOADER_CODE, WEB_URL } from '../lib/config'
import { focusFirst } from '../lib/spatial'

interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: string }>
}

let deferred: InstallPrompt | null = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e as InstallPrompt
})

const SHORT_APK = APK_URL.replace('https://', '')

export default function Downloads({ onBack }: { onBack: () => void }) {
  const [canInstall, setCanInstall] = useState(!!deferred)
  const [installed, setInstalled] = useState(window.matchMedia('(display-mode: standalone)').matches)

  useEffect(() => {
    focusFirst()
    const onPrompt = () => setCanInstall(true)
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') setInstalled(true)
    deferred = null
    setCanInstall(false)
  }

  return (
    <div data-nav-scope className="fixed inset-0 z-40 overflow-y-auto bg-obsidian-950">
      <div className="mx-auto max-w-5xl px-4 py-10 md:px-12">
        <button data-nav className="kp-btn mb-8" onClick={onBack}>
          ← Volver
        </button>
        <img src="./logo.svg" alt="KinoPulse" className="mb-6 h-12 w-auto md:h-16" />
        <h1 className="mb-2 text-4xl font-black text-white md:text-5xl">Centro de descargas</h1>
        <p className="mb-10 text-white/60">Instala KinoPulse en tu PC, teléfono o televisor.</p>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="kp-panel">
            <h2 className="kp-panel-title">💻 PC / Mac (PWA)</h2>
            <p className="text-white/70">Instálala como app de escritorio desde Chrome o Edge. Se abre en su propia ventana y se actualiza sola.</p>
            {installed ? (
              <p className="font-semibold text-pulse-cyan">✓ Ya está instalada en este dispositivo.</p>
            ) : canInstall ? (
              <button data-nav data-nav-autofocus className="kp-btn kp-btn-primary" onClick={install}>
                Instalar app
              </button>
            ) : (
              <p className="text-sm text-white/50">
                Si no ves el botón, usa el ícono de instalar (⊕) en la barra de direcciones del navegador, o abre {WEB_URL}.
              </p>
            )}
          </section>

          <section className="kp-panel">
            <h2 className="kp-panel-title">📱 Android (teléfono y TV)</h2>
            <p className="text-white/70">Un solo APK universal: funciona en celulares y en Android TV / Google TV / Fire TV.</p>
            <a data-nav data-nav-autofocus={!canInstall || undefined} className="kp-btn kp-btn-primary" href={APK_URL} rel="noopener">
              ⬇ Descargar APK
            </a>
          </section>

          <section className="kp-panel md:col-span-2">
            <h2 className="kp-panel-title">📺 Android TV con la app Downloader</h2>
            <ol className="list-decimal space-y-2 pl-6 text-white/80">
              <li>
                En tu TV instala <b>Downloader</b> (de AFTVnews) desde Google Play o la Amazon Appstore.
              </li>
              <li>
                Ajustes → Apps → Acceso especial → <b>Instalar apps desconocidas</b> → activa Downloader.
              </li>
              <li>Abre Downloader y escribe este código:</li>
            </ol>
            <div className="flex w-full flex-wrap items-center gap-5 rounded-xl bg-black/50 p-4">
              <img src="./favicon.svg" alt="" className="h-16 w-16" />
              <div>
                <p className="font-mono text-4xl font-black tracking-widest text-pulse-cyan md:text-5xl">{DOWNLOADER_CODE}</p>
                <p className="text-sm text-white/60">aftv.news/{DOWNLOADER_CODE}</p>
              </div>
            </div>
            <p className="text-sm text-white/50">Si el código no funciona, escribe la URL completa:</p>
            <code className="block break-all rounded-xl bg-black/50 p-3 font-mono text-sm text-white/80 md:text-base">{SHORT_APK}</code>
            <ol start={4} className="list-decimal space-y-2 pl-6 text-white/80">
              <li>Pulsa <b>Go</b>, espera la descarga y elige <b>Instalar</b>.</li>
              <li>KinoPulse aparecerá en la fila de apps de tu televisor.</li>
            </ol>
          </section>
        </div>
      </div>
    </div>
  )
}
