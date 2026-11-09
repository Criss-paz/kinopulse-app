import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.kinopulse.tv',
  appName: 'KinoPulse',
  webDir: 'dist',
  backgroundColor: '#090A0F',
  android: { allowMixedContent: false },
  // The app loads its interface from the live site, so every web deploy reaches installed apps instantly.
  // offline.html (bundled) is shown when there is no connection.
  server: {
    url: 'https://kinopulse.vercel.app',
    errorPath: 'offline.html',
  },
}

export default config
