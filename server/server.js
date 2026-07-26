import express from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { GAMES } from './games.js'
import { Store, dataDir, uploadsDir } from './store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 4517

const lobbies = new Store('lobbies', { lobbies: [] })
const members = new Store('members', { members: [] })
const runs = new Store('runs', { runs: [] }) // a "run" is one attempt by one member
const encounters = new Store('encounters', { encounters: [] })
const diary = new Store('diary', { entries: [] })
const maps = new Store('maps', { maps: {} }) // keyed `${lobbyId}|${gameId}`
const pokecache = new Store('pokecache', { cache: {} })

const romsDir = path.join(dataDir, 'roms')
const statesDir = path.join(dataDir, 'states')
const spritesDir = path.join(dataDir, 'sprites')
const dumpsDir = path.join(dataDir, 'dumps')
for (const d of [romsDir, statesDir, spritesDir, dumpsDir]) fs.mkdirSync(d, { recursive: true })

const token = () => crypto.randomBytes(20).toString('hex')
const now = () => new Date().toISOString()

// ---------- one-time migration from the single-user layout ----------
if (!lobbies.data.lobbies.length && runs.data.runs.some((r) => !r.memberId)) {
  const lobby = { id: crypto.randomUUID(), name: 'Migrated Lobby', inviteToken: token(), roms: [], createdAt: now() }
  const member = { id: crypto.randomUUID(), token: token(), lobbyId: lobby.id, name: 'Runner', createdAt: now() }
  const legacy = runs.data.runs.filter((r) => !r.memberId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  legacy.forEach((run, i) => {
    run.lobbyId = lobby.id
    run.memberId = member.id
    run.attemptNumber = i + 1
    run.status = i === legacy.length - 1 ? 'active' : 'archived'
    run.updatedAt = run.updatedAt || run.createdAt
    if (run.rom?.file) {
      const romEntry = { id: crypto.randomUUID(), name: run.rom.name, file: run.rom.file, core: run.rom.core, size: run.rom.size, uploadedAt: now() }
      lobby.roms.push(romEntry)
      run.romId = romEntry.id
    }
    delete run.rom
  })
  // Re-key per-game maps under the new lobby
  const rekeyed = {}
  for (const [gameId, entry] of Object.entries(maps.data.maps)) {
    rekeyed[gameId.includes('|') ? gameId : `${lobby.id}|${gameId}`] = entry
  }
  maps.data.maps = rekeyed
  lobbies.data.lobbies.push(lobby)
  members.data.members.push(member)
  lobbies.save(); members.save(); runs.save(); maps.save()
  console.log('=== MIGRATED single-user data into a lobby ===')
  console.log(`=== Your personal link: http://localhost:${PORT}/m/${member.token} ===`)
}

const app = express()
app.use(express.json({ limit: '25mb' }))

// ---------- PokeAPI proxy with persistent cache (public) ----------
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

app.get('/api/pokemon-index', asyncRoute(async (req, res) => {
  const data = await pokeFetch('https://pokeapi.co/api/v2/pokemon?limit=20000')
  res.json(data.results.map((p) => ({ name: p.name, id: Number(p.url.replace(/\/$/, '').split('/').pop()) })))
}))

app.get('/api/pokemon/:name', asyncRoute(async (req, res) => {
  const p = await pokeFetch(`https://pokeapi.co/api/v2/pokemon/${req.params.name.toLowerCase()}`)
  res.json({ id: p.id, name: p.name, types: p.types.map((t) => t.type.name), sprite: p.sprites.front_default, speciesName: p.species.name })
}))

app.get('/api/family/:species', asyncRoute(async (req, res) => {
  const species = await pokeFetch(`https://pokeapi.co/api/v2/pokemon-species/${req.params.species.toLowerCase()}`)
  const chainUrl = species.evolution_chain?.url
  if (!chainUrl) return res.json({ chainId: null, members: [species.name] })
  const chain = await pokeFetch(chainUrl)
  const names = []
  const walk = (node) => {
    if (!node) return
    names.push(node.species.name)
    for (const next of node.evolves_to || []) walk(next)
  }
  walk(chain.chain)
  res.json({ chainId: chain.id, members: names })
}))

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

// ---------- Lobby creation & joining (public — the links ARE the auth) ----------
const publicMember = (m) => ({ id: m.id, name: m.name, createdAt: m.createdAt })

app.post('/api/lobbies', (req, res) => {
  const { lobbyName, runnerName } = req.body
  if (!lobbyName?.trim() || !runnerName?.trim()) {
    return res.status(400).json({ error: 'lobbyName and runnerName required' })
  }
  const lobby = { id: crypto.randomUUID(), name: lobbyName.trim(), inviteToken: token(), roms: [], createdAt: now() }
  const member = { id: crypto.randomUUID(), token: token(), lobbyId: lobby.id, name: runnerName.trim(), createdAt: now() }
  lobbies.data.lobbies.push(lobby)
  members.data.members.push(member)
  lobbies.save(); members.save()
  res.json({ memberToken: member.token })
})

app.post('/api/join/:inviteToken', (req, res) => {
  const lobby = lobbies.data.lobbies.find((l) => l.inviteToken === req.params.inviteToken)
  if (!lobby) return res.status(404).json({ error: 'invalid invite link' })
  const name = req.body.name?.trim()
  if (!name) return res.status(400).json({ error: 'name required' })
  const member = { id: crypto.randomUUID(), token: token(), lobbyId: lobby.id, name, createdAt: now() }
  members.data.members.push(member)
  members.save()
  res.json({ memberToken: member.token, lobbyName: lobby.name })
})

app.get('/api/join/:inviteToken', (req, res) => {
  const lobby = lobbies.data.lobbies.find((l) => l.inviteToken === req.params.inviteToken)
  if (!lobby) return res.status(404).json({ error: 'invalid invite link' })
  res.json({ lobbyName: lobby.name })
})

// ---------- Member auth: everything below requires a member token ----------
function requireMember(req, res, next) {
  const t = req.headers['x-member-token'] || req.query.token
  const member = members.data.members.find((m) => m.token === t)
  if (!member) return res.status(401).json({ error: 'invalid or missing member token' })
  req.member = member
  req.lobby = lobbies.data.lobbies.find((l) => l.id === member.lobbyId)
  if (!req.lobby) return res.status(401).json({ error: 'lobby no longer exists' })
  next()
}
app.use('/api', (req, res, next) => {
  // public routes already handled above; everything else on /api needs a member
  requireMember(req, res, next)
})

const lobbyRom = (lobby, romId) => lobby.roms.find((r) => r.id === romId)
const serializeRun = (run, lobby) => {
  const rom = run.romId ? lobbyRom(lobby, run.romId) : null
  return { ...run, rom: rom ? { name: rom.name, core: rom.core, size: rom.size } : null }
}
const findRun = (req, id) => {
  const run = runs.data.runs.find((r) => r.id === id)
  return run && run.lobbyId === req.member.lobbyId ? run : null
}
const ownRun = (req, id) => {
  const run = findRun(req, id)
  return run && run.memberId === req.member.id ? run : null
}
const touchRun = (id) => {
  const run = runs.data.runs.find((r) => r.id === id)
  if (run) { run.updatedAt = now(); runs.save() }
}
const runStats = (run) => {
  const encs = encounters.data.encounters.filter((e) => e.runId === run.id)
  return {
    alive: encs.filter((e) => e.status === 'caught' && e.alive).length,
    deaths: encs.filter((e) => e.status === 'caught' && !e.alive).length,
    caught: encs.filter((e) => e.status === 'caught').length,
    encounters: encs.length
  }
}

app.get('/api/me', (req, res) => {
  res.json({
    member: publicMember(req.member),
    lobby: {
      id: req.lobby.id,
      name: req.lobby.name,
      inviteToken: req.lobby.inviteToken,
      roms: req.lobby.roms.map((r) => ({ id: r.id, name: r.name, core: r.core, size: r.size }))
    },
    members: members.data.members.filter((m) => m.lobbyId === req.lobby.id).map(publicMember)
  })
})

// Latest emulator frame per member, memory-only (never persisted)
const streams = new Map() // memberId -> { buf, at }
const STREAM_FRESH_MS = 8000

app.get('/api/lobby/summary', (req, res) => {
  const out = members.data.members
    .filter((m) => m.lobbyId === req.lobby.id)
    .map((m) => {
      const own = runs.data.runs.filter((r) => r.memberId === m.id)
      const active = own.find((r) => r.status === 'active')
      const frame = streams.get(m.id)
      return {
        member: publicMember(m),
        live: !!frame && Date.now() - frame.at < STREAM_FRESH_MS,
        attempts: own.length,
        active: active ? {
          runId: active.id,
          attemptNumber: active.attemptNumber,
          name: active.name,
          gameName: active.gameName,
          badges: active.badges,
          updatedAt: active.updatedAt || active.createdAt,
          rules: active.rules,
          ...runStats(active)
        } : null
      }
    })
  res.json(out)
})

// ---------- Lobby ROM library ----------
const ROM_CORES = { gb: 'gb', gbc: 'gb', sgb: 'gb', gba: 'gba', nds: 'nds' }

function addRomToLobby(lobby, filename, body) {
  const ext = filename.split('.').pop().toLowerCase()
  const core = ROM_CORES[ext]
  if (!core) throw Object.assign(new Error(`Unsupported ROM type ".${ext}" — use .gb, .gbc, .gba or .nds (unzipped).`), { status: 400 })
  const id = crypto.randomUUID()
  const file = `${lobby.id}-${id}.${ext}`
  fs.writeFileSync(path.join(romsDir, file), body)
  const entry = { id, name: filename, file, core, size: body.length, uploadedAt: now() }
  lobby.roms.push(entry)
  lobbies.save()
  return entry
}

app.post('/api/lobby/roms', express.raw({ type: 'application/octet-stream', limit: '512mb' }), (req, res) => {
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty upload' })
  try {
    const entry = addRomToLobby(req.lobby, String(req.query.filename || 'game.gba'), req.body)
    res.json({ id: entry.id, name: entry.name, core: entry.core, size: entry.size })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

app.get('/api/lobby/roms/:romId', (req, res) => {
  const rom = lobbyRom(req.lobby, req.params.romId)
  if (!rom) return res.status(404).json({ error: 'rom not found' })
  res.sendFile(path.join(romsDir, rom.file))
})

// ---------- Runs (attempts) ----------
app.get('/api/runs', (req, res) => {
  const memberId = !req.query.memberId || req.query.memberId === 'me' ? req.member.id : req.query.memberId
  const target = members.data.members.find((m) => m.id === memberId && m.lobbyId === req.lobby.id)
  if (!target) return res.status(404).json({ error: 'no such runner in this lobby' })
  const own = runs.data.runs
    .filter((r) => r.memberId === memberId)
    .sort((a, b) => (b.attemptNumber || 0) - (a.attemptNumber || 0))
    .map((r) => ({ ...serializeRun(r, req.lobby), ...runStats(r) }))
  res.json(own)
})

app.post('/api/runs', (req, res) => {
  const { name, gameId, romId, rules } = req.body
  const game = GAMES.find((g) => g.id === gameId)
  if (!game) return res.status(400).json({ error: 'valid gameId required' })
  if (romId && !lobbyRom(req.lobby, romId)) return res.status(400).json({ error: 'unknown romId' })
  const own = runs.data.runs.filter((r) => r.memberId === req.member.id)
  for (const r of own) {
    if (r.status === 'active') { r.status = 'archived'; r.endedAt = now() }
  }
  const attemptNumber = own.reduce((mx, r) => Math.max(mx, r.attemptNumber || 0), 0) + 1
  const run = {
    id: crypto.randomUUID(),
    lobbyId: req.lobby.id,
    memberId: req.member.id,
    attemptNumber,
    status: 'active',
    name: name?.trim() || `Attempt ${attemptNumber}`,
    gameId,
    gameName: game.name,
    romId: romId || null,
    rules: {
      dupesClause: rules?.dupesClause ?? true,
      shinyClause: rules?.shinyClause ?? true,
      hardcore: rules?.hardcore ?? false
    },
    badges: 0,
    caps: structuredClone(game.caps),
    createdAt: now(),
    updatedAt: now()
  }
  runs.data.runs.unshift(run)
  runs.save()
  res.json(serializeRun(run, req.lobby))
})

app.get('/api/runs/:id', (req, res) => {
  const run = findRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found' })
  res.json(serializeRun(run, req.lobby))
})

app.put('/api/runs/:id', (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  const { name, rules, badges, caps, romId, status } = req.body
  if (name !== undefined) run.name = name
  if (rules !== undefined) run.rules = { ...run.rules, ...rules }
  if (badges !== undefined) run.badges = Math.max(0, Math.min(Number(badges) || 0, run.caps.length))
  if (caps !== undefined) run.caps = caps
  if (romId !== undefined) {
    if (romId && !lobbyRom(req.lobby, romId)) return res.status(400).json({ error: 'unknown romId' })
    run.romId = romId || null
  }
  if (status === 'archived' && run.status === 'active') { run.status = 'archived'; run.endedAt = now() }
  run.updatedAt = now()
  runs.save()
  res.json(serializeRun(run, req.lobby))
})

app.delete('/api/runs/:id', (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  for (const slot of ['1', '2', '3']) {
    try { fs.unlinkSync(path.join(statesDir, `${run.id}-${slot}.state`)) } catch { /* empty */ }
  }
  runs.data.runs = runs.data.runs.filter((r) => r.id !== run.id)
  encounters.data.encounters = encounters.data.encounters.filter((e) => e.runId !== run.id)
  diary.data.entries = diary.data.entries.filter((d) => d.runId !== run.id)
  runs.save(); encounters.save(); diary.save()
  res.json({ ok: true })
})

// ---------- Per-run ROM convenience (uploads land in the lobby library) ----------
app.post('/api/runs/:id/rom', express.raw({ type: 'application/octet-stream', limit: '512mb' }), (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty upload' })
  try {
    const entry = addRomToLobby(req.lobby, String(req.query.filename || 'game.gba'), req.body)
    run.romId = entry.id
    run.updatedAt = now()
    runs.save()
    res.json(serializeRun(run, req.lobby))
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

app.get('/api/runs/:id/rom', (req, res) => {
  const run = findRun(req, req.params.id)
  const rom = run?.romId ? lobbyRom(req.lobby, run.romId) : null
  if (!rom) return res.status(404).json({ error: 'no rom linked' })
  res.sendFile(path.join(romsDir, rom.file))
})

app.delete('/api/runs/:id/rom', (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  run.romId = null
  run.updatedAt = now()
  runs.save()
  res.json(serializeRun(run, req.lobby))
})

// ---------- Encounters ----------
app.get('/api/runs/:id/encounters', (req, res) => {
  if (!findRun(req, req.params.id)) return res.status(404).json({ error: 'not found' })
  res.json(encounters.data.encounters.filter((e) => e.runId === req.params.id))
})

app.post('/api/runs/:id/encounters', (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  const { location, speciesName, speciesId, chainId, status, nickname, level, shiny } = req.body
  if (!location || !speciesName || !status) {
    return res.status(400).json({ error: 'location, speciesName, status required' })
  }
  const enc = {
    id: crypto.randomUUID(),
    runId: run.id,
    location,
    speciesName,
    speciesId: speciesId ?? null,
    chainId: chainId ?? null,
    status,
    nickname: nickname || '',
    level: level ?? null,
    shiny: !!shiny,
    alive: status === 'caught',
    deathNote: '',
    createdAt: now()
  }
  encounters.data.encounters.push(enc)
  encounters.save()
  touchRun(run.id)
  res.json(enc)
})

app.put('/api/encounters/:id', (req, res) => {
  const enc = encounters.data.encounters.find((e) => e.id === req.params.id)
  const run = enc && ownRun(req, enc.runId)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  const editable = ['location', 'speciesName', 'speciesId', 'chainId', 'status', 'nickname', 'level', 'shiny', 'alive', 'deathNote']
  for (const key of editable) {
    if (req.body[key] !== undefined) enc[key] = req.body[key]
  }
  if (req.body.status && req.body.status !== 'caught') enc.alive = false
  encounters.save()
  touchRun(run.id)
  res.json(enc)
})

app.delete('/api/encounters/:id', (req, res) => {
  const enc = encounters.data.encounters.find((e) => e.id === req.params.id)
  const run = enc && ownRun(req, enc.runId)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  encounters.data.encounters = encounters.data.encounters.filter((e) => e.id !== enc.id)
  encounters.save()
  touchRun(run.id)
  res.json({ ok: true })
})

// ---------- Diary ----------
app.get('/api/runs/:id/diary', (req, res) => {
  if (!findRun(req, req.params.id)) return res.status(404).json({ error: 'not found' })
  res.json(diary.data.entries.filter((d) => d.runId === req.params.id))
})

app.post('/api/runs/:id/diary', (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  if (!req.body.text) return res.status(400).json({ error: 'text required' })
  const entry = {
    id: crypto.randomUUID(),
    runId: run.id,
    text: req.body.text,
    location: req.body.location || '',
    createdAt: now()
  }
  diary.data.entries.unshift(entry)
  diary.save()
  touchRun(run.id)
  res.json(entry)
})

app.put('/api/diary/:id', (req, res) => {
  const entry = diary.data.entries.find((d) => d.id === req.params.id)
  const run = entry && ownRun(req, entry.runId)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  if (req.body.text !== undefined) entry.text = req.body.text
  if (req.body.location !== undefined) entry.location = req.body.location
  diary.save()
  res.json(entry)
})

app.delete('/api/diary/:id', (req, res) => {
  const entry = diary.data.entries.find((d) => d.id === req.params.id)
  const run = entry && ownRun(req, entry.runId)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  diary.data.entries = diary.data.entries.filter((d) => d.id !== entry.id)
  diary.save()
  res.json({ ok: true })
})

// ---------- Maps (per lobby + game, shared by all members) ----------
const mapEntry = (lobbyId, gameId) => {
  const key = `${lobbyId}|${gameId}`
  const entry = maps.data.maps[key] || { image: null, pins: {}, nodes: {} }
  entry.pins = entry.pins || {}
  entry.nodes = entry.nodes || {}
  maps.data.maps[key] = entry
  return entry
}

app.get('/api/maps/:gameId', (req, res) => {
  res.json(mapEntry(req.member.lobbyId, req.params.gameId))
})

app.post('/api/maps/:gameId/image', (req, res) => {
  const match = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(req.body.dataUrl || '')
  if (!match) return res.status(400).json({ error: 'dataUrl must be a base64 png/jpeg/webp/gif' })
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
  const filename = `${req.member.lobbyId}-${req.params.gameId}-${crypto.randomUUID().slice(0, 8)}.${ext}`
  fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(match[2], 'base64'))
  const entry = mapEntry(req.member.lobbyId, req.params.gameId)
  entry.image = `/uploads/${filename}`
  maps.save()
  res.json(entry)
})

app.put('/api/maps/:gameId/pins', (req, res) => {
  const entry = mapEntry(req.member.lobbyId, req.params.gameId)
  entry.pins = req.body.pins || {}
  maps.save()
  res.json(entry)
})

app.put('/api/maps/:gameId/nodes', (req, res) => {
  const entry = mapEntry(req.member.lobbyId, req.params.gameId)
  entry.nodes = req.body.nodes || {}
  maps.save()
  res.json(entry)
})

// ---------- Save states (per attempt, 3 slots) ----------
const STATE_SLOTS = ['1', '2', '3']

app.post('/api/runs/:id/states/:slot', express.raw({ type: 'application/octet-stream', limit: '64mb' }), (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  if (!STATE_SLOTS.includes(req.params.slot)) return res.status(400).json({ error: 'slot must be 1-3' })
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty state' })
  fs.writeFileSync(path.join(statesDir, `${run.id}-${req.params.slot}.state`), req.body)
  run.states = run.states || {}
  run.states[req.params.slot] = { savedAt: now(), size: req.body.length }
  run.updatedAt = now()
  runs.save()
  res.json(serializeRun(run, req.lobby))
})

app.get('/api/runs/:id/states/:slot', (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  const file = path.join(statesDir, `${run.id}-${req.params.slot}.state`)
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'slot empty' })
  res.sendFile(file)
})

// ---------- Live game streaming (watch party) ----------
app.post('/api/stream', express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: '2mb' }), (req, res) => {
  if (req.body && req.body.length) {
    streams.set(req.member.id, { buf: req.body, at: Date.now() })
  }
  res.json({ ok: true })
})

app.get('/api/stream/:memberId', (req, res) => {
  const target = members.data.members.find((m) => m.id === req.params.memberId && m.lobbyId === req.lobby.id)
  const frame = target && streams.get(target.id)
  if (!frame || Date.now() - frame.at > 15000) return res.status(404).end()
  res.set('Content-Type', 'image/jpeg')
  res.set('Cache-Control', 'no-store')
  res.send(frame.buf)
})

// ---------- Bug reports ----------
const bugsDir = path.join(dataDir, 'bugreports')
fs.mkdirSync(bugsDir, { recursive: true })

app.post('/api/bug-report', (req, res) => {
  const report = {
    description: String(req.body.description || '').slice(0, 5000),
    diagnostics: req.body.diagnostics || {},
    reporter: publicMember(req.member),
    lobby: { id: req.lobby.id, name: req.lobby.name },
    serverTime: now()
  }
  const file = `bug-${now().replace(/[:.]/g, '-')}.json`
  fs.writeFileSync(path.join(bugsDir, file), JSON.stringify(report, null, 2))
  res.json({ file: `server/data/bugreports/${file}` })
})

// ---------- Debug: emulator heap dumps ----------
app.post('/api/debug/heapdump', express.raw({ type: 'application/octet-stream', limit: '768mb' }), (req, res) => {
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty dump' })
  const stamp = now().replace(/[:.]/g, '-')
  const binFile = `heap-${stamp}.bin`
  fs.writeFileSync(path.join(dumpsDir, binFile), req.body)
  let meta = {}
  try { meta = JSON.parse(decodeURIComponent(req.headers['x-dump-meta'] || '%7B%7D')) } catch { /* optional */ }
  meta.size = req.body.length
  meta.file = binFile
  fs.writeFileSync(path.join(dumpsDir, `heap-${stamp}.json`), JSON.stringify(meta, null, 2))
  res.json({ file: `server/data/dumps/${binFile}`, size: req.body.length })
})

// ---------- Static ----------
app.use('/uploads', express.static(uploadsDir))

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
