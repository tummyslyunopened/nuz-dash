import express from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import os from 'os'
import { spawn, execFileSync } from 'child_process'
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
const settings = new Store('settings', { settings: { autoTunnel: false } })
// Tunnel settings gained fields over time — fill in defaults for older files.
settings.data.settings = {
  autoTunnel: false,
  tunnelMode: 'quick', // quick (random trycloudflare URL) | named (your own Cloudflare domain)
  tunnelName: 'nuz-dash',
  tunnelHostname: '',
  ...settings.data.settings
}

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

// Normalize to the one-ROM-per-lobby rule (older lobbies may hold several):
// keep the newest, remap every attempt to it, remove the rest.
let normalized = false
for (const lobby of lobbies.data.lobbies) {
  if ((lobby.roms?.length || 0) > 1) {
    const keep = lobby.roms[lobby.roms.length - 1]
    for (const rom of lobby.roms) {
      if (rom.id !== keep.id) {
        try { fs.unlinkSync(path.join(romsDir, rom.file)) } catch { /* already gone */ }
      }
    }
    lobby.roms = [keep]
    for (const run of runs.data.runs) {
      if (run.lobbyId === lobby.id && run.romId) run.romId = keep.id
    }
    normalized = true
    console.log(`=== Lobby "${lobby.name}" normalized to single ROM: ${keep.name} ===`)
  }
}
if (normalized) { lobbies.save(); runs.save() }

// ---------- Cloudflare tunnel manager ----------
// The server owns the tunnel process so it always knows the current public
// URL — which the client uses when copying invite/personal links.
const tunnel = { proc: null, url: null, status: 'stopped', startedAt: null, log: [] }

function cloudflaredPath() {
  if (process.env.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH
  const local = path.join(__dirname, '..', 'tools', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
  return fs.existsSync(local) ? local : 'cloudflared'
}

const certPath = path.join(os.homedir(), '.cloudflared', 'cert.pem')
const hasCert = () => fs.existsSync(certPath)

function startTunnel() {
  if (tunnel.proc) return
  const cfg = settings.data.settings
  const named = cfg.tunnelMode === 'named' && cfg.tunnelName && cfg.tunnelHostname
  const args = named
    ? ['tunnel', 'run', '--url', `http://localhost:${PORT}`, cfg.tunnelName]
    : ['tunnel', '--url', `http://localhost:${PORT}`]
  let proc
  try {
    proc = spawn(cloudflaredPath(), args, { windowsHide: true })
  } catch (err) {
    tunnel.status = `error: ${err.message}`
    return
  }
  tunnel.proc = proc
  tunnel.url = null
  tunnel.status = 'starting'
  tunnel.startedAt = now()
  tunnel.log = []
  const onData = (buf) => {
    for (const line of buf.toString().split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      tunnel.log.push(trimmed.slice(0, 300))
      if (tunnel.log.length > 60) tunnel.log.shift()
      if (named) {
        if (trimmed.includes('Registered tunnel connection')) {
          tunnel.url = `https://${cfg.tunnelHostname}`
          tunnel.status = 'running'
        }
      } else {
        const m = trimmed.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
        if (m) { tunnel.url = m[0]; tunnel.status = 'running' }
      }
    }
  }
  proc.stdout.on('data', onData)
  proc.stderr.on('data', onData)
  proc.on('error', (err) => { tunnel.status = `error: ${err.message}`; tunnel.proc = null })
  proc.on('exit', () => {
    tunnel.proc = null
    tunnel.url = null
    if (!tunnel.status.startsWith('error')) tunnel.status = 'stopped'
  })
}

function stopTunnel() {
  if (tunnel.proc) tunnel.proc.kill()
  tunnel.status = 'stopped'
  tunnel.url = null
}

if (settings.data.settings.autoTunnel) startTunnel()

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

// Link recovery: any lobby member can mint a NEW secret link for a runner who
// lost theirs. The old link stops working immediately; progress is untouched
// since it hangs off the member id, not the token.
app.post('/api/members/:memberId/regenerate-link', (req, res) => {
  const target = members.data.members.find((m) => m.id === req.params.memberId && m.lobbyId === req.lobby.id)
  if (!target) return res.status(404).json({ error: 'no such runner in this lobby' })
  target.token = token()
  members.save()
  res.json({ memberId: target.id, name: target.name, memberToken: target.token })
})

app.put('/api/me/controls', (req, res) => {
  req.member.controls = req.body.controls || null
  members.save()
  res.json({ ok: true })
})

app.get('/api/me', (req, res) => {
  res.json({
    publicUrl: tunnel.url, // preferred origin for shareable links
    member: { ...publicMember(req.member), controls: req.member.controls || null },
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

// One ROM per lobby: uploading again replaces it in place, keeping the same
// entry id so every attempt that references it stays linked.
function addRomToLobby(lobby, filename, body) {
  const ext = filename.split('.').pop().toLowerCase()
  const core = ROM_CORES[ext]
  if (!core) throw Object.assign(new Error(`Unsupported ROM type ".${ext}" — use .gb, .gbc, .gba or .nds (unzipped).`), { status: 400 })
  const existing = lobby.roms[0]
  const id = existing?.id || crypto.randomUUID()
  if (existing?.file) {
    try { fs.unlinkSync(path.join(romsDir, existing.file)) } catch { /* already gone */ }
  }
  const file = `${lobby.id}-${id}.${ext}`
  fs.writeFileSync(path.join(romsDir, file), body)
  const entry = { id, name: filename, file, core, size: body.length, uploadedAt: now() }
  lobby.roms = [entry]
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
  const { name, gameId, rules } = req.body
  const game = GAMES.find((g) => g.id === gameId)
  if (!game) return res.status(400).json({ error: 'valid gameId required' })
  const romId = req.lobby.roms[0]?.id || null // attempts always use the lobby ROM
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
  for (const slot of STATE_SLOTS) {
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

// ---------- Save states (per attempt: 3 manual slots + rolling auto slot) ----------
const STATE_SLOTS = ['1', '2', '3', 'auto']

app.post('/api/runs/:id/states/:slot', express.raw({ type: 'application/octet-stream', limit: '64mb' }), (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  if (!STATE_SLOTS.includes(req.params.slot)) return res.status(400).json({ error: 'slot must be 1-3 or auto' })
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
  app.get(/^\/(?!api|uploads|emulatorjs|admin).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`nuz-dash server running at http://localhost:${PORT}`)
})

// ================= Admin dashboard =========================================
// Separate port, bound to 127.0.0.1 ONLY — never reachable through the
// public tunnel or the LAN. Being on this machine is the admin auth.
const ADMIN_PORT = process.env.ADMIN_PORT || 4518
const adminApp = express()
adminApp.use(express.json())

function deleteRunData(runId) {
  for (const slot of STATE_SLOTS) {
    try { fs.unlinkSync(path.join(statesDir, `${runId}-${slot}.state`)) } catch { /* empty */ }
  }
  encounters.data.encounters = encounters.data.encounters.filter((e) => e.runId !== runId)
  diary.data.entries = diary.data.entries.filter((d) => d.runId !== runId)
}

function deleteMemberCascade(memberId) {
  for (const run of runs.data.runs.filter((r) => r.memberId === memberId)) deleteRunData(run.id)
  runs.data.runs = runs.data.runs.filter((r) => r.memberId !== memberId)
  members.data.members = members.data.members.filter((m) => m.id !== memberId)
  streams.delete(memberId)
}

function deleteLobbyCascade(lobbyId) {
  const lobby = lobbies.data.lobbies.find((l) => l.id === lobbyId)
  if (!lobby) return false
  for (const m of members.data.members.filter((x) => x.lobbyId === lobbyId)) deleteMemberCascade(m.id)
  for (const rom of lobby.roms || []) {
    try { fs.unlinkSync(path.join(romsDir, rom.file)) } catch { /* already gone */ }
  }
  for (const key of Object.keys(maps.data.maps)) {
    if (key.startsWith(`${lobbyId}|`)) delete maps.data.maps[key]
  }
  lobbies.data.lobbies = lobbies.data.lobbies.filter((l) => l.id !== lobbyId)
  return true
}

const saveAll = () => { lobbies.save(); members.save(); runs.save(); encounters.save(); diary.save(); maps.save() }

adminApp.get('/api/tunnel', (req, res) => {
  const cfg = settings.data.settings
  res.json({
    status: tunnel.status,
    url: tunnel.url,
    startedAt: tunnel.startedAt,
    autoTunnel: cfg.autoTunnel,
    mode: cfg.tunnelMode,
    name: cfg.tunnelName,
    hostname: cfg.tunnelHostname,
    hasCert: hasCert(),
    binary: cloudflaredPath(),
    log: tunnel.log.slice(-12)
  })
})

adminApp.post('/api/tunnel/config', (req, res) => {
  const cfg = settings.data.settings
  if (['quick', 'named'].includes(req.body.mode)) cfg.tunnelMode = req.body.mode
  if (typeof req.body.name === 'string') cfg.tunnelName = req.body.name.trim() || 'nuz-dash'
  if (typeof req.body.hostname === 'string') cfg.tunnelHostname = req.body.hostname.trim().replace(/^https?:\/\//, '')
  settings.save()
  res.json({ mode: cfg.tunnelMode, name: cfg.tunnelName, hostname: cfg.tunnelHostname })
})

// Opens the Cloudflare authorization page in the host's browser; the origin
// cert lands in ~/.cloudflared/cert.pem when the user approves.
adminApp.post('/api/tunnel/login', (req, res) => {
  try {
    const proc = spawn(cloudflaredPath(), ['tunnel', 'login'], { windowsHide: true, detached: true, stdio: 'ignore' })
    proc.unref()
    res.json({ ok: true, message: 'A Cloudflare login page should open in a browser on the host — approve it, then refresh.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// One-time named-tunnel setup: create the tunnel and route the hostname's DNS.
adminApp.post('/api/tunnel/setup', (req, res) => {
  const cfg = settings.data.settings
  if (!hasCert()) return res.status(400).json({ error: 'Not logged in to Cloudflare yet — use Login first.' })
  if (!cfg.tunnelName || !cfg.tunnelHostname) return res.status(400).json({ error: 'Set tunnel name and hostname first.' })
  const output = []
  const runCmd = (args, tolerate) => {
    try {
      output.push(`$ cloudflared ${args.join(' ')}`)
      output.push(execFileSync(cloudflaredPath(), args, { encoding: 'utf8', stderr: 'pipe' }).trim())
      return true
    } catch (err) {
      const msg = `${err.stdout || ''}${err.stderr || ''}`.trim() || err.message
      output.push(msg)
      return tolerate && tolerate.test(msg)
    }
  }
  if (!runCmd(['tunnel', 'create', cfg.tunnelName], /already exists/i)) {
    return res.status(500).json({ error: 'tunnel create failed', output })
  }
  if (!runCmd(['tunnel', 'route', 'dns', cfg.tunnelName, cfg.tunnelHostname], /already exists|already configured/i)) {
    return res.status(500).json({ error: 'DNS routing failed', output })
  }
  res.json({ ok: true, output })
})

adminApp.post('/api/tunnel/start', (req, res) => {
  startTunnel()
  res.json({ ok: true })
})

adminApp.post('/api/tunnel/stop', (req, res) => {
  stopTunnel()
  res.json({ ok: true })
})

adminApp.post('/api/tunnel/autostart', (req, res) => {
  settings.data.settings.autoTunnel = !!req.body.enabled
  settings.save()
  res.json({ autoTunnel: settings.data.settings.autoTunnel })
})

adminApp.get('/api/overview', (req, res) => {
  res.json({
    mainPort: PORT,
    publicUrl: tunnel.url,
    lobbies: lobbies.data.lobbies.map((lobby) => ({
      id: lobby.id,
      name: lobby.name,
      createdAt: lobby.createdAt,
      inviteToken: lobby.inviteToken,
      rom: lobby.roms[0] ? { name: lobby.roms[0].name, size: lobby.roms[0].size, core: lobby.roms[0].core } : null,
      members: members.data.members
        .filter((m) => m.lobbyId === lobby.id)
        .map((m) => {
          const own = runs.data.runs.filter((r) => r.memberId === m.id)
          const active = own.find((r) => r.status === 'active')
          return {
            id: m.id,
            name: m.name,
            token: m.token,
            createdAt: m.createdAt,
            attempts: own.length,
            live: !!streams.get(m.id) && Date.now() - streams.get(m.id).at < STREAM_FRESH_MS,
            active: active ? { attemptNumber: active.attemptNumber, gameName: active.gameName, badges: active.badges, ...runStats(active) } : null
          }
        })
    }))
  })
})

adminApp.delete('/api/lobbies/:id', (req, res) => {
  if (!deleteLobbyCascade(req.params.id)) return res.status(404).json({ error: 'not found' })
  saveAll()
  res.json({ ok: true })
})

adminApp.delete('/api/members/:id', (req, res) => {
  if (!members.data.members.some((m) => m.id === req.params.id)) return res.status(404).json({ error: 'not found' })
  deleteMemberCascade(req.params.id)
  saveAll()
  res.json({ ok: true })
})

adminApp.post('/api/members/:id/regenerate', (req, res) => {
  const member = members.data.members.find((m) => m.id === req.params.id)
  if (!member) return res.status(404).json({ error: 'not found' })
  member.token = token()
  members.save()
  res.json({ memberToken: member.token, name: member.name })
})

const BUG_FILE = /^bug-[\w.-]+\.json$/

adminApp.get('/api/bugs', (req, res) => {
  const out = []
  for (const file of fs.readdirSync(bugsDir).filter((f) => BUG_FILE.test(f)).sort().reverse()) {
    try {
      const report = JSON.parse(fs.readFileSync(path.join(bugsDir, file), 'utf8'))
      out.push({
        file,
        serverTime: report.serverTime,
        reporter: report.reporter?.name || '?',
        lobby: report.lobby?.name || '?',
        description: String(report.description || '').slice(0, 200),
        errors: report.diagnostics?.recentLogs?.length || 0
      })
    } catch { /* unreadable report */ }
  }
  res.json(out)
})

adminApp.get('/api/bugs/:file', (req, res) => {
  if (!BUG_FILE.test(req.params.file)) return res.status(400).json({ error: 'bad filename' })
  const file = path.join(bugsDir, req.params.file)
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' })
  res.sendFile(file)
})

adminApp.delete('/api/bugs/:file', (req, res) => {
  if (!BUG_FILE.test(req.params.file)) return res.status(400).json({ error: 'bad filename' })
  try { fs.unlinkSync(path.join(bugsDir, req.params.file)) } catch { return res.status(404).json({ error: 'not found' }) }
  res.json({ ok: true })
})

adminApp.get('/', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')))

adminApp.listen(ADMIN_PORT, '127.0.0.1', () => {
  console.log(`admin dashboard (localhost only) at http://localhost:${ADMIN_PORT}`)
})

// Cloud mode (single exposed port, e.g. Railway): setting ADMIN_TOKEN also
// mounts the admin app on the MAIN server at /admin behind HTTP basic auth
// (user "admin", password = the token). Unset locally, nothing changes.
if (process.env.ADMIN_TOKEN) {
  const adminAuth = (req, res, next) => {
    const hdr = req.headers.authorization || ''
    const ok = hdr.startsWith('Basic ') &&
      Buffer.from(hdr.slice(6), 'base64').toString() === `admin:${process.env.ADMIN_TOKEN}`
    if (!ok) {
      res.set('WWW-Authenticate', 'Basic realm="nuz-dash admin"')
      return res.status(401).end()
    }
    next()
  }
  app.use('/admin', adminAuth, (req, res, next) => {
    // exact /admin (no slash) must redirect so the page's relative fetches resolve under /admin/
    if (req.originalUrl === '/admin') return res.redirect('/admin/')
    next()
  }, adminApp)
  console.log('admin dashboard also mounted at /admin (basic auth, ADMIN_TOKEN)')
}
