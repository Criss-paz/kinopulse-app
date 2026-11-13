import { useEffect, useRef, useState } from 'react'
import { REPO } from '../lib/config'
import { movies } from '../lib/catalog'
import { focusFirst } from '../lib/spatial'
import { fetchStats, statsEnabled, StatsError, type Stats } from '../lib/stats'

const PASS_KEY = 'kp_admin_pass'
const REFRESH_MS = 10 * 1000
const DOWNLOADS_REFRESH_MS = 10 * 60 * 1000

const PLATFORM_LABEL: Record<string, string> = { tv: 'Android TV', android: 'Android (teléfono)', pwa: 'App de escritorio (PWA)', web: 'Navegador' }

const titleOf = (id: string) => movies.find((m) => m.id === id)?.title ?? id

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

function Tile({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-obsidian-900 p-5">
      <p className={`text-4xl font-black tabular-nums md:text-5xl ${accent ? 'text-pulse-cyan' : 'text-white'}`}>{value}</p>
      <p className="mt-1 text-sm text-white/60 md:text-base">{label}</p>
    </div>
  )
}

function Table({ title, rows, empty }: { title: string; rows: [string, number | string][]; empty: string }) {
  return (
    <section className="kp-panel">
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

// One series (devices per day), so one colour and no legend: the title names it. Every bar carries
// its value, and the day shows under the first, the last and every few in between.
function DaysChart({ days }: { days: Stats['days'] }) {
  const rows = [...days].reverse()
  const max = Math.max(1, ...rows.map((d) => d.devices))
  const every = Math.ceil(rows.length / 7)
  return (
    <section className="kp-panel md:col-span-2">
      <h2 className="kp-panel-title">Dispositivos activos por día (14 días)</h2>
      {rows.length === 0 ? (
        <p className="text-white/50">Aún no hay datos.</p>
      ) : (
        <div className="flex h-48 items-stretch gap-0.5" role="img" aria-label={rows.map((d) => `${d.day}: ${d.devices}`).join(', ')}>
          {rows.map((d, i) => (
            <div key={d.day} className="group flex min-w-0 flex-1 flex-col items-center" title={`${d.day}: ${d.devices} dispositivos`}>
              <div className="flex w-full flex-1 flex-col items-center justify-end">
                <span className="mb-1 text-xs tabular-nums text-white/70 group-hover:text-white">{d.devices}</span>
                <div className="w-full max-w-10 rounded-t bg-pulse-cyan/80 group-hover:bg-pulse-cyan" style={{ height: `${(d.devices / max) * 80}%`, minHeight: 2 }} />
              </div>
              <span className="mt-1 h-4 whitespace-nowrap text-xs text-white/50">{i % every === 0 || i === rows.length - 1 ? d.day.slice(5) : ''}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default function Admin({ onBack }: { onBack: () => void }) {
  const [password, setPassword] = useState(savedPass)
  const [draft, setDraft] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  const [downloads, setDownloads] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (password) focusFirst()
    else inputRef.current?.focus()
  }, [password])

  useEffect(() => {
    if (!password || !statsEnabled()) return
    let alive = true
    const load = () =>
      fetchStats(password)
        .then((s) => {
          if (!alive) return
          setStats(s)
          setError('')
          try {
            sessionStorage.setItem(PASS_KEY, password)
          } catch {
            // ignore storage errors
          }
        })
        .catch((e) => {
          if (!alive) return
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
  }, [password])

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
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Tile accent label="Conectados ahora" value={stats.online} />
              <Tile accent label="Viendo una película ahora" value={stats.watching} />
              <Tile label="Dispositivos activos hoy" value={stats.active_today} />
              <Tile label="Nuevos hoy" value={stats.new_today} />
              <Tile label="Activos en 7 días" value={stats.active_7d} />
              <Tile label="Activos en 30 días" value={stats.active_30d} />
              <Tile label="Dispositivos totales" value={stats.devices} />
              <Tile label="Descargas del APK" value={downloads ?? '…'} />
              <Tile label="Reproducciones hoy" value={stats.plays_today} />
              <Tile label="Reproducciones totales" value={stats.plays_total} />
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <DaysChart days={stats.days} />
              <Table title="Viendo ahora" empty="Nadie está viendo nada en este momento." rows={stats.watchingNow.map((w) => [titleOf(w.movie), w.devices])} />
              <Table
                title="Por tipo de dispositivo (30 días)"
                empty="Aún no hay datos."
                rows={stats.platforms.map((p) => [PLATFORM_LABEL[p.platform] ?? p.platform, `${p.devices} · ${p.online} ahora`])}
              />
              <Table title="Más vistas (7 días)" empty="Aún no hay reproducciones." rows={stats.topWeek.map((t) => [titleOf(t.movie), t.plays])} />
              <Table title="Más vistas (siempre)" empty="Aún no hay reproducciones." rows={stats.topAll.map((t) => [titleOf(t.movie), t.plays])} />
              <Table title="Versión de la app instalada (30 días)" empty="Aún no hay apps instaladas reportando." rows={stats.versions.map((v) => [v.version, v.devices])} />
            </div>
            <p className="mt-6 text-sm text-white/40">
              Los días se cuentan en hora UTC. «Descargas del APK» viene de GitHub y cuenta descargas, no dispositivos. Un dispositivo desinstalado no avisa: simplemente deja de aparecer
              como activo.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
