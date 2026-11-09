import { useState } from 'react';
import { AppVersion } from '../lib/updater';

interface Props {
  version: AppVersion;
  onClose: () => void;
}

export default function UpdateModal({ version, onClose }: Props) {
  const [downloading, setDownloading] = useState(false);

  const handleUpdate = async () => {
    setDownloading(true);
    try {
      // Inicia la descarga del APK
      window.location.href = version.url;

      // Esperar un poco y cerrar el modal
      setTimeout(() => {
        setDownloading(false);
        onClose();
      }, 3000);
    } catch (error) {
      console.error('Download failed:', error);
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="max-w-md w-full rounded-2xl bg-obsidian-900 border border-white/10 p-6 text-center shadow-2xl">
        <div className="mb-4 flex justify-center">
          <div className="h-16 w-16 rounded-full bg-pulse-cyan/20 flex items-center justify-center text-pulse-cyan text-3xl">
            🚀
          </div>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Actualización Disponible</h2>
        <p className="text-white/60 mb-6 text-sm leading-relaxed">
          Nueva versión {version.version} disponible: <br/>
          <span className="text-white/80">{version.releaseNotes}</span>
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={handleUpdate}
            disabled={downloading}
            className="kp-btn kp-btn-primary w-full py-3 font-bold"
          >
            {downloading ? 'Descargando...' : 'Actualizar Ahora'}
          </button>
          <button
            onClick={onClose}
            className="kp-btn w-full py-2 text-white/40 hover:text-white transition-colors"
          >
            Luego
          </button>
        </div>
      </div>
    </div>
  );
}
