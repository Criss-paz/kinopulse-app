import { App } from '@capacitor/app'
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export const APK_URL = 'https://github.com/Criss-paz/kinopulse-app/releases/latest/download/KinoPulse-TV-Mobile.apk'

// The interface is loaded live from the web, so normal changes need no update at all.
// Raise "minNativeBuild" in public/app-config.json to a release's build number (the N in v1.0.N)
// only when the Android part changes (AndroidManifest, Java, Capacitor plugins): older apps are
// then forced to update, even mid-movie, within UPDATE_CHECK_MS.
const APP_CONFIG_URL = 'https://kinopulse.vercel.app/app-config.json'
export const UPDATE_CHECK_MS = 5 * 60 * 1000

export const isNativeApp = () => Capacitor.isNativePlatform()

interface ApkInstallerPlugin {
  canInstall(): Promise<{ allowed: boolean }>
  openInstallSettings(): Promise<void>
  downloadAndInstall(opts: { url: string }): Promise<void>
  addListener(event: 'progress', cb: (p: { percent: number }) => void): Promise<PluginListenerHandle>
}

export const ApkInstaller = registerPlugin<ApkInstallerPlugin>('ApkInstaller')

// Apps from before in-app updates have no ApkInstaller and must be replaced through the browser.
export const hasInAppInstaller = () => Capacitor.isPluginAvailable('ApkInstaller')

export async function isUpdateRequired(): Promise<boolean> {
  if (!isNativeApp()) return false
  if (!hasInAppInstaller()) return true
  try {
    const res = await fetch(`${APP_CONFIG_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return false
    const { minNativeBuild } = (await res.json()) as { minNativeBuild: number }
    const { build } = await App.getInfo()
    return Number(build) < minNativeBuild
  } catch {
    return false
  }
}
