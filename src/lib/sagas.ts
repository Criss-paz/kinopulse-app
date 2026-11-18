import type { Movie } from '../types'
import { movies } from './catalog'

// Sagas in viewing order. The catalog has no saga field, so they live here by movie id; ids that
// are not (or no longer) in the catalog are simply skipped.
const SAGAS: [name: string, ids: string[]][] = [
  ['John Wick', ['kp_007', 'kp_013', 'kp_008', 'kp_009', 'kp_015']],
  ['Animales fantásticos', ['kp_090', 'kp_091', 'kp_092']],
  ['Avatar', ['kp_220', 'kp_221', 'kp_235']],
  ['Batman: El caballero de la noche', ['kp_095', 'kp_096', 'kp_097']],
  ['Universo DC de Zack Snyder', ['kp_224', 'kp_139', 'kp_098']],
  ['Blade', ['kp_099', 'kp_100', 'kp_101']],
  ['Chucky', ['kp_051', 'kp_052', 'kp_053', 'kp_054', 'kp_055', 'kp_056', 'kp_057']],
  ['Depredador', ['kp_181', 'kp_182', 'kp_178', 'kp_183', 'kp_184', 'kp_039', 'kp_185']],
  ['Duna', ['kp_218', 'kp_219']],
  ['La Tierra Media', ['kp_196', 'kp_197', 'kp_093', 'kp_140', 'kp_142']],
  ['Monsterverse', ['kp_034', 'kp_035', 'kp_036']],
  ['Guardianes de la Galaxia', ['kp_190', 'kp_191', 'kp_192']],
  ['Harry Potter', ['kp_205', 'kp_206', 'kp_207', 'kp_208', 'kp_209', 'kp_210', 'kp_211', 'kp_212']],
  ['It', ['kp_222', 'kp_223']],
  ['La noche del demonio', ['kp_228', 'kp_229', 'kp_230', 'kp_231', 'kp_232', 'kp_233']],
  ['Los Increíbles', ['kp_080', 'kp_117']],
  ['Mi pobre angelito', ['kp_143', 'kp_144']],
  ['Misión Imposible', ['kp_082', 'kp_083', 'kp_084', 'kp_085', 'kp_014', 'kp_081']],
  ['Nadie', ['kp_022', 'kp_104']],
  ['No respires', ['kp_121', 'kp_122']],
  ['Piratas del Caribe', ['kp_213', 'kp_214', 'kp_215', 'kp_216', 'kp_217']],
  ['Rocky', ['kp_106', 'kp_107', 'kp_108', 'kp_109', 'kp_110', 'kp_111']],
  ['Santa Cláusula', ['kp_148', 'kp_149']],
  ['Happy Gilmore', ['kp_066', 'kp_067']],
  ['Tierra de osos', ['kp_078', 'kp_079']],
  ['Una pareja de idiotas', ['kp_068', 'kp_069']],
  ['Viernes 13', ['kp_128', 'kp_129', 'kp_130', 'kp_131', 'kp_132', 'kp_133', 'kp_134', 'kp_135', 'kp_136', 'kp_137', 'kp_138']],
  ['Spider-Man', ['kp_289', 'kp_290', 'kp_291', 'kp_292', 'kp_295', 'kp_293', 'kp_294', 'kp_296', 'kp_018']],
  ['Rápidos y furiosos', ['kp_249', 'kp_250', 'kp_251', 'kp_252', 'kp_253', 'kp_254', 'kp_256', 'kp_257', 'kp_258', 'kp_259']],
  ['Deadpool', ['kp_260', 'kp_261', 'kp_262']],
  ['Actividad paranormal', ['kp_271', 'kp_272', 'kp_273', 'kp_274', 'kp_275', 'kp_276', 'kp_277']],
  ['Terrifier', ['kp_278', 'kp_279', 'kp_280']],
  ['La masacre de Texas', ['kp_283', 'kp_284', 'kp_281', 'kp_282', 'kp_285', 'kp_286']],
  ['Percy Jackson', ['kp_247', 'kp_248']],
  ['Halloween', ['kp_298', 'kp_193']],
  ['El Grinch', ['kp_145', 'kp_146']],
  ['X-Men', ['kp_026', 'kp_027', 'kp_028', 'kp_029', 'kp_030', 'kp_031', 'kp_032', 'kp_025', 'kp_033']],
]

export function sagaOf(movieId: string): { name: string; movies: Movie[] } | null {
  const saga = SAGAS.find(([, ids]) => ids.includes(movieId))
  if (!saga) return null
  const list = saga[1].map((id) => movies.find((m) => m.id === id)).filter((m): m is Movie => !!m)
  return list.length > 1 ? { name: saga[0], movies: list } : null
}

export function nextInSaga(movieId: string): Movie | null {
  const list = sagaOf(movieId)?.movies
  if (!list) return null
  return list[list.findIndex((m) => m.id === movieId) + 1] ?? null
}

// Same category, closest in year first; the saga is left out because it has its own row.
export function similarTo(movie: Movie, limit = 14): Movie[] {
  const saga = new Set(sagaOf(movie.id)?.movies.map((m) => m.id))
  return movies
    .filter((m) => m.id !== movie.id && m.category === movie.category && !saga.has(m.id))
    .sort((a, b) => Math.abs(a.year - movie.year) - Math.abs(b.year - movie.year))
    .slice(0, limit)
}
