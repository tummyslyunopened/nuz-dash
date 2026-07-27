import express from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import os from 'os'
import { spawn, execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import QRCode from 'qrcode'
import { GAMES } from './games.js'
import { Store, dataDir, uploadsDir } from './store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 4517

const lobbies = new Store('lobbies', { lobbies: [] })
const members = new Store('members', { members: [] })
const runs = new Store('runs', { runs: [] }) // a "run" is one attempt by one member
const encounters = new Store('encounters', { encounters: [] })
// Trainer battles, grouped: one record per (run, opposing trainer OT id)
const trainers = new Store('trainers', { trainers: [] })
// Lobby group chat (persisted, capped per lobby)
const chat = new Store('chat', { messages: [] })
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
  // Local .state downloads in players' browsers (plus the download-permission
  // priming flow). OFF by default — the server pair + history are the backups.
  localStateDownloads: false,
  ...settings.data.settings
}

const romsDir = path.join(dataDir, 'roms')
const statesDir = path.join(dataDir, 'states')
const spritesDir = path.join(dataDir, 'sprites')
const dumpsDir = path.join(dataDir, 'dumps')
for (const d of [romsDir, statesDir, spritesDir, dumpsDir]) fs.mkdirSync(d, { recursive: true })

const token = () => crypto.randomBytes(20).toString('hex')
const now = () => new Date().toISOString()

// Atomic binary writes: never leave a truncated sav/state/ROM as the latest copy
const writeAtomic = (file, buf) => {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, buf)
  fs.renameSync(tmp, file)
}

// Savestates are only valid for the core that wrote them. Stamped on write,
// checked on read; mismatches 404 so clients fall back to the battery save.
// BUMP THIS whenever server/emulatorjs-data cores are upgraded.
const EMU_CORE_VERSION = process.env.NUZ_CORE_VERSION || 'emulatorjs-4.2.3'

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

// Migration: every lobby needs a creator on record plus at least one link
// manager and one ROM manager — default all to the oldest member (the
// creator, in practice). Also heals creatorId if that member was deleted.
let mgrMigrated = false
let lobbyMigrated = false
for (const lobby of lobbies.data.lobbies) {
  const lobbyMembers = members.data.members.filter((m) => m.lobbyId === lobby.id)
  if (!lobbyMembers.length) continue
  const oldest = [...lobbyMembers].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
  if (!lobby.creatorId || !lobbyMembers.some((m) => m.id === lobby.creatorId)) {
    lobby.creatorId = oldest.id
    lobbyMigrated = true
  }
  if (!lobbyMembers.some((m) => m.linkManager)) { oldest.linkManager = true; mgrMigrated = true }
  if (!lobbyMembers.some((m) => m.romManager)) { oldest.romManager = true; mgrMigrated = true }
}
if (mgrMigrated) members.save()
if (lobbyMigrated) lobbies.save()

// BYO ROM (ROM-clean mode) is the DEFAULT for new servers: fresh installs
// never host ROM files. Servers that already have lobbies when this ships
// keep hosted mode (their runners' setups keep working) until the admin
// explicitly opts in from the dashboard.
if (settings.data.settings.romCleanMode === undefined) {
  settings.data.settings.romCleanMode = lobbies.data.lobbies.length === 0
  settings.save()
}

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
const publicMember = (m) => ({ id: m.id, name: m.name, createdAt: m.createdAt, linkManager: !!m.linkManager, romManager: !!m.romManager })

app.post('/api/lobbies', (req, res) => {
  const { lobbyName, runnerName } = req.body
  if (!lobbyName?.trim() || !runnerName?.trim()) {
    return res.status(400).json({ error: 'lobbyName and runnerName required' })
  }
  const lobby = { id: crypto.randomUUID(), name: lobbyName.trim(), inviteToken: token(), roms: [], createdAt: now() }
  // The creator starts as the lobby's link manager (can resend/regenerate
  // other members' secret links) and ROM manager (can replace the shared
  // lobby ROM) — both grantable to other members
  const member = { id: crypto.randomUUID(), token: token(), lobbyId: lobby.id, name: runnerName.trim(), linkManager: true, romManager: true, createdAt: now() }
  // The creator is specially protected: their permissions and secret link
  // can never be touched by other members, manager or not (admin only)
  lobby.creatorId = member.id
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
  presence.set(member.id, Date.now())
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
  // hosted:false = ROM-clean mode fingerprint entry — the client must supply
  // the ROM bytes locally (they are never on this server)
  return { ...run, rom: rom ? { name: rom.name, core: rom.core, size: rom.size, sha256: rom.sha256 || null, hosted: !!rom.file } : null }
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

// Link recovery. Rotating YOUR OWN link is always allowed (leak response —
// it grants access to nothing). Minting a new link for ANOTHER member shows
// the requester that member's new secret, so it requires the link-manager
// permission (lobby creator by default; grantable below or via admin).
app.post('/api/members/:memberId/regenerate-link', (req, res) => {
  const target = members.data.members.find((m) => m.id === req.params.memberId && m.lobbyId === req.lobby.id)
  if (!target) return res.status(404).json({ error: 'no such runner in this lobby' })
  if (target.id !== req.member.id && !req.member.linkManager) {
    return res.status(403).json({ error: 'regenerating other members\' links requires link-manager permission' })
  }
  if (target.id === req.lobby.creatorId && req.member.id !== target.id) {
    return res.status(403).json({ error: 'the lobby creator\'s link can only be regenerated by the creator or the admin dashboard' })
  }
  target.token = token()
  members.save()
  res.json({ memberId: target.id, name: target.name, memberToken: target.token })
})

// Managers can grant/revoke their permission within their lobby. Shared
// handler: holders of a flag manage that same flag; a last-holder guard
// keeps every lobby self-servicing (the admin dashboard can always override).
const managerToggle = (flag, label) => (req, res) => {
  if (!req.member[flag]) {
    return res.status(403).json({ error: `only ${label}s can change ${label} permissions` })
  }
  const target = members.data.members.find((m) => m.id === req.params.memberId && m.lobbyId === req.lobby.id)
  if (!target) return res.status(404).json({ error: 'no such runner in this lobby' })
  if (target.id === req.lobby.creatorId) {
    return res.status(403).json({ error: `the lobby creator's ${label} permission can only be changed from the admin dashboard` })
  }
  const enabled = !!req.body.enabled
  if (!enabled) {
    const managers = members.data.members.filter((m) => m.lobbyId === req.lobby.id && m[flag])
    if (managers.length === 1 && managers[0].id === target.id) {
      return res.status(400).json({ error: `cannot remove the last ${label} (the admin dashboard can)` })
    }
  }
  target[flag] = enabled
  members.save()
  res.json(publicMember(target))
}
app.post('/api/members/:memberId/link-manager', managerToggle('linkManager', 'link manager'))
app.post('/api/members/:memberId/rom-manager', managerToggle('romManager', 'ROM manager'))

app.put('/api/me/controls', (req, res) => {
  req.member.controls = req.body.controls || null
  members.save()
  res.json({ ok: true })
})

app.get('/api/me', (req, res) => {
  res.json({
    publicUrl: tunnel.url, // preferred origin for shareable links
    localDownloads: !!settings.data.settings.localStateDownloads,
    romCleanMode: !!settings.data.settings.romCleanMode,
    optionalStreaming: !!settings.data.settings.optionalStreaming,
    member: { ...publicMember(req.member), controls: req.member.controls || null },
    lobby: {
      id: req.lobby.id,
      name: req.lobby.name,
      inviteToken: req.lobby.inviteToken,
      creatorId: req.lobby.creatorId,
      roms: req.lobby.roms.map((r) => ({ id: r.id, name: r.name, core: r.core, size: r.size, sha256: r.sha256 || null, hosted: !!r.file }))
    },
    members: members.data.members.filter((m) => m.lobbyId === req.lobby.id).map(publicMember)
  })
})

// Latest emulator frame per member, memory-only (never persisted)
const streams = new Map() // memberId -> { buf, at, meta } (meta: live party + area)
// Presence (in-memory): memberId -> last authed request; drives online dots
const presence = new Map()
const PRESENCE_FRESH_MS = 30000
// Who is watching whose stream: targetId -> Map(viewerId -> lastFetch)
const streamViewers = new Map()
const VIEWER_FRESH_MS = 10000
const watchersOf = (targetId) => {
  const m = streamViewers.get(targetId)
  if (!m) return []
  const out = []
  for (const [viewerId, ts] of m) {
    if (Date.now() - ts > VIEWER_FRESH_MS) { m.delete(viewerId); continue }
    if (viewerId === targetId) continue
    const v = members.data.members.find((x) => x.id === viewerId)
    if (v) out.push(v.name)
  }
  return out
}
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
        online: presence.has(m.id) && Date.now() - presence.get(m.id) < PRESENCE_FRESH_MS,
        watchers: watchersOf(m.id),
        attempts: own.length,
        active: active ? {
          runId: active.id,
          attemptNumber: active.attemptNumber,
          name: active.name,
          gameName: active.gameName,
          badges: active.badges,
          updatedAt: active.updatedAt || active.createdAt,
          rules: active.rules,
          snapshot: active.lastSnapshot || null, // last-known party + area
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
  writeAtomic(path.join(romsDir, file), body)
  const entry = { id, name: filename, file, core, size: body.length, uploadedAt: now() }
  lobby.roms = [entry]
  lobbies.save()
  return entry
}

app.post('/api/lobby/roms', express.raw({ type: 'application/octet-stream', limit: '512mb' }), (req, res) => {
  if (settings.data.settings.romCleanMode) return res.status(403).json({ error: 'ROM-clean mode: ROMs stay in runners\' browsers — register a fingerprint instead' })
  if (!req.member.romManager) return res.status(403).json({ error: 'replacing the lobby ROM requires ROM-manager permission' })
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty upload' })
  try {
    const entry = addRomToLobby(req.lobby, String(req.query.filename || 'game.gba'), req.body)
    res.json({ id: entry.id, name: entry.name, core: entry.core, size: entry.size, hosted: true })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// ROM-clean mode: register WHICH game the lobby races without storing it —
// name, size and a SHA-256 fingerprint only. Runners supply their own copy
// locally and the client compares fingerprints. Keeps the existing entry id
// so attempts stay linked, exactly like a hosted upload/replace.
app.post('/api/lobby/rom-meta', (req, res) => {
  if (!settings.data.settings.romCleanMode) return res.status(400).json({ error: 'ROM-clean mode is off — upload the ROM instead' })
  if (!req.member.romManager) return res.status(403).json({ error: 'registering the lobby ROM requires ROM-manager permission' })
  const name = String(req.body.name || '').trim()
  const size = Number(req.body.size)
  const sha256 = String(req.body.sha256 || '').toLowerCase()
  if (!name || !Number.isFinite(size) || size <= 0 || !/^[0-9a-f]{64}$/.test(sha256)) {
    return res.status(400).json({ error: 'name, size and sha256 fingerprint required' })
  }
  const ext = name.split('.').pop().toLowerCase()
  const core = ROM_CORES[ext]
  if (!core) return res.status(400).json({ error: `Unsupported ROM type ".${ext}" — use .gb, .gbc, .gba or .nds (unzipped).` })
  const existing = req.lobby.roms[0]
  if (existing?.file) {
    try { fs.unlinkSync(path.join(romsDir, existing.file)) } catch { /* already gone */ }
  }
  const entry = { id: existing?.id || crypto.randomUUID(), name, file: null, core, size, sha256, uploadedAt: now() }
  req.lobby.roms = [entry]
  lobbies.save()
  res.json({ id: entry.id, name, core, size, sha256, hosted: false })
})

app.get('/api/lobby/roms/:romId', (req, res) => {
  const rom = lobbyRom(req.lobby, req.params.romId)
  if (!rom) return res.status(404).json({ error: 'rom not found' })
  if (!rom.file) return res.status(404).json({ error: 'rom is not hosted on this server (ROM-clean mode) — supply it locally' })
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
  try { fs.unlinkSync(path.join(statesDir, `${run.id}-battery.sav`)) } catch { /* none */ }
  deleteRunHistory(run.memberId, run.id)
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
  if (settings.data.settings.romCleanMode) return res.status(403).json({ error: 'ROM-clean mode: ROMs stay in runners\' browsers — register a fingerprint instead' })
  // This replaces the SHARED lobby ROM (one ROM per lobby), not a per-run copy
  if (!req.member.romManager) return res.status(403).json({ error: 'replacing the lobby ROM requires ROM-manager permission' })
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
  if (!rom.file) return res.status(404).json({ error: 'rom is not hosted on this server (ROM-clean mode) — supply it locally' })
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
  const { location, speciesName, speciesId, chainId, status, nickname, level, shiny, personality } = req.body
  if (!speciesName || !status) {
    return res.status(400).json({ error: 'speciesName and status required' })
  }
  const enc = {
    id: crypto.randomUUID(),
    runId: run.id,
    location: location || '', // may be blank: auto-logged encounters are annotated later
    personality: personality ?? null, // wild mon PID, used to auto-flip to "caught"
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
  const editable = ['location', 'speciesName', 'speciesId', 'chainId', 'status', 'nickname', 'level', 'shiny', 'alive', 'deathNote', 'personality']
  for (const key of editable) {
    if (req.body[key] !== undefined) enc[key] = req.body[key]
  }
  if (req.body.status && req.body.status !== 'caught') enc.alive = false
  else if (req.body.status === 'caught' && req.body.alive === undefined) enc.alive = true
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

// ---------- Trainer battles (grouped by opposing trainer OT id) ----------
app.get('/api/runs/:id/trainers', (req, res) => {
  if (!findRun(req, req.params.id)) return res.status(404).json({ error: 'not found' })
  res.json(trainers.data.trainers.filter((t) => t.runId === req.params.id))
})

// Radar upsert: same OT id = same trainer, so repeat battles and multi-mon
// teams accumulate on one record instead of spamming the list.
app.post('/api/runs/:id/trainers', (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  const otId = Number(req.body.otId) >>> 0
  if (!otId) return res.status(400).json({ error: 'otId required' })
  const mon = req.body.mon && typeof req.body.mon === 'object' ? {
    speciesName: String(req.body.mon.speciesName || '').slice(0, 40),
    speciesId: req.body.mon.speciesId ?? null,
    level: Number(req.body.mon.level) || 0,
    personality: Number(req.body.mon.personality) || 0
  } : null
  let entry = trainers.data.trainers.find((t) => t.runId === run.id && t.otId === otId)
  if (!entry) {
    entry = {
      id: crypto.randomUUID(),
      runId: run.id,
      otId,
      name: '',
      location: String(req.body.location || '').slice(0, 60),
      status: 'seen', // seen | beaten
      notes: '',
      mons: [],
      firstSeenAt: now(),
      updatedAt: now()
    }
    trainers.data.trainers.push(entry)
  }
  if (mon && mon.personality && !entry.mons.some((m) => m.personality === mon.personality)) {
    entry.mons.push(mon)
  }
  if (!entry.location && req.body.location) entry.location = String(req.body.location).slice(0, 60)
  entry.updatedAt = now()
  trainers.save()
  res.json(entry)
})

app.put('/api/trainers/:id', (req, res) => {
  const entry = trainers.data.trainers.find((t) => t.id === req.params.id)
  const run = entry && ownRun(req, entry.runId)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  for (const key of ['name', 'location', 'notes']) {
    if (req.body[key] !== undefined) entry[key] = String(req.body[key]).slice(0, key === 'notes' ? 500 : 60)
  }
  if (req.body.status !== undefined && ['seen', 'beaten'].includes(req.body.status)) {
    entry.status = req.body.status
  }
  entry.updatedAt = now()
  trainers.save()
  res.json(entry)
})

app.delete('/api/trainers/:id', (req, res) => {
  const entry = trainers.data.trainers.find((t) => t.id === req.params.id)
  const run = entry && ownRun(req, entry.runId)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  trainers.data.trainers = trainers.data.trainers.filter((t) => t.id !== entry.id)
  trainers.save()
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

// ---------- Single-session guard ----------
// One live session per run may push save data. In-memory; a server restart
// simply lets the first session re-claim.
const SESSION_FRESH_MS = 25000
const playSessions = new Map() // runId -> { sid, at }

function sessionConflict(req, runId) {
  const sid = req.headers['x-nuz-session']
  const cur = playSessions.get(runId)
  if (cur && sid && cur.sid !== sid && Date.now() - cur.at < SESSION_FRESH_MS) return true
  if (sid) playSessions.set(runId, { sid, at: Date.now() })
  return false
}

app.post('/api/runs/:id/session', (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  const sid = req.headers['x-nuz-session']
  if (!sid) return res.status(400).json({ error: 'X-Nuz-Session header required' })
  const cur = playSessions.get(run.id)
  if (cur && cur.sid !== sid && Date.now() - cur.at < SESSION_FRESH_MS && !req.body.takeover) {
    return res.status(409).json({ error: 'this run is being played in another session' })
  }
  playSessions.set(run.id, { sid, at: Date.now() })
  res.json({ ok: true })
})

// ---------- Save states (per attempt: 3 manual slots + rolling auto slot) ----------
const STATE_SLOTS = ['1', '2', '3', 'auto']

// Per-member rolling archive of every pushed sav/state, pruned oldest-first
// past the cap. Lets users download timestamped historical saves; auto-load
// still only ever uses the latest auto pair.
const historyDir = path.join(dataDir, 'saves-history')
fs.mkdirSync(historyDir, { recursive: true })
const HISTORY_CAP = Number(process.env.NUZ_HISTORY_CAP) || 1024 * 1024 * 1024 // 1GB per member

function archiveSaveFile(memberId, runId, ext, body) {
  try {
    const dir = path.join(historyDir, memberId)
    fs.mkdirSync(dir, { recursive: true })
    writeAtomic(path.join(dir, `${now().replace(/[:.]/g, '-')}__${runId}.${ext}`), body)
    const files = fs.readdirSync(dir)
      .map((f) => {
        const st = fs.statSync(path.join(dir, f))
        return { f, size: st.size, mtime: st.mtimeMs }
      })
      .sort((a, b) => a.mtime - b.mtime)
    let total = files.reduce((s, x) => s + x.size, 0)
    for (const x of files) {
      if (total <= HISTORY_CAP) break
      try { fs.unlinkSync(path.join(dir, x.f)); total -= x.size } catch { /* race */ }
    }
  } catch (err) {
    console.error('history archive failed:', err.message)
  }
}

function deleteRunHistory(memberId, runId) {
  const dir = path.join(historyDir, memberId)
  if (!fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir)) {
    if (f.includes(`__${runId}.`)) {
      try { fs.unlinkSync(path.join(dir, f)) } catch { /* fine */ }
    }
  }
}

const HIST_FILE = /^[\w.-]+__[\w-]+\.(state|sav|mstate)$/

app.get('/api/me/save-history', (req, res) => {
  const dir = path.join(historyDir, req.member.id)
  if (!fs.existsSync(dir)) return res.json({ files: [], totalSize: 0, cap: HISTORY_CAP })
  const attemptByRun = {}
  for (const r of runs.data.runs.filter((r) => r.memberId === req.member.id)) {
    attemptByRun[r.id] = r.attemptNumber
  }
  const files = fs.readdirSync(dir)
    .map((f) => {
      const m = /^(.+)__(.+)\.(state|sav|mstate)$/.exec(f)
      if (!m) return null
      const st = fs.statSync(path.join(dir, f))
      return {
        file: f,
        type: m[3],
        runId: m[2],
        attemptNumber: attemptByRun[m[2]] ?? null,
        size: st.size,
        savedAt: new Date(st.mtimeMs).toISOString()
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  res.json({ files, totalSize: files.reduce((s, x) => s + x.size, 0), cap: HISTORY_CAP })
})

app.get('/api/me/save-history/:file', (req, res) => {
  if (!HIST_FILE.test(req.params.file)) return res.status(400).json({ error: 'bad filename' })
  const file = path.join(historyDir, req.member.id, req.params.file)
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' })
  res.download(file)
})

app.post('/api/runs/:id/states/:slot', express.raw({ type: 'application/octet-stream', limit: '64mb' }), (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  if (!STATE_SLOTS.includes(req.params.slot)) return res.status(400).json({ error: 'slot must be 1-3 or auto' })
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty state' })
  if (sessionConflict(req, run.id)) return res.status(409).json({ error: 'run is being played in another session' })
  writeAtomic(path.join(statesDir, `${run.id}-${req.params.slot}.state`), req.body)
  if (req.params.slot === 'auto') archiveSaveFile(req.member.id, run.id, 'state', req.body)
  run.states = run.states || {}
  run.states[req.params.slot] = { savedAt: now(), size: req.body.length, core: EMU_CORE_VERSION }
  run.updatedAt = now()
  runs.save()
  res.json(serializeRun(run, req.lobby))
})

app.get('/api/runs/:id/states/:slot', (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  const meta = run.states?.[req.params.slot]
  if (meta?.core && meta.core !== EMU_CORE_VERSION) {
    return res.status(404).json({ error: `state was written by ${meta.core}, current core is ${EMU_CORE_VERSION} — resume from the battery save` })
  }
  const file = path.join(statesDir, `${run.id}-${req.params.slot}.state`)
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'slot empty' })
  res.sendFile(file)
})

// Battery save (.sav) backup per attempt. Savestates don't reliably include
// SRAM, so this is restored into the emulator FS on boot — it's what makes
// the party scanner (and in-game Continue) work before the first new save.
app.post('/api/runs/:id/sav', express.raw({ type: 'application/octet-stream', limit: '4mb' }), (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty save' })
  if (sessionConflict(req, run.id)) return res.status(409).json({ error: 'run is being played in another session' })
  writeAtomic(path.join(statesDir, `${run.id}-battery.sav`), req.body)
  archiveSaveFile(req.member.id, run.id, 'sav', req.body)
  run.sav = { savedAt: now(), size: req.body.length }
  run.updatedAt = now()
  runs.save()
  res.json(serializeRun(run, req.lobby))
})

app.get('/api/runs/:id/sav', (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  const file = path.join(statesDir, `${run.id}-battery.sav`)
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'no battery backup yet' })
  res.sendFile(file)
})

// Manual save states made via the emulator menu — archived to history only
// (never auto-loaded; the sav-only resume policy stands).
app.post('/api/runs/:id/manual-state', express.raw({ type: 'application/octet-stream', limit: '64mb' }), (req, res) => {
  const run = ownRun(req, req.params.id)
  if (!run) return res.status(404).json({ error: 'not found or not yours' })
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty state' })
  if (sessionConflict(req, run.id)) return res.status(409).json({ error: 'run is being played in another session' })
  archiveSaveFile(req.member.id, run.id, 'mstate', req.body)
  res.json({ ok: true })
})

// ---------- Live game streaming (watch party) ----------
// Push fan-out: viewers hold ONE long-lived response each; every frame the
// runner posts is forwarded immediately (4-byte LE length prefix + JPEG).
// Polling GET /api/stream/:id stays as the fallback path.
const streamSubs = new Map() // targetId -> Set(res)
const writeFrame = (res, buf) => {
  const len = Buffer.alloc(4)
  len.writeUInt32LE(buf.length, 0)
  res.write(len)
  res.write(buf)
}
const fanOutFrame = (targetId, buf) => {
  const subs = streamSubs.get(targetId)
  if (!subs) return
  for (const res of subs) {
    try {
      // Slow viewer (buffer piling up): skip frames rather than lag behind
      if (res.writableLength > 1_000_000) continue
      writeFrame(res, buf)
    } catch {
      subs.delete(res)
    }
  }
}

app.post('/api/stream', express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: '2mb' }), (req, res) => {
  if (req.body && req.body.length) {
    // Live overlay data (current area + party snapshot) rides along in a
    // header so viewers see the LIVE state, not just last-save data
    let meta = null
    try { meta = JSON.parse(decodeURIComponent(req.headers['x-stream-meta'] || '')) } catch { /* optional */ }
    streams.set(req.member.id, { buf: req.body, at: Date.now(), meta })
    fanOutFrame(req.member.id, req.body)
    // Persist a throttled last-known snapshot on the active run, so the
    // lobby shows everyone's latest party/location even while they're
    // offline. Saved at most every ~15s (or on area change) — not per frame.
    if (meta && (meta.party || meta.area)) {
      const run = runs.data.runs.find((r) => r.memberId === req.member.id && r.status === 'active')
      if (run) {
        const last = run.lastSnapshot
        const areaChanged = !last || (last.area || null) !== (meta.area || null)
        if (!last || areaChanged || Date.now() - new Date(last.at).getTime() > 15000) {
          run.lastSnapshot = {
            area: meta.area || null,
            party: Array.isArray(meta.party) ? meta.party.slice(0, 6) : [],
            at: now()
          }
          runs.save()
        }
      }
    }
  }
  res.json({ ok: true })
})

// Long-lived frame push: full broadcast framerate, no per-frame round-trips
app.get('/api/stream/:memberId/live', (req, res) => {
  const target = members.data.members.find((m) => m.id === req.params.memberId && m.lobbyId === req.lobby.id)
  if (!target) return res.status(404).json({ error: 'no such runner' })
  res.set({
    'Content-Type': 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no'
  })
  res.flushHeaders?.()
  if (!streamSubs.has(target.id)) streamSubs.set(target.id, new Set())
  const subs = streamSubs.get(target.id)
  subs.add(res)
  // Seed with the current frame so the picture appears instantly
  const cur = streams.get(target.id)
  if (cur && Date.now() - cur.at < STREAM_FRESH_MS) {
    try { writeFrame(res, cur.buf) } catch { /* client already gone */ }
  }
  // Holding the connection = watching
  const markWatcher = () => {
    if (!streamViewers.has(target.id)) streamViewers.set(target.id, new Map())
    streamViewers.get(target.id).set(req.member.id, Date.now())
  }
  markWatcher()
  const wTimer = setInterval(markWatcher, 5000)
  req.on('close', () => {
    subs.delete(res)
    clearInterval(wTimer)
  })
})

app.get('/api/stream/:memberId', (req, res) => {
  const target = members.data.members.find((m) => m.id === req.params.memberId && m.lobbyId === req.lobby.id)
  const frame = target && streams.get(target.id)
  if (!frame || Date.now() - frame.at > 15000) return res.status(404).end()
  // Fetching frames = watching; powers the "who's watching" indicators
  if (!streamViewers.has(target.id)) streamViewers.set(target.id, new Map())
  streamViewers.get(target.id).set(req.member.id, Date.now())
  res.set('Content-Type', 'image/jpeg')
  res.set('Cache-Control', 'no-store')
  res.send(frame.buf)
})

// Live overlay for a stream: area + party snapshot + who's watching
app.get('/api/stream/:memberId/meta', (req, res) => {
  const target = members.data.members.find((m) => m.id === req.params.memberId && m.lobbyId === req.lobby.id)
  if (!target) return res.status(404).json({ error: 'no such runner' })
  const frame = streams.get(target.id)
  const live = !!frame && Date.now() - frame.at < STREAM_FRESH_MS
  res.set('Cache-Control', 'no-store')
  res.json({
    live,
    at: frame?.at || null,
    area: (live && frame.meta?.area) || null,
    party: (live && frame.meta?.party) || null,
    watchers: watchersOf(target.id)
  })
})

// ---------- Lobby group chat ----------
const CHAT_CAP = 300 // per lobby; older messages roll off

app.get('/api/lobby/chat', (req, res) => {
  const msgs = chat.data.messages.filter((m) => m.lobbyId === req.lobby.id)
  res.set('Cache-Control', 'no-store')
  res.json(msgs.slice(-100))
})

app.post('/api/lobby/chat', (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 500)
  if (!text) return res.status(400).json({ error: 'empty message' })
  const msg = {
    id: crypto.randomUUID(),
    lobbyId: req.lobby.id,
    memberId: req.member.id,
    name: req.member.name,
    text,
    at: now()
  }
  chat.data.messages.push(msg)
  const mine = chat.data.messages.filter((m) => m.lobbyId === req.lobby.id)
  if (mine.length > CHAT_CAP) {
    const cutoff = new Set(mine.slice(0, mine.length - CHAT_CAP).map((m) => m.id))
    chat.data.messages = chat.data.messages.filter((m) => !cutoff.has(m.id))
  }
  chat.save()
  res.json(msg)
})

// ---------- Lobby event log ----------
// Aggregate feed of tracked game events across the lobby, assembled from the
// existing stores at request time (no separate event store to keep in sync).
// EXTENSIBLE: each source contributes { id, type, at, runner, attempt, data }
// — add new types (deaths, badges, clears…) by pushing more entries here as
// more game state gets tracked.
app.get('/api/lobby/events', (req, res) => {
  const lobbyRuns = new Map(
    runs.data.runs.filter((r) => r.lobbyId === req.lobby.id).map((r) => [r.id, r])
  )
  const nameOf = new Map(
    members.data.members.filter((m) => m.lobbyId === req.lobby.id).map((m) => [m.id, m.name])
  )
  const events = []
  for (const e of encounters.data.encounters) {
    const run = lobbyRuns.get(e.runId)
    if (!run) continue
    events.push({
      id: `enc-${e.id}`,
      type: 'encounter',
      at: e.createdAt,
      runner: nameOf.get(run.memberId) || '?',
      attempt: run.attemptNumber,
      data: {
        speciesName: e.speciesName,
        speciesId: e.speciesId,
        status: e.status,
        alive: e.alive,
        location: e.location,
        level: e.level,
        shiny: e.shiny
      }
    })
  }
  for (const t of trainers.data.trainers) {
    const run = lobbyRuns.get(t.runId)
    if (!run) continue
    events.push({
      id: `tr-${t.id}`,
      type: 'trainer',
      at: t.firstSeenAt,
      runner: nameOf.get(run.memberId) || '?',
      attempt: run.attemptNumber,
      data: {
        name: t.name,
        otId: t.otId,
        location: t.location,
        mons: t.mons.length,
        status: t.status
      }
    })
  }
  events.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
  res.set('Cache-Control', 'no-store')
  res.json(events.slice(0, 60))
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

// ---------- Admin 2FA (TOTP, RFC 6238) ----------
// No password: possession of the interface is the first factor (localhost
// binding, or basic auth on the cloud /admin mount). TOTP is the second.
// Cloud /admin ALWAYS requires it (forcing enrollment on first login);
// the localhost dashboard requires it only when the option is enabled.
// Secret lives in settings.json (server/data — private, gitignored).

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const base32Encode = (buf) => {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) { out += B32_ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}
const base32Decode = (str) => {
  let bits = 0, value = 0
  const out = []
  for (const c of str.toUpperCase().replace(/=+$/, '')) {
    const idx = B32_ALPHABET.indexOf(c)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return Buffer.from(out)
}

const hotp = (key, counter) => {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = crypto.createHmac('sha1', key).update(msg).digest()
  const off = h[h.length - 1] & 0xf
  const code = (((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]) % 1e6
  return String(code).padStart(6, '0')
}

const codeEq = (a, b) => {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b))
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb)
}

// Returns the matched time-step counter (for replay rejection) or null.
// Accepts ±1 step (30s) of clock drift.
const verifyTotpCode = (secretB32, code) => {
  if (!/^\d{6}$/.test(code)) return null
  const key = base32Decode(secretB32)
  const step = Math.floor(Date.now() / 30000)
  for (const off of [-1, 0, 1]) {
    if (codeEq(hotp(key, step + off), code)) return step + off
  }
  return null
}

// Brute-force guard: a 6-digit space must not be guessable. Failures are
// counted GLOBALLY (proxies can hide the real client IP): 5 free attempts,
// then an exponentially growing lockout (30s → 15min). Reused valid codes
// count as failures too. In-memory — a restart resets it, which is fine
// because a restart also can't be triggered remotely.
const totpGuard = { fails: 0, lockedUntil: 0 }
const totpLockedMs = () => Math.max(0, totpGuard.lockedUntil - Date.now())
const totpFail = () => {
  totpGuard.fails += 1
  if (totpGuard.fails >= 5) {
    totpGuard.lockedUntil = Date.now() + Math.min(30000 * 2 ** (totpGuard.fails - 5), 900000)
  }
}
const totpSuccess = () => { totpGuard.fails = 0; totpGuard.lockedUntil = 0 }

const ADMIN_SESSION_TTL = 12 * 60 * 60 * 1000
const adminSessions = new Map() // session token -> expiry epoch ms
const getCookie = (req, name) => {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}
const adminAuthed = (req) => {
  const t = getCookie(req, 'nuz_admin_2fa')
  if (!t) return false
  const exp = adminSessions.get(t)
  if (!exp || exp < Date.now()) { adminSessions.delete(t); return false }
  return true
}
const issueAdminSession = (req, res) => {
  for (const [k, exp] of adminSessions) { if (exp < Date.now()) adminSessions.delete(k) }
  const tok = crypto.randomBytes(32).toString('hex')
  adminSessions.set(tok, Date.now() + ADMIN_SESSION_TTL)
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
  res.set('Set-Cookie', `nuz_admin_2fa=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${ADMIN_SESSION_TTL / 1000}${secure}`)
}

const totpConf = () => settings.data.settings.adminTotp || null
// Mounted under /admin on the main app → baseUrl is '/admin'; standalone port → ''
const isCloudAdmin = (req) => !!req.baseUrl

// Gate: every admin request except the page shell and the totp endpoints
// needs a 2FA session when this context requires one.
adminApp.use((req, res, next) => {
  const conf = totpConf()
  const enrolled = !!conf?.secret
  const required = isCloudAdmin(req) || (enrolled && !!conf?.requireLocal)
  req.adminTotp = { enrolled, required, authed: adminAuthed(req) }
  if (!required || req.adminTotp.authed) return next()
  if (req.path === '/' || req.path.startsWith('/api/totp/')) return next()
  res.status(401).json({ error: 'two-factor authentication required', totpRequired: true, enrolled })
})

// "Trusted" = allowed to manage 2FA config: an authed session, or a context
// that doesn't require 2FA at all (open localhost dashboard).
const totpTrusted = (req) => req.adminTotp.authed || !req.adminTotp.required

adminApp.get('/api/totp/status', (req, res) => {
  const conf = totpConf()
  res.json({
    enrolled: !!conf?.secret,
    requireLocal: !!conf?.requireLocal,
    required: req.adminTotp.required,
    authed: req.adminTotp.authed,
    cloud: isCloudAdmin(req),
    lockedForMs: totpLockedMs()
  })
})

// Pending (unconfirmed) secret lives in memory only, so an abandoned setup
// can never lock anyone out.
let pendingTotpSecret = null

adminApp.post('/api/totp/setup', async (req, res) => {
  if (req.adminTotp.enrolled && !totpTrusted(req)) {
    return res.status(403).json({ error: 'authenticate with the current code before re-enrolling' })
  }
  pendingTotpSecret = base32Encode(crypto.randomBytes(20))
  const otpauth = `otpauth://totp/${encodeURIComponent('nuz-dash admin')}?secret=${pendingTotpSecret}&issuer=nuz-dash&algorithm=SHA1&digits=6&period=30`
  let qr = null
  try { qr = await QRCode.toDataURL(otpauth, { margin: 1, width: 220 }) } catch { /* text fallback below */ }
  res.json({ secret: pendingTotpSecret, otpauth, qr })
})

adminApp.post('/api/totp/confirm', (req, res) => {
  if (!pendingTotpSecret) return res.status(400).json({ error: 'no 2FA setup in progress' })
  if (req.adminTotp.enrolled && !totpTrusted(req)) {
    return res.status(403).json({ error: 'authenticate with the current code before re-enrolling' })
  }
  const locked = totpLockedMs()
  if (locked > 0) return res.status(429).json({ error: 'too many attempts', retryAfterMs: locked })
  const counter = verifyTotpCode(pendingTotpSecret, String(req.body.code || '').trim())
  if (counter == null) {
    totpFail()
    return res.status(401).json({ error: 'code did not match — check the authenticator and try again', retryAfterMs: totpLockedMs() })
  }
  totpSuccess()
  settings.data.settings.adminTotp = {
    secret: pendingTotpSecret,
    requireLocal: !!totpConf()?.requireLocal,
    lastCounter: counter
  }
  pendingTotpSecret = null
  settings.save()
  issueAdminSession(req, res)
  res.json({ ok: true })
})

adminApp.post('/api/totp/verify', (req, res) => {
  const conf = totpConf()
  if (!conf?.secret) return res.status(400).json({ error: '2FA is not set up' })
  const locked = totpLockedMs()
  if (locked > 0) return res.status(429).json({ error: 'too many attempts', retryAfterMs: locked })
  const counter = verifyTotpCode(conf.secret, String(req.body.code || '').trim())
  if (counter == null || counter <= (conf.lastCounter || 0)) {
    totpFail() // reused codes are failures too (replay)
    return res.status(401).json({ error: 'invalid code', retryAfterMs: totpLockedMs() })
  }
  totpSuccess()
  conf.lastCounter = counter
  settings.save()
  issueAdminSession(req, res)
  res.json({ ok: true })
})

adminApp.post('/api/totp/local-require', (req, res) => {
  if (!totpTrusted(req)) return res.status(403).json({ error: 'authenticate first' })
  const conf = totpConf()
  if (!conf?.secret) return res.status(400).json({ error: 'set up 2FA before requiring it' })
  conf.requireLocal = !!req.body.enabled
  settings.save()
  res.json({ requireLocal: conf.requireLocal })
})

adminApp.post('/api/totp/disable', (req, res) => {
  const conf = totpConf()
  if (!conf?.secret) return res.status(400).json({ error: '2FA is not set up' })
  if (!totpTrusted(req)) return res.status(403).json({ error: 'authenticate first' })
  const locked = totpLockedMs()
  if (locked > 0) return res.status(429).json({ error: 'too many attempts', retryAfterMs: locked })
  const counter = verifyTotpCode(conf.secret, String(req.body.code || '').trim())
  if (counter == null) {
    totpFail()
    return res.status(401).json({ error: 'invalid code', retryAfterMs: totpLockedMs() })
  }
  totpSuccess()
  delete settings.data.settings.adminTotp
  settings.save()
  adminSessions.clear()
  res.json({ ok: true })
})

function deleteRunData(runId) {
  for (const slot of STATE_SLOTS) {
    try { fs.unlinkSync(path.join(statesDir, `${runId}-${slot}.state`)) } catch { /* empty */ }
  }
  try { fs.unlinkSync(path.join(statesDir, `${runId}-battery.sav`)) } catch { /* none */ }
  encounters.data.encounters = encounters.data.encounters.filter((e) => e.runId !== runId)
  diary.data.entries = diary.data.entries.filter((d) => d.runId !== runId)
  trainers.data.trainers = trainers.data.trainers.filter((t) => t.runId !== runId)
}

function deleteMemberCascade(memberId) {
  for (const run of runs.data.runs.filter((r) => r.memberId === memberId)) deleteRunData(run.id)
  runs.data.runs = runs.data.runs.filter((r) => r.memberId !== memberId)
  members.data.members = members.data.members.filter((m) => m.id !== memberId)
  streams.delete(memberId)
  try { fs.rmSync(path.join(historyDir, memberId), { recursive: true, force: true }) } catch { /* fine */ }
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
  chat.data.messages = chat.data.messages.filter((m) => m.lobbyId !== lobbyId)
  lobbies.data.lobbies = lobbies.data.lobbies.filter((l) => l.id !== lobbyId)
  return true
}

const saveAll = () => { lobbies.save(); members.save(); runs.save(); encounters.save(); diary.save(); maps.save(); trainers.save(); chat.save() }

adminApp.get('/api/settings', (req, res) => {
  res.json({
    localStateDownloads: !!settings.data.settings.localStateDownloads,
    romCleanMode: !!settings.data.settings.romCleanMode,
    optionalStreaming: !!settings.data.settings.optionalStreaming
  })
})

adminApp.post('/api/settings', (req, res) => {
  if (typeof req.body.localStateDownloads === 'boolean') {
    settings.data.settings.localStateDownloads = req.body.localStateDownloads
  }
  if (typeof req.body.optionalStreaming === 'boolean') {
    settings.data.settings.optionalStreaming = req.body.optionalStreaming
  }
  if (typeof req.body.romCleanMode === 'boolean' && req.body.romCleanMode !== !!settings.data.settings.romCleanMode) {
    if (req.body.romCleanMode) {
      // Going clean: fingerprint every stored ROM, then delete the file. The
      // entry (and its id) survives, so attempts stay linked and runners'
      // local copies can be verified against the recorded hash.
      for (const lobby of lobbies.data.lobbies) {
        for (const rom of lobby.roms || []) {
          if (!rom.file) continue
          try {
            const p = path.join(romsDir, rom.file)
            rom.sha256 = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
            fs.unlinkSync(p)
          } catch { /* file already gone — keep any existing hash */ }
          rom.file = null
        }
      }
      lobbies.save()
    }
    settings.data.settings.romCleanMode = req.body.romCleanMode
  }
  settings.save()
  res.json({
    localStateDownloads: !!settings.data.settings.localStateDownloads,
    romCleanMode: !!settings.data.settings.romCleanMode,
    optionalStreaming: !!settings.data.settings.optionalStreaming
  })
})

// Per-runner save storage: history archive + live resume files
adminApp.get('/api/storage', (req, res) => {
  const rows = []
  for (const m of members.data.members) {
    const lobby = lobbies.data.lobbies.find((l) => l.id === m.lobbyId)
    let historyFiles = 0
    let historyBytes = 0
    const dir = path.join(historyDir, m.id)
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        try {
          historyBytes += fs.statSync(path.join(dir, f)).size
          historyFiles++
        } catch { /* race */ }
      }
    }
    let liveBytes = 0
    for (const r of runs.data.runs.filter((x) => x.memberId === m.id)) {
      for (const f of [`${r.id}-auto.state`, `${r.id}-battery.sav`, `${r.id}-1.state`, `${r.id}-2.state`, `${r.id}-3.state`]) {
        const p = path.join(statesDir, f)
        try { if (fs.existsSync(p)) liveBytes += fs.statSync(p).size } catch { /* race */ }
      }
    }
    rows.push({
      memberId: m.id,
      name: m.name,
      lobby: lobby?.name || '?',
      historyFiles,
      historyBytes,
      liveBytes,
      totalBytes: historyBytes + liveBytes
    })
  }
  rows.sort((a, b) => b.totalBytes - a.totalBytes)
  res.json({ rows, cap: HISTORY_CAP, grandTotal: rows.reduce((s, r) => s + r.totalBytes, 0) })
})

adminApp.delete('/api/storage/:memberId/history', (req, res) => {
  const dir = path.join(historyDir, req.params.memberId)
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'no history' })
  fs.rmSync(dir, { recursive: true, force: true })
  res.json({ ok: true })
})

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
      creatorId: lobby.creatorId,
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
            linkManager: !!m.linkManager,
            romManager: !!m.romManager,
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

// Admin override: manage link/ROM-manager membership without lobby-side limits
const adminManagerToggle = (flag) => (req, res) => {
  const member = members.data.members.find((m) => m.id === req.params.id)
  if (!member) return res.status(404).json({ error: 'not found' })
  member[flag] = !!req.body.enabled
  members.save()
  res.json(publicMember(member))
}
adminApp.post('/api/members/:id/link-manager', adminManagerToggle('linkManager'))
adminApp.post('/api/members/:id/rom-manager', adminManagerToggle('romManager'))

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
