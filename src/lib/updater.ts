import { Capacitor } from '@capacitor/core'

export interface AppVersion {
  version: string;
  url: string;
  releaseNotes: string;
}

// The APK bundles its own copy of /version.json, so the installed app must read the published one from GitHub.
const VERSION_URL = 'https://raw.githubusercontent.com/Criss-paz/kinopulse-app/main/public/version.json'

export const APK_URL = 'https://github.com/Criss-paz/kinopulse-app/releases/latest/download/KinoPulse-TV-Mobile.apk'

export const isNativeApp = () => Capacitor.isNativePlatform()

// "1.0.10" > "1.0.9"
function isNewerVersion(remote: string, current: string) {
  const a = remote.split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

export async function checkUpdate(currentVersion: string): Promise<{ shouldUpdate: boolean; data?: AppVersion }> {
  // The web version is always up to date; updates only apply to the installed app.
  if (!isNativeApp()) return { shouldUpdate: false };

  try {
    const response = await fetch(`${VERSION_URL}?t=${Date.now()}`);
    if (!response.ok) throw new Error('Failed to fetch version');
    const data: AppVersion = await response.json();

    const isNewer = isNewerVersion(data.version, currentVersion);

    return {
      shouldUpdate: isNewer,
      data: isNewer ? data : undefined
    };
  } catch (error) {
    console.error('Update check failed:', error);
    return { shouldUpdate: false };
  }
}
