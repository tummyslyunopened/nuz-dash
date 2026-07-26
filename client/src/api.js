async function handle(res) {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { msg = (await res.json()).error || msg } catch { /* keep status text */ }
    throw new Error(msg)
  }
  return res.json()
}

const jsonHeaders = { 'Content-Type': 'application/json' }

export const api = {
  get: (url) => fetch(url).then(handle),
  post: (url, body) => fetch(url, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) }).then(handle),
  put: (url, body) => fetch(url, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) }).then(handle),
  del: (url) => fetch(url, { method: 'DELETE' }).then(handle)
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
