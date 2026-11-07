// D-Pad spatial navigation engine.
// Any element with [data-nav] is focusable by arrow keys. Elements inside the last-mounted
// [data-nav-scope] are the only candidates, so overlays trap focus. [data-nav-group] marks a
// row: horizontal moves stay inside it and re-entering a row restores its last focused item.

type Dir = 'left' | 'right' | 'up' | 'down'

const KEY_DIR: Record<string, Dir> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
}

const lastInGroup = new Map<string, HTMLElement>()

function scopeRoot(): ParentNode {
  const scopes = document.querySelectorAll<HTMLElement>('[data-nav-scope]')
  return scopes.length ? scopes[scopes.length - 1] : document
}

function candidates(): HTMLElement[] {
  return Array.from(scopeRoot().querySelectorAll<HTMLElement>('[data-nav]')).filter((el) => {
    if ((el as HTMLButtonElement).disabled) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  })
}

const groupOf = (el: Element | null) => el?.closest<HTMLElement>('[data-nav-group]')?.dataset.navGroup

export function focusEl(el: HTMLElement) {
  el.focus({ preventScroll: true })
  if (el.closest('header')) window.scrollTo({ top: 0, behavior: 'smooth' })
  else el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
}

export function focusFirst() {
  const list = candidates()
  const target = list.find((el) => el.hasAttribute('data-nav-autofocus')) ?? list[0]
  if (target) focusEl(target)
}

function move(dir: Dir): boolean {
  const list = candidates()
  const cur = document.activeElement as HTMLElement | null
  if (!cur || !list.includes(cur)) {
    focusFirst()
    return true
  }
  const a = cur.getBoundingClientRect()
  const ax = a.left + a.width / 2
  const ay = a.top + a.height / 2
  const curGroup = groupOf(cur)
  const horizontal = dir === 'left' || dir === 'right'

  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const el of list) {
    if (el === cur) continue
    if (horizontal && curGroup && groupOf(el) !== curGroup) continue
    const b = el.getBoundingClientRect()
    const bx = b.left + b.width / 2
    const by = b.top + b.height / 2
    const primary = dir === 'right' ? b.left - a.right + 1 : dir === 'left' ? a.left - b.right + 1 : dir === 'down' ? b.top - a.bottom + 1 : a.top - b.bottom + 1
    if (primary < -4) continue
    const along = dir === 'right' ? bx - ax : dir === 'left' ? ax - bx : dir === 'down' ? by - ay : ay - by
    if (along <= 0) continue
    const cross = horizontal ? Math.abs(by - ay) : Math.abs(bx - ax)
    // Rows matter more than columns vertically (land on the nearest row), the reverse horizontally.
    const score = Math.max(primary, 0) + cross * (horizontal ? 2 : 0.4)
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }
  if (!best) return false

  // Entering another row: restore that row's remembered item when it is still on screen.
  const g = groupOf(best)
  if (!horizontal && g && g !== curGroup) {
    const remembered = lastInGroup.get(g)
    if (remembered && remembered.isConnected && list.includes(remembered)) best = remembered
  }
  focusEl(best)
  return true
}

export function initSpatialNav(onBack: () => void) {
  const onFocus = (e: FocusEvent) => {
    const el = e.target as HTMLElement
    const g = groupOf(el)
    if (g && el.hasAttribute?.('data-nav')) lastInGroup.set(g, el)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return
    const dir = KEY_DIR[e.key]
    if (dir) {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' && (dir === 'left' || dir === 'right')) return
      if (move(dir)) e.preventDefault()
      return
    }
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'BrowserBack') {
      e.preventDefault()
      onBack()
    }
  }
  window.addEventListener('keydown', onKey)
  document.addEventListener('focusin', onFocus)
  return () => {
    window.removeEventListener('keydown', onKey)
    document.removeEventListener('focusin', onFocus)
  }
}
