import { useEffect, useState } from 'react'
import { DONATE_URL } from '../lib/config'
import { focusFirst } from '../lib/spatial'
import { sendSuggestion, statsEnabled, SUGGESTION_MAX } from '../lib/stats'
import { createSync, formatCode, joinSync, leaveSync, syncCode, syncEnabled, syncNow } from '../lib/sync'

export default function More({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState(syncCode)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [idea, setIdea] = useState('')
  const [ideaState, setIdeaState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  const suggest = async () => {
    const text = idea.trim()
    if (text.length < 2 || ideaState === 'sending') return
    setIdeaState('sending')
    const ok = await sendSuggestion(text)
    setIdeaState(ok ? 'sent' : 'failed')
    if (ok) setIdea('')
  }

  useEffect(() => {
    focusFirst()
    const refresh = () => setCode(syncCode())
    window.addEventListener('kp-sync-updated', refresh)
    return () => window.removeEventListener('kp-sync-updated', refresh)
  }, [])

  const run = async (task: () => Promise<string>) => {
    setBusy(true)
    setMessage('')
    try {
      setMessage(await task())
    } catch {
      setMessage('No se pudo conectar con el servidor. Inténtalo de nuevo en un momento.')
    } finally {
      setBusy(false)
      // Los botones cambian al vincular o desvincular; el foco no debe quedarse en uno que ya no existe.
      requestAnimationFrame(focusFirst)
    }
  }

  const create = () =>
    run(async () => {
      await createSync()
      return 'Listo. Escribe este código en tus otros dispositivos.'
    })

  const join = () =>
    run(async () => {
      if (!(await joinSync(draft))) return 'Ese código no existe. Revísalo: son 8 letras y números.'
      setDraft('')
      return 'Dispositivo vinculado: tu progreso y tu lista ya están aquí.'
    })

  const refresh = () =>
    run(async () => {
      await syncNow()
      return syncCode() ? 'Sincronizado.' : 'El código ya no existe en el servidor. Crea uno nuevo.'
    })

  return (
    <div data-nav-scope className="fixed inset-0 z-40 overflow-y-auto bg-obsidian-950">
      <div className="mx-auto max-w-5xl px-4 py-10 md:px-12">
        <button data-nav data-nav-autofocus className="kp-btn mb-8" onClick={onBack}>
          ← Volver
        </button>
        <h1 className="mb-8 text-4xl font-black text-white md:text-5xl">Más</h1>

        <div className="grid gap-6 md:grid-cols-2">
          {DONATE_URL && (
            <section className="kp-panel md:col-span-2">
              <h2 className="kp-panel-title">☕ ¿Te gusta KinoPulse? Invítame un café</h2>
              <p className="text-white/70">
                KinoPulse es gratis y no tiene anuncios. Si la disfrutas, puedes apoyarla con el monto que tú quieras por PayPal. Es totalmente opcional: la app
                funciona igual para todos.
              </p>
              <a data-nav className="kp-btn kp-btn-primary" href={DONATE_URL} target="_blank" rel="noopener noreferrer">
                Donar con PayPal
              </a>
              <p className="text-sm text-white/50">
                ¿Estás en la tele? Entra desde tu teléfono a <span className="break-all font-mono text-white/80">{DONATE_URL.replace(/^https?:\/\//, '')}</span>
              </p>
            </section>
          )}

          {statsEnabled() && (
            <section className="kp-panel md:col-span-2">
              <h2 className="kp-panel-title">🎬 ¿Qué película quieres ver aquí?</h2>
              <p className="text-white/70">Escribe el nombre de la película (y el año, si lo sabes) que te gustaría que agreguemos. Leemos todas las sugerencias.</p>
              <form
                className="flex w-full flex-wrap items-center gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  suggest()
                }}
              >
                <label htmlFor="kp-suggest" className="sr-only">
                  Película que quieres que agreguemos
                </label>
                <input
                  id="kp-suggest"
                  data-nav
                  value={idea}
                  onChange={(e) => {
                    setIdea(e.target.value)
                    if (ideaState !== 'sending') setIdeaState('idle')
                  }}
                  placeholder="Ej.: Interestelar (2014)"
                  maxLength={SUGGESTION_MAX}
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-full bg-white/10 px-4 py-3 text-white placeholder-white/30 outline-none focus:ring-4 focus:ring-pulse-cyan"
                />
                <button data-nav type="submit" className="kp-btn kp-btn-primary" disabled={idea.trim().length < 2 || ideaState === 'sending'}>
                  {ideaState === 'sending' ? 'Enviando…' : 'Enviar sugerencia'}
                </button>
              </form>
              {ideaState === 'sent' && <p className="font-medium text-pulse-cyan">¡Gracias! Recibimos tu sugerencia. Puedes enviar otra cuando quieras.</p>}
              {ideaState === 'failed' && (
                <p className="text-pulse-amber">No se pudo enviar. Revisa tu conexión o inténtalo mañana (hay un límite de 5 sugerencias por día).</p>
              )}
            </section>
          )}

          {syncEnabled() && (
            <section className="kp-panel md:col-span-2">
              <h2 className="kp-panel-title">🔄 Sincronizar entre dispositivos</h2>
              <p className="text-white/70">
                Sigue en el teléfono la película que dejaste a medias en la tele. Sin cuentas ni correos: un dispositivo crea un código y los demás lo escriben. Se
                comparten «Continuar viendo», «Mi lista» y las películas vistas.
              </p>
              {code ? (
                <>
                  <div className="w-full rounded-xl bg-black/50 p-4">
                    <p className="text-sm text-white/60">Código de este dispositivo</p>
                    <p className="font-mono text-4xl font-black tracking-widest text-pulse-cyan md:text-5xl">{formatCode(code)}</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button data-nav className="kp-btn" onClick={refresh} disabled={busy}>
                      ⟳ Sincronizar ahora
                    </button>
                    <button
                      data-nav
                      className="kp-btn"
                      disabled={busy}
                      onClick={() => {
                        leaveSync()
                        setMessage('Este dispositivo ya no se sincroniza. Lo que tenía guardado se queda aquí.')
                        requestAnimationFrame(focusFirst)
                      }}
                    >
                      Desvincular este dispositivo
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button data-nav className="kp-btn kp-btn-primary" onClick={create} disabled={busy}>
                    Crear un código
                  </button>
                  <form
                    className="flex w-full flex-wrap items-center gap-3"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (draft && !busy) join()
                    }}
                  >
                    <label htmlFor="kp-sync-code" className="text-white/70">
                      ¿Ya tienes uno?
                    </label>
                    <input
                      id="kp-sync-code"
                      data-nav
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="ABCD-2345"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={12}
                      className="w-44 rounded-full bg-white/10 px-4 py-3 font-mono uppercase tracking-widest text-white placeholder-white/30 outline-none focus:ring-4 focus:ring-pulse-cyan"
                    />
                    <button data-nav type="submit" className="kp-btn" disabled={!draft || busy}>
                      Vincular
                    </button>
                  </form>
                </>
              )}
              {busy && <p className="text-white/50">Conectando…</p>}
              {message && !busy && <p className="font-medium text-pulse-cyan">{message}</p>}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
