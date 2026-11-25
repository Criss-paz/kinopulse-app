import { useEffect, useRef, useState } from 'react'
import { REPO } from '../lib/config'
import { movies } from '../lib/catalog'
import { focusFirst } from '../lib/spatial'
import { fetchStats, markSuggestionDone, statsEnabled, StatsError, type Stats } from '../lib/stats'

const PASS_KEY = 'kp_admin_pass'
const REFRESH_MS = 10 * 1000
const DOWNLOADS_REFRESH_MS = 10 * 60 * 1000

const PLATFORM_LABEL: Record<string, string> = { tv: 'Android TV', android: 'Android (teléfono)', pwa: 'App de escritorio (PWA)', web: 'Navegador' }
const KIND_LABEL: Record<string, string> = { tv: 'Televisión', phone: 'Teléfono', tablet: 'Tableta', pc: 'Computadora' }

const PROBLEM_LABEL: Record<string, string> = {
  err_network: 'Falló al cargar (el servidor sí respondía)',
  err_decode: 'El dispositivo no pudo decodificarla',
  err_format: 'Formato no soportado por el dispositivo',
  no_carga: 'Reporte: no carga',
  tirones: 'Reporte: a tirones',
  audio: 'Reporte: audio',
  subtitulos: 'Reporte: idioma o subtítulos',
  otro: 'Reporte: otra cosa',
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

// Periods ending today; "day" is one day picked in the calendar.
type Period = { days: number } | { day: string }
const PRESETS: { label: string; days: number }[] = [
  { label: 'Hoy', days: 1 },
  { label: '7 días', days: 7 },
  { label: '15 días', days: 15 },
  { label: '1 mes', days: 30 },
  { label: '3 meses', days: 90 },
]

const titleOf = (id: string) => movies.find((m) => m.id === id)?.title ?? id

// Days are YYYY-MM-DD strings in the viewer's local time, the same days the server counts.
const pad = (n: number) => String(n).padStart(2, '0')
const toDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localToday = () => toDay(new Date())
const shiftDay = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number)
  return toDay(new Date(y, m - 1, d + n))
}
const prettyDay = (day: string, withYear = false) => {
  const [y, m, d] = day.split('-').map(Number)
  return `${d} de ${MONTHS[m - 1]}${withYear ? ` de ${y}` : ''}`
}

function rangeOf(period: Period, today: string): [string, string] {
  if ('day' in period) return [period.day, period.day]
  return [shiftDay(today, -(period.days - 1)), today]
}

// The password is kept for this session only, and it is the worker that checks it: nothing here
// can show stats without it.
const savedPass = () => {
  try {
    return sessionStorage.getItem(PASS_KEY) ?? ''
  } catch {
    return ''
  }
}

async function apkDownloads(): Promise<number> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`)
  if (!res.ok) throw new Error(String(res.status))
  const releases = (await res.json()) as { assets: { download_count: number }[] }[]
  return releases.reduce((sum, r) => sum + r.assets.reduce((s, a) => s + a.download_count, 0), 0)
}

function Tile({ label, value, accent, hint }: { label: string; value: number | string; accent?: boolean; hint?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-obsidian-900 p-5">
      <p className={`text-4xl font-black tabular-nums md:text-5xl ${accent ? 'text-pulse-cyan' : 'text-white'}`}>{value}</p>
      <p className="mt-1 text-sm text-white/60 md:text-base">{label}</p>
      {hint && <p className="mt-1 text-xs text-white/40">{hint}</p>}
    </div>
  )
}

function Table({ title, rows, empty, wide }: { title: string; rows: [string, number | string][]; empty: string; wide?: boolean }) {
  return (
    <section className={`kp-panel ${wide ? 'md:col-span-2' : ''}`}>
      <h2 className="kp-panel-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-white/50">{empty}</p>
      ) : (
        <table className="w-full text-left">
          <tbody>
            {rows.map(([name, n]) => (
              <tr key={name} className="border-t border-white/5">
                <td className="py-2 pr-4 text-white/80">{name}</td>
                <td className="py-2 text-right font-semibold tabular-nums text-white">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// Shares of a whole (devices by kind, users by browser): one bar per row, longest first.
function Shares({ title, rows, empty }: { title: string; rows: [string, number][]; empty: string }) {
  const total = rows.reduce((s, [, n]) => s + n, 0)
  return (
    <section className="kp-panel">
      <h2 className="kp-panel-title">{title}</h2>
      {rows.length === 0 || total === 0 ? (
        <p className="text-white/50">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map(([name, n]) => (
            <li key={name}>
              <div className="mb-1 flex justify-between gap-4 text-white/80">
                <span>{name}</span>
                <span className="font-semibold tabular-nums text-white">
                  {n} <span className="text-sm font-normal text-white/50">· {Math.round((n / total) * 100)}%</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-white/10">
                <div className="h-2 rounded-full bg-pulse-cyan/80" style={{ width: `${(n / total) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// One series per chart, so one colour and no legend: the title names it. Every bar carries its value
// when they fit, and the day shows under the first, the last and every few in between.
function DaysChart({ title, rows }: { title: string; rows: { day: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((d) => d.value))
  const every = Math.ceil(rows.length / 7)
  const showValues = rows.length <= 31
  return (
    <section className="kp-panel md:col-span-2">
      <h2 className="kp-panel-title">{title}</h2>
      <div className="flex h-48 items-stretch gap-0.5" role="img" aria-label={rows.map((d) => `${d.day}: ${d.value}`).join(', ')}>
        {rows.map((d, i) => (
          <div key={d.day} className="group flex min-w-0 flex-1 flex-col items-center" title={`${prettyDay(d.day)}: ${d.value}`}>
            <div className="flex w-full flex-1 flex-col items-center justify-end">
              {showValues && <span className="mb-1 text-xs tabular-nums text-white/70 group-hover:text-white">{d.value}</span>}
              <div className="w-full max-w-10 rounded-t bg-pulse-cyan/80 group-hover:bg-pulse-cyan" style={{ height: `${(d.value / max) * 80}%`, minHeight: 2 }} />
            </div>
            <span className="mt-1 h-4 whitespace-nowrap text-xs text-white/50">{i % every === 0 || i === rows.length - 1 ? d.day.slice(8) + '/' + d.day.slice(5, 7) : ''}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// A month grid of buttons, so it works with the TV remote as well as with touch and mouse.
function Calendar({ selected, today, firstDay, onPick }: { selected?: string; today: string; firstDay?: string | null; onPick: (day: string) => void }) {
  const start = selected ?? today
  const [month, setMonth] = useState(() => start.slice(0, 7))
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const lead = (first.getDay() + 6) % 7 // Monday first
  const count = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${pad(i + 1)}`)]
  const move = (n: number) => setMonth(toDay(new Date(y, m - 1 + n, 1)).slice(0, 7))
  const canNext = month < today.slice(0, 7)
  return (
    <div className="kp-panel max-w-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button data-nav className="kp-btn kp-btn-sm" onClick={() => move(-1)} aria-label="Mes anterior">
          ‹
        </button>
        <span className="font-semibold capitalize text-white">
          {MONTHS[m - 1]} {y}
        </span>
        <button data-nav className="kp-btn kp-btn-sm" onClick={() => move(1)} disabled={!canNext} aria-label="Mes siguiente">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="pb-1 text-xs text-white/40">
            {w}
          </span>
        ))}
        {cells.map((day, i) =>
          day === null ? (
            <span key={`x${i}`} />
          ) : (
            <button
              key={day}
              data-nav
              disabled={day > today}
              onClick={() => onPick(day)}
              className={`rounded-lg py-2 text-sm tabular-nums transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pulse-cyan disabled:cursor-default disabled:opacity-20 ${
                day === selected ? 'bg-pulse-cyan font-bold text-obsidian-950' : day === today ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10'
              } ${firstDay && day < firstDay ? 'opacity-40' : ''}`}
            >
              {Number(day.slice(8))}
            </button>
          ),
        )}
      </div>
    </div>
  )
}

export default function Admin({ onBack }: { onBack: () => void }) {
  const [password, setPassword] = useState(savedPass)
  const [draft, setDraft] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  const [downloads, setDownloads] = useState<number | null>(null)
  const [period, setPeriod] = useState<Period>({ days: 7 })
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const today = localToday()
  const [from, to] = rangeOf(period, today)

  useEffect(() => {
    if (password) focusFirst()
    else inputRef.current?.focus()
  }, [password])

  useEffect(() => {
    if (!password || !statsEnabled()) return
    let alive = true
    setLoading(true)
    const load = () =>
      fetchStats(password, from, to)
        .then((s) => {
          if (!alive) return
          setStats(s)
          setError('')
          setLoading(false)
          try {
            sessionStorage.setItem(PASS_KEY, password)
          } catch {
            // ignore storage errors
          }
        })
        .catch((e) => {
          if (!alive) return
          setLoading(false)
          const status = e instanceof StatsError ? e.status : 0
          if (status === 401 || status === 429) {
            // Wrong password (or too many tries): back to the form.
            try {
              sessionStorage.removeItem(PASS_KEY)
            } catch {
              // ignore storage errors
            }
            setStats(null)
            setPassword('')
            setError(status === 429 ? 'Demasiados intentos. Espera 15 minutos.' : 'Contraseña incorrecta.')
          } else if (status === 503) setError('El servidor de estadísticas no tiene contraseña configurada.')
          else setError('Sin conexión con el servidor de estadísticas. Reintentando…')
        })
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [password, from, to])

  const signedIn = stats !== null
  useEffect(() => {
    if (!signedIn) return
    const load = () => apkDownloads().then(setDownloads, () => undefined)
    load()
    const timer = window.setInterval(load, DOWNLOADS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [signedIn])

  const logout = () => {
    try {
      sessionStorage.removeItem(PASS_KEY)
    } catch {
      // ignore storage errors
    }
    onBack()
  }

  const range = stats?.range
  const live = stats?.live
  const singleDay = from === to
  const periodLabel = singleDay ? (to === today ? 'Hoy' : prettyDay(to, true)) : `Del ${prettyDay(from)} al ${prettyDay(to, from.slice(0, 4) !== to.slice(0, 4))}`
  const pick = (p: Period) => {
    setPeriod(p)
    setCalendarOpen(false)
  }

  return (
    <div data-nav-scope className="fixed inset-0 z-40 overflow-y-auto bg-obsidian-950">
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-12">
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <button data-nav className="kp-btn" onClick={onBack}>
            ← Volver
          </button>
          {stats && (
            <button data-nav className="kp-btn" onClick={logout}>
              Cerrar sesión
            </button>
          )}
          {stats && (
            <span className="ml-auto flex items-center gap-2 text-sm text-white/50">
              <span className="h-2 w-2 animate-pulse rounded-full bg-pulse-cyan" />
              En vivo · {new Date(stats.at * 1000).toLocaleTimeString()}
            </span>
          )}
        </div>
        <h1 className="mb-8 text-4xl font-black text-white md:text-5xl">Estadísticas</h1>

        {!statsEnabled() ? (
          <p className="text-white/70">El servidor de estadísticas todavía no está configurado en esta versión.</p>
        ) : !stats ? (
          <form
            className="kp-panel max-w-md"
            onSubmit={(e) => {
              e.preventDefault()
              if (draft) setPassword(draft)
              setDraft('')
            }}
          >
            <label htmlFor="kp-admin-pass" className="kp-panel-title">
              Contraseña de administrador
            </label>
            <input
              ref={inputRef}
              id="kp-admin-pass"
              data-nav
              type="password"
              autoComplete="current-password"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full rounded-full bg-white/10 px-4 py-3 text-white outline-none focus:ring-4 focus:ring-pulse-cyan"
            />
            {error && <p className="text-pulse-amber">{error}</p>}
            {password && !error && <p className="text-white/50">Comprobando…</p>}
            <button data-nav type="submit" className="kp-btn kp-btn-primary" disabled={!draft}>
              Entrar
            </button>
          </form>
        ) : (
          <>
            {error && <p className="mb-4 text-pulse-amber">{error}</p>}

            <h2 className="mb-4 text-2xl font-bold text-white">Ahora mismo</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Tile accent label="Conectados ahora" value={live?.online ?? stats.online} />
              <Tile accent label="Viendo una película ahora" value={live?.watching ?? stats.watching} />
              {(live?.byKind ?? []).slice(0, 2).map((k) => (
                <Tile key={k.kind} label={`${KIND_LABEL[k.kind] ?? k.kind} conectadas ahora`} value={k.n} />
              ))}
            </div>
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <Table title="Películas que se están viendo" empty="Nadie está viendo nada en este momento." rows={(live?.watchingNow ?? stats.watchingNow).map((w) => [titleOf(w.movie), w.devices])} />
              <Shares title="Conectados por dispositivo" empty="Nadie conectado en este momento." rows={(live?.byKind ?? []).map((k) => [KIND_LABEL[k.kind] ?? k.kind, k.n])} />
            </div>

            {stats.suggestions && (
              <section className="kp-panel mt-6">
                <h2 className="kp-panel-title">🎬 Películas que piden los usuarios ({stats.suggestions.length})</h2>
                {stats.suggestions.length === 0 ? (
                  <p className="text-white/50">No hay sugerencias pendientes.</p>
                ) : (
                  <ul className="w-full divide-y divide-white/5">
                    {stats.suggestions.map((s) => (
                      <li key={s.sid} className="flex items-center gap-4 py-2">
                        <span className="flex-1 break-words text-white/90">{s.text}</span>
                        <span className="shrink-0 text-sm text-white/40">{new Date(s.created * 1000).toLocaleDateString()}</span>
                        <button
                          data-nav
                          className="kp-btn kp-btn-sm shrink-0"
                          onClick={() =>
                            markSuggestionDone(password, s.sid).then((ok) => {
                              if (ok) setStats((cur) => (cur ? { ...cur, suggestions: cur.suggestions?.filter((x) => x.sid !== s.sid) } : cur))
                            }, () => undefined)
                          }
                        >
                          ✓ Atendida
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <h2 className="mb-4 mt-10 text-2xl font-bold text-white">Descargas e instalaciones</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Tile label="Descargas del APK" value={downloads ?? '…'} hint="Según GitHub: cuenta descargas, no dispositivos" />
              <Tile label="Instalaciones totales" value={stats.installs?.total ?? '—'} hint="App en TV o teléfono, o instalada desde el navegador" />
              <Tile accent label="Aún instaladas" value={stats.installs?.active ?? '—'} hint="Abrieron la app en los últimos 30 días" />
              <Tile label="Dispositivos totales" value={stats.devices} hint="Incluye quien solo entró por el navegador" />
            </div>
            {stats.installs && (
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <Table
                  title="Instalaciones por tipo de dispositivo"
                  empty="Aún no hay apps instaladas reportando."
                  rows={stats.installs.byKind.map((k) => [KIND_LABEL[k.kind] ?? k.kind, `${k.active} activas de ${k.total}`])}
                />
                <Table title="Versión de la app instalada (30 días)" empty="Aún no hay apps instaladas reportando." rows={stats.versions.map((v) => [v.version, v.devices])} />
              </div>
            )}

            <div className="mb-4 mt-10 flex flex-wrap items-center gap-3">
              <h2 className="mr-auto text-2xl font-bold text-white">Por periodo</h2>
              {PRESETS.map((p) => (
                <button
                  key={p.days}
                  data-nav
                  className={`kp-btn kp-btn-sm ${'days' in period && period.days === p.days ? 'kp-btn-active' : ''}`}
                  onClick={() => pick({ days: p.days })}
                >
                  {p.label}
                </button>
              ))}
              <button data-nav className={`kp-btn kp-btn-sm ${'day' in period || calendarOpen ? 'kp-btn-active' : ''}`} onClick={() => setCalendarOpen((o) => !o)}>
                📅 {'day' in period ? prettyDay(period.day) : 'Elegir día'}
              </button>
            </div>
            {calendarOpen && (
              <div className="mb-6 flex justify-end">
                <Calendar selected={'day' in period ? period.day : undefined} today={today} firstDay={stats.firstDay} onPick={(day) => pick({ day })} />
              </div>
            )}
            <p className="mb-4 text-white/60">
              {periodLabel}
              {loading && <span className="ml-2 text-white/40">· cargando…</span>}
            </p>

            {!range ? (
              <p className="kp-panel text-white/60">El servidor de estadísticas es una versión anterior: vuelve a desplegarlo para ver los periodos y el calendario.</p>
            ) : (
              <>
                {stats.firstDay && from < stats.firstDay && (
                  <p className="mb-4 text-sm text-pulse-amber">La app tiene datos desde el {prettyDay(stats.firstDay, true)}: los días anteriores salen en cero.</p>
                )}
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <Tile accent label={singleDay ? 'Usuarios ese día' : 'Usuarios en el periodo'} value={range.users} hint="Dispositivos distintos que abrieron la app" />
                  <Tile label="Dispositivos nuevos" value={range.new_devices} />
                  <Tile label="Reproducciones" value={range.plays} />
                  <Tile label="Reproducciones totales" value={range.plays_total} hint="Desde siempre" />
                </div>
                <div className="mt-6 grid gap-6 md:grid-cols-2">
                  {!singleDay && <DaysChart title="Usuarios por día" rows={range.days.map((d) => ({ day: d.day, value: d.users }))} />}
                  {!singleDay && <DaysChart title="Reproducciones por día" rows={range.days.map((d) => ({ day: d.day, value: d.plays }))} />}
                  <Table title="Películas más vistas" empty="No hubo reproducciones en este periodo." rows={range.top.map((t) => [titleOf(t.movie), t.plays])} />
                  <Shares title="Usuarios por tipo de dispositivo" empty="Sin datos de dispositivo en este periodo." rows={range.byKind.map((k) => [KIND_LABEL[k.kind] ?? k.kind, k.users])} />
                  <Shares title="Usuarios por navegador" empty="Sin datos de navegador en este periodo." rows={range.byBrowser.map((b) => [b.browser, b.users])} />
                  <Table
                    title="Por plataforma (30 días)"
                    empty="Aún no hay datos."
                    rows={stats.platforms.map((p) => [PLATFORM_LABEL[p.platform] ?? p.platform, `${p.devices} · ${p.online} ahora`])}
                  />
                  <section className="kp-panel md:col-span-2">
                    <h2 className="kp-panel-title">Películas con problemas</h2>
                    {range.problems.length === 0 ? (
                      <p className="text-white/50">Ninguna película falló ni fue reportada en este periodo.</p>
                    ) : (
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-sm text-white/50">
                            <th className="pb-2 pr-4 font-medium">Película</th>
                            <th className="pb-2 pr-4 font-medium">Problema</th>
                            <th className="pb-2 pr-4 font-medium">Dispositivo</th>
                            <th className="pb-2 text-right font-medium">Dispositivos</th>
                          </tr>
                        </thead>
                        <tbody>
                          {range.problems.map((p) => (
                            <tr key={`${p.movie}|${p.kind}|${p.platform}`} className="border-t border-white/5">
                              <td className="py-2 pr-4 text-white/80">{titleOf(p.movie)}</td>
                              <td className="py-2 pr-4 text-white/80">{PROBLEM_LABEL[p.kind] ?? p.kind}</td>
                              <td className="py-2 pr-4 text-white/60">{PLATFORM_LABEL[p.platform] ?? p.platform}</td>
                              <td className="py-2 text-right font-semibold tabular-nums text-white">{p.n}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </section>
                </div>
                <p className="mt-6 text-sm text-white/40">
                  Los días se cuentan en hora de Centroamérica (UTC−6).
                  {stats.detailSince && ` El desglose por dispositivo y navegador existe desde el ${prettyDay(stats.detailSince, true)}.`} Un dispositivo desinstalado no avisa:
                  simplemente deja de aparecer como activo.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
