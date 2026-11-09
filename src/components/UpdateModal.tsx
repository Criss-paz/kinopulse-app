import { useEffect, useRef, useState } from 'react'
import { APK_URL, ApkInstaller, hasInAppInstaller } from '../lib/updater'

const AUTO_START_SECONDS = 10

// Mandatory: there is no "later" button. Shown over everything, including a playing movie.
export default function UpdateModal() {
  const [countdown, setCountdown] = useState(AUTO_START_SECONDS)
  const [percent, setPercent] = useState<number | null>(null)
  const [status, setStatus] = useState<'waiting' | 'downloading' | 'needs-permission' | 'installing' | 'error'>('waiting')
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    document.querySelectorAll('video').forEach((v) => v.pause())
    buttonRef.current?.focus()
  }, [])

  const startUpdate = async () => {
    if (!hasInAppInstaller()) {
      window.location.href = APK_URL
      return
    }
    const { allowed } = await ApkInstaller.canInstall()
    if (!allowed) {
      setStatus('needs-permission')
      await ApkInstaller.openInstallSettings()
      return
    }
    setStatus('downloading')
    setPercent(0)
    const sub = await ApkInstaller.addListener('progress', (p) => setPercent(p.percent))
    try {
      await ApkInstaller.downloadAndInstall({ url: APK_URL })
      setStatus('installing')
    } catch {
      setStatus('error')
    } finally {
      sub.remove()
    }
  }

  useEffect(() => {
    if (status !== 'waiting') return
    if (countdown <= 0) {
      startUpdate()
      return
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, status])

  const message = {
    waiting: `La actualización empieza sola en ${countdown} s.`,
    downloading: percent !== null && percent >= 0 ? `Descargando… ${percent}%` : 'Descargando…',
    'needs-permission': 'Activa "Permitir de esta fuente" para KinoPulse, vuelve y pulsa Actualizar.',
    installing: 'Pulsa "Instalar" en la ventana de Android para terminar.',
    error: 'No se pudo descargar. Revisa tu conexión y vuelve a intentarlo.',
  }[status]

  const busy = status === 'downloading'

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
      <div className="max-w-md w-full rounded-2xl bg-obsidian-900 border border-white/10 p-6 text-center shadow-2xl">
        <div className="mb-4 flex justify-center">
          <div className="h-16 w-16 rounded-full bg-pulse-cyan/20 flex items-center justify-center text-pulse-cyan text-3xl">
            🚀
          </div>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Actualización necesaria</h2>
        <p className="text-white/60 mb-2 text-sm leading-relaxed">
          Hay una nueva versión de KinoPulse. Necesitas actualizar para seguir viendo.
        </p>
        <p className="text-white/80 mb-6 text-sm">{message}</p>
        {busy && percent !== null && percent >= 0 && (
          <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-pulse-cyan transition-all" style={{ width: `${percent}%` }} />
          </div>
        )}
        <button
          ref={buttonRef}
          onClick={startUpdate}
          disabled={busy}
          className="kp-btn kp-btn-primary w-full py-3 font-bold"
        >
          {busy ? 'Descargando…' : status === 'waiting' ? 'Actualizar ahora' : 'Actualizar'}
        </button>
      </div>
    </div>
  )
}
