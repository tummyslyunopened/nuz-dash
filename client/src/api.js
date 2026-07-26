async function handle(res) {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { msg = (await res.json()).error || msg } catch { /* keep status text */ }
    throw new Error(msg)
  }
  return res.json()
}

// Member token: personal secret from the /m/<token> URL — it IS the auth.
export let memberToken = null
export const setMemberToken = (t) => { memberToken = t || null }
export const authHeaders = () => (memberToken ? { 'X-Member-Token': memberToken } : {})

const jsonHeaders = () => ({ 'Content-Type': 'application/json', ...authHeaders() })

export const api = {
  get: (url) => fetch(url, { headers: authHeaders() }).then(handle),
  post: (url, body) => fetch(url, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(body) }).then(handle),
  put: (url, body) => fetch(url, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(body) }).then(handle),
  del: (url) => fetch(url, { method: 'DELETE', headers: authHeaders() }).then(handle)
}

// Remember lobby links visited on this device (pure convenience, not auth)
export const rememberLink = (token, label) => {
  try {
    const links = JSON.parse(localStorage.getItem('nuz-links') || '[]').filter((l) => l.token !== token)
    links.unshift({ token, label, at: Date.now() })
    localStorage.setItem('nuz-links', JSON.stringify(links.slice(0, 10)))
  } catch { /* private mode etc. */ }
}
export const knownLinks = () => {
  try { return JSON.parse(localStorage.getItem('nuz-links') || '[]') } catch { return [] }
}
export const forgetLink = (token) => {
  try {
    const links = JSON.parse(localStorage.getItem('nuz-links') || '[]').filter((l) => l.token !== token)
    localStorage.setItem('nuz-links', JSON.stringify(links))
  } catch { /* nothing to forget */ }
}

export const spriteUrl = (id, shiny = false) =>
  id ? `/api/sprite/${id}${shiny ? '?shiny=1' : ''}` : null

export const titleCase = (s) =>
  (s || '').split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')

// Encounter statuses: color + icon + label always travel together
// (status is never communicated by color alone).
export const STATUS_META = {
  caught: { label: 'Caught', icon: '●', cls: 'st-caught' },
  killed: { label: 'Killed', icon: '✖', cls: 'st-killed' },
  fled: { label: 'Fled', icon: '→', cls: 'st-fled' },
  missed: { label: 'Missed', icon: '○', cls: 'st-missed' },
  dead: { label: 'Dead', icon: '☠', cls: 'st-dead' }
}

export const encounterState = (enc) =>
  enc.status === 'caught' && !enc.alive ? 'dead' : enc.status

// Aggregate status for a location: a living catch beats everything,
// then a death, then whatever the latest failed encounter was.
export const locationState = (encs) => {
  if (!encs.length) return 'none'
  if (encs.some((e) => e.status === 'caught' && e.alive)) return 'caught'
  if (encs.some((e) => e.status === 'caught' && !e.alive)) return 'dead'
  return encounterState(encs[encs.length - 1])
}
