#!/usr/bin/env node
// Validate the catalog or add / fill a movie entry.
//
//   npm run validate
//   npm run add-movie -- --title "Nosferatu" --year 1922 --duration 94 --category classics \
//     --stream https://archive.org/download/<item>/<file>.mp4 --poster https://archive.org/services/img/<item> \
//     --license "Dominio público (EE. UU.)" --source https://archive.org/details/<item> \
//     --synopsis "..." [--backdrop URL] [--rating +12] [--type hls|mp4] [--check]
//
// New entries fill the first empty draft slot (kp_007..kp_020) or get the next kp_NNN id.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FILE = fileURLToPath(new URL('../src/data/catalog.json', import.meta.url))
const REQUIRED = ['title', 'year', 'duration', 'category', 'synopsis', 'poster', 'stream', 'license', 'source']

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else out[key] = argv[++i]
  }
  return out
}

const isHttps = (u) => {
  try {
    return new URL(u).protocol === 'https:'
  } catch {
    return false
  }
}

function validate(catalog) {
  const errors = []
  const ids = new Set()
  const cats = new Set(catalog.categories.map((c) => c.id))
  for (const m of catalog.movies) {
    const where = m.id || '(sin id)'
    if (!/^kp_\d{3,}$/.test(m.id ?? '')) errors.push(`${where}: id debe ser kp_NNN`)
    if (ids.has(m.id)) errors.push(`${where}: id duplicado`)
    ids.add(m.id)
    if (m.draft) continue
    for (const k of REQUIRED) if (m[k] === undefined || m[k] === '' || m[k] === 0) errors.push(`${where}: falta "${k}"`)
    if (!cats.has(m.category)) errors.push(`${where}: categoría desconocida "${m.category}"`)
    for (const k of ['poster', 'backdrop', 'stream', 'source']) if (m[k] && !isHttps(m[k])) errors.push(`${where}: ${k} debe ser una URL https`)
    if (!['hls', 'mp4'].includes(m.type)) errors.push(`${where}: type debe ser "hls" o "mp4"`)
    if (m.type === 'hls' && !/\.m3u8(\?|$)/.test(m.stream)) errors.push(`${where}: type hls requiere un .m3u8`)
    if (m.year < 1880 || m.year > new Date().getFullYear() + 1) errors.push(`${where}: año inválido`)
  }
  return errors
}

async function checkReachable(url) {
  const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1' }, redirect: 'follow' })
  await res.body?.cancel()
  return res.ok || res.status === 206
}

const args = parseArgs(process.argv.slice(2))
const catalog = JSON.parse(readFileSync(FILE, 'utf8'))

if (args.validate) {
  const errors = validate(catalog)
  if (errors.length) {
    console.error('✗ Catálogo inválido:\n  ' + errors.join('\n  '))
    process.exit(1)
  }
  const live = catalog.movies.filter((m) => !m.draft)
  console.log(`✓ Catálogo válido: ${live.length} películas publicadas, ${catalog.movies.length - live.length} plantillas libres.`)
  if (args.check) {
    for (const m of live) console.log(`  ${(await checkReachable(m.stream)) ? '✓' : '✗'} ${m.id} ${m.title}`)
  }
  process.exit(0)
}

const missing = REQUIRED.filter((k) => !args[k])
if (missing.length) {
  console.error(`Faltan parámetros: ${missing.map((k) => '--' + k).join(', ')}\nUso: ver cabecera de scripts/add-movie.mjs`)
  process.exit(1)
}

const stream = String(args.stream)
const entry = {
  title: String(args.title),
  year: Number(args.year),
  duration: Number(args.duration),
  category: String(args.category),
  rating: String(args.rating ?? 'ATP'),
  synopsis: String(args.synopsis),
  poster: String(args.poster),
  backdrop: String(args.backdrop ?? args.poster),
  stream,
  type: args.type ?? (/\.m3u8(\?|$)/.test(stream) ? 'hls' : 'mp4'),
  license: String(args.license),
  source: String(args.source),
}

if (catalog.movies.some((m) => !m.draft && m.stream === stream)) {
  console.error('✗ Ese stream ya está en el catálogo.')
  process.exit(1)
}

const slot = catalog.movies.find((m) => m.draft)
let id
if (slot) {
  id = slot.id
  for (const k of Object.keys(slot)) delete slot[k]
  Object.assign(slot, { id, ...entry })
} else {
  const n = Math.max(0, ...catalog.movies.map((m) => Number(m.id.slice(3)) || 0)) + 1
  id = `kp_${String(n).padStart(3, '0')}`
  catalog.movies.push({ id, ...entry })
}

const errors = validate(catalog)
if (errors.length) {
  console.error('✗ La entrada no es válida:\n  ' + errors.join('\n  '))
  process.exit(1)
}
if (args.check && !(await checkReachable(stream))) {
  console.error(`✗ El stream no responde: ${stream}`)
  process.exit(1)
}

writeFileSync(FILE, JSON.stringify(catalog, null, 2) + '\n')
console.log(`✓ Añadida "${entry.title}" como ${id}. Haz commit y push a main para publicar web + APK.`)
