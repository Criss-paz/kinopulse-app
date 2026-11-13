export const REPO = 'Criss-paz/kinopulse-app'
export const APK_URL = `https://github.com/${REPO}/releases/latest/download/KinoPulse-TV-Mobile.apk`
export const DOWNLOADER_CODE = '6834053'
export const WEB_URL = 'https://criss-paz.github.io/kinopulse-app/'

// Optional transparent edge cache (worker/cache-worker.js). Leave empty to stream straight from the origin.
const EDGE = (import.meta.env.VITE_EDGE_PROXY as string | undefined) ?? ''

// Usage stats worker (worker/stats). Set VITE_STATS_URL to an empty string to disable the heartbeat and the admin panel's data.
export const STATS_URL = (import.meta.env.VITE_STATS_URL as string | undefined) ?? 'https://kinopulse-stats.kinopulse.workers.dev'

// Backup copy of the video host (scripts/mirror-hf-backup.py keeps it in sync). The player falls
// back to it when a movie fails to load from the main one.
const MAIN_HOST = 'https://huggingface.co/datasets/Criss-paz/kp-media-vault/'
const MIRROR_HOST = 'https://huggingface.co/datasets/Criss5712/kp-media-vault-backup/'

export function mirrorUrl(url: string): string | null {
  return url.startsWith(MAIN_HOST) ? MIRROR_HOST + url.slice(MAIN_HOST.length) : null
}

export function streamUrl(url: string): string {
  return EDGE ? `${EDGE.replace(/\/$/, '')}/?u=${encodeURIComponent(url)}` : url
}

export const isNative = (): boolean =>
  !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
