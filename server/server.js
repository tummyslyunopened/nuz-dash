import express from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { GAMES } from './games.js'
import { Store, dataDir, uploadsDir } from './store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 4517

const runs = new Store('runs', { runs: [] })
const encounters = new Store('encounters', { encounters: [] })
const diary = new Store('diary', { entries: [] })
const maps = new Store('maps', { maps: {} }) // keyed by gameId: { image, pins: { location: {x,y} } }
const pokecache = new Store('pokecache', { cache: {} })

const app = express()
app.use(express.json({ limit: '25mb' }))

// ---------- PokeAPI proxy with persistent cache ----------
async function pokeFetch(url) {
  const hit = pokecache.data.cache[url]
  if (hit) return hit
  const res = await fetch(url)
  if (!res.ok) throw new Error(`PokeAPI ${res.status} for ${url}`)
  const json = await res.json()
  pokecache.data.cache[url] = json
  pokecache.save()
  return json
}

const asyncRoute = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err)
  res.status(502).json({ error: String(err.message || err) })
})

app.get('/api/games', (req, res) => res.json(GAMES))

// Slim index of every pokemon for autocomplete: [{ name, id }]
app.get('/api/pokemon-index', asyncRoute(async (req, res) => {
  const data = await pokeFetch('https://pokeapi.co/api/v2/pokemon?limit=20000')
  const index = data.results.map((p) => {
    const id = Number(p.url.replace(/\/$/, '').split('/').pop())
    return { name: p.name, id }
  })
  res.json(index)
}))

app.get('/api/pokemon/:name', asyncRoute(async (req, res) => {
  const p = await pokeFetch(`https://pokeapi.co/api/v2/pokemon/${req.params.name.toLowerCase()}`)
  res.json({
    id: p.id,
    name: p.name,
    types: p.types.map((t) => t.type.name),
    sprite: p.sprites.front_default,
    speciesName: p.species.name
  })
}))

// Evolution family for dupes-clause checks: { chainId, members: [species names] }
app.get('/api/family/:species', asyncRoute(async (req, res) => {
  const species = await pokeFetch(`https://pokeapi.co/api/v2/pokemon-species/${req.params.species.toLowerCase()}`)
  const chainUrl = species.evolution_chain?.url
  if (!chainUrl) return res.json({ chainId: null, members: [species.name] })
  const chain = await pokeFetch(chainUrl)
  const members = []
  const walk = (node) => {
    if (!node) return
    members.push(node.species.name)
    for (const next of node.evolves_to || []) walk(next)
  }
  walk(chain.chain)
  res.json({ chainId: chain.id, members })
}))

// Location name list for a game's region(s), for autocomplete
app.get('/api/locations/:gameId', asyncRoute(async (req, res) => {
  const game = GAMES.find((g) => g.id === req.params.gameId)
  if (!game) return res.status(404).json({ error: 'unknown game' })
  const names = []
  for (const region of game.regions) {
    const data = await pokeFetch(`https://pokeapi.co/api/v2/region/${region}`)
    for (const loc of data.locations) {
      names.push(loc.name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '))
    }
  }
  res.json([...new Set(names)].sort())
}))

// Sprite proxy with disk cache — keeps thumbnails working offline and
// independent of raw.githubusercontent availability.
const spritesDir = path.join(dataDir, 'sprites')
fs.mkdirSync(spritesDir, { recursive: true })

app.get('/api/sprite/:id', asyncRoute(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10)
  if (!Number.isFinite(id) || id < 1 || id > 100000) return res.status(404).end()
  const shiny = req.query.shiny === '1'
  const file = path.join(spritesDir, `${id}${shiny ? '-s' : ''}.png`)
  if (!fs.existsSync(file)) {
    const url = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${shiny ? 'shiny/' : ''}${id}.png`
    const r = await fetch(url)
    if (!r.ok) return res.status(404).end()
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()))
  }
  res.sendFile(file)
}))

// ---------- Runs ----------
app.get('/api/runs', (req, res) => res.json(runs.data.runs))

app.post('/api/runs', (req, res) => {
  const { name, gameId, rules } = req.body
  const game = GAMES.find((g) => g.id === gameId)
  if (!game || !name) return res.status(400).json({ error: 'name and valid gameId required' })
  const run = {
    id: crypto.randomUUID(),
    name,
    gameId,
    gameName: game.name,
    rules: {
      dupesClause: rules?.dupesClause ?? true,
      shinyClause: rules?.shinyClause ?? true,
      hardcore: rules?.hardcore ?? false
    },
    badges: 0,
    caps: structuredClone(game.caps),
    createdAt: new Date().toISOString()
  }
  runs.data.runs.unshift(run)
  runs.save()
  res.json(run)
})

app.get('/api/runs/:id', (req, res) => {
  const run = runs.data.runs.find((r) => r.id === req.params.id)
  if (!run) return res.status(404).json({ error: 'not found' })
  res.json(run)
})

app.put('/api/runs/:id', (req, res) => {
  const run = runs.data.runs.find((r) => r.id === req.params.id)
  if (!run) return res.status(404).json({ error: 'not found' })
  const { name, rules, badges, caps } = req.body
  if (name !== undefined) run.name = name
  if (rules !== undefined) run.rules = { ...run.rules, ...rules }
  if (badges !== undefined) run.badges = Math.max(0, Math.min(Number(badges) || 0, run.caps.length))
  if (caps !== undefined) run.caps = caps
  runs.save()
  res.json(run)
})

app.delete('/api/runs/:id', (req, res) => {
  const doomed = runs.data.runs.find((r) => r.id === req.params.id)
  if (doomed?.rom?.file) {
    try { fs.unlinkSync(path.join(dataDir, 'roms', doomed.rom.file)) } catch { /* already gone */ }
  }
  for (const slot of ['1', '2', '3']) {
    try { fs.unlinkSync(path.join(dataDir, 'states', `${req.params.id}-${slot}.state`)) } catch { /* empty slot */ }
  }
  runs.data.runs = runs.data.runs.filter((r) => r.id !== req.params.id)
  encounters.data.encounters = encounters.data.encounters.filter((e) => e.runId !== req.params.id)
  diary.data.entries = diary.data.entries.filter((d) => d.runId !== req.params.id)
  runs.save(); encounters.save(); diary.save()
  res.json({ ok: true })
})

// ---------- Encounters ----------
app.get('/api/runs/:id/encounters', (req, res) => {
  res.json(encounters.data.encounters.filter((e) => e.runId === req.params.id))
})

app.post('/api/runs/:id/encounters', (req, res) => {
  const { location, speciesName, speciesId, chainId, status, nickname, level, shiny } = req.body
  if (!location || !speciesName || !status) {
    return res.status(400).json({ error: 'location, speciesName, status required' })
  }
  const enc = {
    id: crypto.randomUUID(),
    runId: req.params.id,
    location,
    speciesName,
    speciesId: speciesId ?? null,
    chainId: chainId ?? null,
    status, // caught | killed | fled | missed
    nickname: nickname || '',
    level: level ?? null,
    shiny: !!shiny,
    alive: status === 'caught',
    deathNote: '',
    createdAt: new Date().toISOString()
  }
  encounters.data.encounters.push(enc)
  encounters.save()
  res.json(enc)
})

app.put('/api/encounters/:id', (req, res) => {
  const enc = encounters.data.encounters.find((e) => e.id === req.params.id)
  if (!enc) return res.status(404).json({ error: 'not found' })
  const editable = ['location', 'speciesName', 'speciesId', 'chainId', 'status', 'nickname', 'level', 'shiny', 'alive', 'deathNote']
  for (const key of editable) {
    if (req.body[key] !== undefined) enc[key] = req.body[key]
  }
  if (req.body.status && req.body.status !== 'caught') enc.alive = false
  encounters.save()
  res.json(enc)
})

app.delete('/api/encounters/:id', (req, res) => {
  encounters.data.encounters = encounters.data.encounters.filter((e) => e.id !== req.params.id)
  encounters.save()
  res.json({ ok: true })
})

// ---------- Diary ----------
app.get('/api/runs/:id/diary', (req, res) => {
  res.json(diary.data.entries.filter((d) => d.runId === req.params.id))
})

app.post('/api/runs/:id/diary', (req, res) => {
  const { text, location } = req.body
  if (!text) return res.status(400).json({ error: 'text required' })
  const entry = {
    id: crypto.randomUUID(),
    runId: req.params.id,
    text,
    location: location || '',
    createdAt: new Date().toISOString()
  }
  diary.data.entries.unshift(entry)
  diary.save()
  res.json(entry)
})

app.put('/api/diary/:id', (req, res) => {
  const entry = diary.data.entries.find((d) => d.id === req.params.id)
  if (!entry) return res.status(404).json({ error: 'not found' })
  if (req.body.text !== undefined) entry.text = req.body.text
  if (req.body.location !== undefined) entry.location = req.body.location
  diary.save()
  res.json(entry)
})

app.delete('/api/diary/:id', (req, res) => {
  diary.data.entries = diary.data.entries.filter((d) => d.id !== req.params.id)
  diary.save()
  res.json({ ok: true })
})

// ---------- Maps (one per game, reused across runs) ----------
// `pins` position locations on an uploaded image (fractional coords);
// `nodes` position locations on the built-in route map (viewBox coords).
const mapEntry = (gameId) => {
  const entry = maps.data.maps[gameId] || { image: null, pins: {}, nodes: {} }
  entry.pins = entry.pins || {}
  entry.nodes = entry.nodes || {}
  maps.data.maps[gameId] = entry
  return entry
}

app.get('/api/maps/:gameId', (req, res) => {
  res.json(mapEntry(req.params.gameId))
})

app.post('/api/maps/:gameId/image', (req, res) => {
  const { dataUrl } = req.body
  const match = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(dataUrl || '')
  if (!match) return res.status(400).json({ error: 'dataUrl must be a base64 png/jpeg/webp/gif' })
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
  const filename = `${req.params.gameId}-${crypto.randomUUID().slice(0, 8)}.${ext}`
  fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(match[2], 'base64'))
  const entry = mapEntry(req.params.gameId)
  entry.image = `/uploads/${filename}`
  maps.save()
  res.json(entry)
})

app.put('/api/maps/:gameId/pins', (req, res) => {
  const entry = mapEntry(req.params.gameId)
  entry.pins = req.body.pins || {}
  maps.save()
  res.json(entry)
})

app.put('/api/maps/:gameId/nodes', (req, res) => {
  const entry = mapEntry(req.params.gameId)
  entry.nodes = req.body.nodes || {}
  maps.save()
  res.json(entry)
})

// ---------- ROMs (user-supplied, one per run) ----------
// Raw binary upload: body is the ROM itself, filename passed as a query param.
const romsDir = path.join(dataDir, 'roms')
fs.mkdirSync(romsDir, { recursive: true })

const ROM_CORES = { gb: 'gb', gbc: 'gb', sgb: 'gb', gba: 'gba', nds: 'nds' }

app.post(
  '/api/runs/:id/rom',
  express.raw({ type: 'application/octet-stream', limit: '512mb' }),
  (req, res) => {
    const run = runs.data.runs.find((r) => r.id === req.params.id)
    if (!run) return res.status(404).json({ error: 'not found' })
    const original = String(req.query.filename || 'game.gba')
    const ext = original.split('.').pop().toLowerCase()
    const core = ROM_CORES[ext]
    if (!core) {
      return res.status(400).json({ error: `Unsupported ROM type ".${ext}" — use .gb, .gbc, .gba or .nds (unzipped).` })
    }
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty upload' })
    if (run.rom?.file) {
      try { fs.unlinkSync(path.join(romsDir, run.rom.file)) } catch { /* already gone */ }
    }
    const file = `${run.id}.${ext}`
    fs.writeFileSync(path.join(romsDir, file), req.body)
    run.rom = { name: original, file, core, size: req.body.length }
    runs.save()
    res.json(run)
  }
)

app.get('/api/runs/:id/rom', (req, res) => {
  const run = runs.data.runs.find((r) => r.id === req.params.id)
  if (!run?.rom?.file) return res.status(404).json({ error: 'no rom uploaded' })
  res.sendFile(path.join(romsDir, run.rom.file))
})

app.delete('/api/runs/:id/rom', (req, res) => {
  const run = runs.data.runs.find((r) => r.id === req.params.id)
  if (!run) return res.status(404).json({ error: 'not found' })
  if (run.rom?.file) {
    try { fs.unlinkSync(path.join(romsDir, run.rom.file)) } catch { /* already gone */ }
  }
  delete run.rom
  runs.save()
  res.json(run)
})

// ---------- Save states (per run, 3 slots, stored server-side) ----------
const statesDir = path.join(dataDir, 'states')
fs.mkdirSync(statesDir, { recursive: true })
const STATE_SLOTS = ['1', '2', '3']

app.post(
  '/api/runs/:id/states/:slot',
  express.raw({ type: 'application/octet-stream', limit: '64mb' }),
  (req, res) => {
    const run = runs.data.runs.find((r) => r.id === req.params.id)
    if (!run) return res.status(404).json({ error: 'not found' })
    if (!STATE_SLOTS.includes(req.params.slot)) return res.status(400).json({ error: 'slot must be 1-3' })
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty state' })
    fs.writeFileSync(path.join(statesDir, `${run.id}-${req.params.slot}.state`), req.body)
    run.states = run.states || {}
    run.states[req.params.slot] = { savedAt: new Date().toISOString(), size: req.body.length }
    runs.save()
    res.json(run)
  }
)

app.get('/api/runs/:id/states/:slot', (req, res) => {
  const file = path.join(statesDir, `${req.params.id}-${req.params.slot}.state`)
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'slot empty' })
  res.sendFile(file)
})

// ---------- Debug: emulator heap dumps for offline analysis ----------
const dumpsDir = path.join(dataDir, 'dumps')
fs.mkdirSync(dumpsDir, { recursive: true })

app.post(
  '/api/debug/heapdump',
  express.raw({ type: 'application/octet-stream', limit: '768mb' }),
  (req, res) => {
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty dump' })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const binFile = `heap-${stamp}.bin`
    fs.writeFileSync(path.join(dumpsDir, binFile), req.body)
    let meta = {}
    try { meta = JSON.parse(decodeURIComponent(req.headers['x-dump-meta'] || '%7B%7D')) } catch { /* optional */ }
    meta.size = req.body.length
    meta.file = binFile
    fs.writeFileSync(path.join(dumpsDir, `heap-${stamp}.json`), JSON.stringify(meta, null, 2))
    res.json({ file: `server/data/dumps/${binFile}`, size: req.body.length })
  }
)

// ---------- Static ----------
app.use('/uploads', express.static(uploadsDir))

// Self-hosted EmulatorJS runtime + GB/GBA/NDS cores (vendored from the
// EmulatorJS v4.2.3 release — see README "Emulator" section)
const emulatorDataDir = path.join(__dirname, 'emulatorjs-data')
if (fs.existsSync(emulatorDataDir)) {
  app.use('/emulatorjs', express.static(emulatorDataDir))
}

const distDir = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^\/(?!api|uploads|emulatorjs).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`nuz-dash server running at http://localhost:${PORT}`)
})
