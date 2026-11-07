# KinoPulse

Streaming of public-domain and openly licensed films for **Android TV, Android phones and desktop (PWA)** from one codebase. No login, no ads.

- **Web / PWA:** https://criss-paz.github.io/kinopulse-app/
- **APK (always latest):** https://github.com/Criss-paz/kinopulse-app/releases/latest/download/KinoPulse-TV-Mobile.apk
- **Download center:** https://criss-paz.github.io/kinopulse-app/#/descargar

## Stack

Vite + React 18 + TypeScript + Tailwind · hls.js player · Capacitor 7 (Android) · GitHub Actions → GitHub Releases + GitHub Pages.

| Path | What |
| --- | --- |
| `src/lib/spatial.ts` | D-pad spatial navigation (arrows, Enter, Back/Escape), row memory, auto-scroll |
| `src/components/Player.tsx` | TV player: auto-hiding controls (3 s), ±10 s seek with arrows, progress bar, subtitles, touch double-tap seek |
| `src/data/catalog.json` | Readable catalog. Entries with `"draft": true` are empty slots and are hidden |
| `scripts/add-movie.mjs` | Validates the catalog (runs on every build) and adds movies |
| `scripts/convert-video.py` | ffmpeg → MP4 faststart or HLS, optional upload to Internet Archive |
| `worker/cache-worker.js` | Optional transparent Cloudflare edge cache (allow-listed hosts, Range support, HLS rewrite) |
| `android/` | Capacitor project patched for leanback (TV) + touch, TV banner, immersive mode |
| `.github/workflows/release-apk.yml` | On push to `main`: build web, sync Capacitor, sign APK, publish Release, deploy Pages |

## Develop

```bash
npm install
npm run dev          # http://localhost:5173 — use the arrow keys to navigate like a TV remote
npm run build        # validate catalog + type-check + production build
```

## Add a movie

Only add works that are in the public domain or under a license that allows redistribution.

```bash
npm run add-movie -- --title "Nosferatu" --year 1922 --duration 94 --category classics \
  --synopsis "Un agente inmobiliario viaja a Transilvania..." \
  --stream "https://archive.org/download/<item>/<file>.mp4" \
  --poster "https://archive.org/services/img/<item>" \
  --license "Dominio público (EE. UU.)" --source "https://archive.org/details/<item>" --check
git commit -am "Add Nosferatu" && git push      # CI rebuilds web + APK
```

`--check` verifies the stream responds. `npm run validate -- --check` checks every published stream.

### Convert / upload your own video

```bash
pip install internetarchive && ia configure
python scripts/convert-video.py film.mkv                      # out/film.mp4 (H.264 + AAC, faststart)
python scripts/convert-video.py film.mkv --hls                # out/film/index.m3u8
python scripts/convert-video.py film.mkv --upload-ia my-item --license https://creativecommons.org/licenses/by/4.0/
```

## Edge cache (optional)

```bash
cd worker && npx wrangler deploy
```

Then build with `VITE_EDGE_PROXY=https://kinopulse-cache.<you>.workers.dev` (e.g. as a repo variable in the workflow) so streams are cached at Cloudflare's edge.

## Security

Static site, no backend, no database, no user data. CSP + referrer policy as meta tags (GitHub Pages can't set headers); `public/_headers` sets CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` and HSTS when hosted on Cloudflare Pages or Netlify.

## Signing

The release keystore lives only in the repo secrets `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. Keep an offline backup: losing it means users must uninstall before installing future builds.

## Legal

Each title lists its license and source. Rights holders can open an issue to request removal.
