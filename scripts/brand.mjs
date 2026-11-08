#!/usr/bin/env node
// Generates every KinoPulse brand asset (web, PWA, Android launcher, Android TV banner) from one SVG master.
//   node scripts/brand.mjs
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(ROOT, 'public')
const RES = join(ROOT, 'android/app/src/main/res')

const BG = '#090A0F'
const BORDER = '#2A2E44'
const RED = '#E50914'
const AMBER = '#FFB020'
const FONT = "'Segoe UI Black','Arial Black','Inter',system-ui,sans-serif"

// The symbol: a rounded play triangle with a neon pulse (ECG) line crossing it. Drawn in a 100x100 box.
const mark = (id) => `
  <defs>
    <linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${RED}"/><stop offset="1" stop-color="${AMBER}"/>
    </linearGradient>
    <filter id="f${id}" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="3.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="M33 20 Q30 18.5 30 22 V78 Q30 81.5 33 80 L80 53 Q83 50 80 47 Z" fill="url(#g${id})" filter="url(#f${id})"/>
  <path d="M8 52 H36 L43 38 L52 66 L59 46 L64 52 H92" fill="none" stroke="${BG}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M8 52 H36 L43 38 L52 66 L59 46 L64 52 H92" fill="none" stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" filter="url(#f${id})"/>`

// Square icon. `pad` shrinks the symbol (maskable / adaptive safe zone); `frame` draws the rounded tile + border.
const iconSvg = ({ size = 1024, pad = 0.14, frame = true, radius = 0.22 } = {}) => {
  const inner = size * (1 - 2 * pad)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${frame ? `<rect x="${size * 0.01}" y="${size * 0.01}" width="${size * 0.98}" height="${size * 0.98}" rx="${size * radius}" fill="${BG}" stroke="${BORDER}" stroke-width="${size * 0.012}"/>` : ''}
  <g transform="translate(${size * pad} ${size * pad}) scale(${inner / 100})">${mark('i')}</g>
</svg>`
}

// Horizontal lockup: symbol + KINOPULSE wordmark.
const logoSvg = ({ w = 1280, h = 720, frame = true } = {}) => {
  const s = h * 0.42
  const textSize = h * 0.145
  const textW = textSize * 5.6
  const x0 = (w - (s + h * 0.05 + textW)) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${frame ? `<rect x="${h * 0.012}" y="${h * 0.012}" width="${w - h * 0.024}" height="${h - h * 0.024}" rx="${h * 0.08}" fill="${BG}" stroke="${BORDER}" stroke-width="${h * 0.014}"/>` : ''}
  <g transform="translate(${x0} ${(h - s) / 2}) scale(${s / 100})">${mark('l')}</g>
  <text x="${x0 + s + h * 0.05}" y="${h / 2 + textSize * 0.36}" font-family="${FONT}" font-weight="900" font-size="${textSize}" letter-spacing="${textSize * 0.04}" textLength="${textW}" lengthAdjust="spacingAndGlyphs" fill="#FFFFFF">KINO<tspan fill="${RED}">PULSE</tspan></text>
</svg>`
}

const out = (p) => {
  mkdirSync(dirname(p), { recursive: true })
  return p
}
const png = (svg, w, h, p) => sharp(Buffer.from(svg)).resize(w, h ?? w).png().toFile(out(p))

// ICO with embedded PNG frames (supported by every browser and Windows Vista+).
async function ico(svg, sizes, p) {
  const frames = await Promise.all(sizes.map((s) => sharp(Buffer.from(svg)).resize(s, s).png().toBuffer()))
  const header = Buffer.alloc(6 + 16 * frames.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  let offset = header.length
  frames.forEach((f, i) => {
    const e = 6 + 16 * i
    header.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], e)
    header.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], e + 1)
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(f.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += f.length
  })
  writeFileSync(out(p), Buffer.concat([header, ...frames]))
}

const icon = iconSvg()
const tile = iconSvg({ pad: 0.12, radius: 0.18 })

// Web / PWA
writeFileSync(out(join(PUB, 'favicon.svg')), iconSvg({ size: 64, pad: 0.1 }))
writeFileSync(out(join(PUB, 'logo.svg')), logoSvg({ w: 900, h: 180, frame: false }))
await ico(iconSvg({ size: 256, pad: 0.08 }), [16, 32, 48, 256], join(PUB, 'favicon.ico'))
await png(tile, 180, 180, join(PUB, 'apple-touch-icon.png'))
await png(icon, 192, 192, join(PUB, 'pwa-192x192.png'))
await png(icon, 512, 512, join(PUB, 'pwa-512x512.png'))
await png(iconSvg({ pad: 0.22, radius: 0 }), 512, 512, join(PUB, 'pwa-maskable-512x512.png'))
await png(logoSvg(), 1200, 630, join(PUB, 'og-image.png'))
rmSync(join(PUB, 'icons'), { recursive: true, force: true })

// Android launcher (legacy square + round, and adaptive foreground drawn inside the 66% safe zone)
const round = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><circle cx="512" cy="512" r="506" fill="${BG}" stroke="${BORDER}" stroke-width="12"/><g transform="translate(184 184) scale(6.56)">${mark('r')}</g></svg>`
const foreground = iconSvg({ pad: 0.27, frame: false })
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
for (const [d, k] of Object.entries(DENSITIES)) {
  const dir = join(RES, `mipmap-${d}`)
  await png(tile, 48 * k, 48 * k, join(dir, 'ic_launcher.png'))
  await png(round, 48 * k, 48 * k, join(dir, 'ic_launcher_round.png'))
  await png(foreground, 108 * k, 108 * k, join(dir, 'ic_launcher_foreground.png'))
}

// Android TV leanback banner (320x180 dp → xhdpi 640x360 keeps it sharp on 1080p/4K TVs)
const banner = logoSvg({ w: 1280, h: 720 })
await png(banner, 320, 180, join(RES, 'drawable', 'tv_banner.png'))
await png(banner, 640, 360, join(RES, 'drawable-xhdpi', 'tv_banner.png'))
await png(banner, 320, 180, join(RES, 'mipmap-xhdpi', 'tv_banner.png'))
rmSync(join(RES, 'drawable-xhdpi', 'banner.png'), { force: true })

console.log('✓ KinoPulse brand assets generated')
