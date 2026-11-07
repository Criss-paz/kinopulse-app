import { useEffect } from 'react'
import { focusFirst } from '../lib/spatial'

export default function LegalModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    focusFirst()
  }, [])

  return (
    <div data-nav-scope className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-labelledby="legal-title">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-obsidian-900 p-6 md:p-10">
        <h2 id="legal-title" className="mb-4 text-2xl font-bold text-white">
          Aviso legal y licencias
        </h2>
        <div className="space-y-3 text-white/75">
          <p>
            KinoPulse solo muestra obras de <b>dominio público</b> o publicadas bajo licencias abiertas (por ejemplo Creative Commons de las Blender Open Movies). Cada título indica su licencia y la fuente original.
          </p>
          <p>
            Los videos se reproducen directamente desde sus repositorios públicos de origen (como Internet Archive). KinoPulse no requiere cuenta, no muestra anuncios y no recopila datos personales.
          </p>
          <p>
            Si eres titular de derechos y crees que algún contenido no debería estar aquí, abre un issue en el repositorio del proyecto en GitHub y será retirado del catálogo.
          </p>
        </div>
        <button data-nav data-nav-autofocus className="kp-btn kp-btn-primary mt-8" onClick={onClose}>
          Entendido
        </button>
      </div>
    </div>
  )
}
