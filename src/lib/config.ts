export const REPO = 'Criss-paz/kinopulse-app'
export const APK_URL = `https://github.com/${REPO}/releases/latest/download/KinoPulse-TV-Mobile.apk`
export const WEB_URL = 'https://criss-paz.github.io/kinopulse-app/'

// Optional transparent edge cache (worker/cache-worker.js). Leave empty to stream straight from the origin.
const EDGE = (import.meta.env.VITE_EDGE_PROXY as string | undefined) ?? ''

export function streamUrl(url: string): string {
  return EDGE ? `${EDGE.replace(/\/$/, '')}/?u=${encodeURIComponent(url)}` : url
}

export const isNative = (): boolean =>
  !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
