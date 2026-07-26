// Live Gen 3 battle detection by reading the mGBA core's WASM heap.
//
// Self-calibrating — no hardcoded emulator or per-game addresses:
// 1. The party from the last save sync gives us known bytes (personality/OT id
//    pairs) to scan for; every match is a candidate gPlayerParty address.
// 2. In every Gen 3 game the enemy party (the Pokemon you're battling) is the
//    adjacent 600-byte array: gEnemyParty = gPlayerParty + 600 in R/S/E and
//    gPlayerParty - 600 in FR/LG. We watch both neighbors of every candidate.
// 3. A decodable, sane Pokemon appearing there with an unseen personality
//    means a battle just started.
//
// Matches include stale copies (save blocks, savestates) — harmless, since
// they're just extra watched addresses and suggestions dedupe by personality.

import { parseMonAt } from './gen3save.js'

const PARTY_STRIDE = 100
const ENEMY_DELTAS = [600, -600]

function getHeap() {
  const heap = window.EJS_emulator?.gameManager?.Module?.HEAPU8
  if (!heap || !heap.buffer || !heap.byteLength) {
    throw new Error('Emulator memory is not accessible — start the game first.')
  }
  return heap
}

// Pure scan over a provided heap (exported for tests).
// Any synced party member can match at any of the six slots — the candidate
// base scoring survives party reordering since the last in-game save.
export function calibrateIn(heap, party) {
  if (!party?.length) {
    throw new Error('Sync the party from the game first — it anchors the memory scan.')
  }
  const words = new Uint32Array(heap.buffer, heap.byteOffset, Math.floor(heap.byteLength / 4))
  const dv = new DataView(heap.buffer, heap.byteOffset, heap.byteLength)
  const byPersonality = new Map(
    party.filter((m) => m.personality).map((m) => [m.personality >>> 0, m.otId >>> 0])
  )
  const hits = []
  for (let i = 0; i < words.length - 160; i++) {
    if (words[i] === 0) continue
    const ot = byPersonality.get(words[i])
    if (ot !== undefined && words[i + 1] === ot) hits.push(i * 4)
  }
  const directHits = new Set(hits)
  const scores = new Map()
  for (const addr of hits) {
    for (let s = 0; s < 6; s++) {
      const base = addr - s * PARTY_STRIDE
      if (base < 0 || scores.has(base)) continue
      let n = 0
      for (let k = 0; k < 6; k++) {
        const off = base + k * PARTY_STRIDE
        if (off + 8 > heap.byteLength) break
        const ot2 = byPersonality.get(dv.getUint32(off, true))
        if (ot2 !== undefined && dv.getUint32(off + 4, true) === ot2) n++
      }
      scores.set(base, n)
    }
  }
  // Rank: match count first, then bases that ARE a direct hit (slot 0 —
  // the true party base always is), so the cap can't discard the live party.
  const need = Math.min(2, byPersonality.size)
  const candidates = [...scores.entries()]
    .filter(([, n]) => n >= need)
    .sort((a, b) => (b[1] - a[1]) || ((directHits.has(b[0]) ? 1 : 0) - (directHits.has(a[0]) ? 1 : 0)))
    .slice(0, 24)
    .map(([base]) => base)
  if (!candidates.length) {
    throw new Error('Party not found in emulator memory. Save in-game, hit "Sync from game", then calibrate again.')
  }
  return { candidates, totalHits: hits.length }
}

function saneEnemy(mon) {
  if (!mon) return false
  if (!mon.level || mon.level > 100) return false
  if (!mon.maxHp || mon.maxHp > 999 || mon.hp > mon.maxHp) return false
  const species = mon.maskedSpecies ?? mon.internalSpecies
  if (species < 1) return false
  if (mon.isEgg) return false
  return true
}

// Pure enemy-slot check over a provided heap (exported for tests)
export function scanEnemiesIn(heap, candidates, isKnownPersonality, deltas = ENEMY_DELTAS) {
  const dv = new DataView(heap.buffer, heap.byteOffset, heap.byteLength)
  const found = []
  const seenThisScan = new Set()
  for (const base of candidates) {
    for (const delta of deltas) {
      const off = base + delta
      if (off < 0 || off + PARTY_STRIDE > heap.byteLength) continue
      let mon = null
      try { mon = parseMonAt(dv, heap, off) } catch { continue }
      if (!saneEnemy(mon)) continue
      if (seenThisScan.has(mon.personality) || isKnownPersonality(mon.personality)) continue
      seenThisScan.add(mon.personality)
      found.push(mon)
    }
  }
  return found
}

// Raw decode attempts at each watched enemy slot, for the diagnostics view
export function probeIn(heap, candidates) {
  const dv = new DataView(heap.buffer, heap.byteOffset, heap.byteLength)
  const out = []
  for (const base of candidates.slice(0, 4)) {
    for (const delta of ENEMY_DELTAS) {
      const off = base + delta
      if (off < 0 || off + PARTY_STRIDE > heap.byteLength) continue
      let mon = null
      try { mon = parseMonAt(dv, heap, off) } catch { /* unreadable */ }
      out.push({
        base,
        delta,
        species: mon?.internalSpecies ?? 0,
        level: mon?.level ?? 0,
        hp: mon?.hp ?? 0,
        sane: saneEnemy(mon)
      })
    }
  }
  return out
}

// One-shot wide search around each candidate region — run DURING a battle.
// Finds valid enemy mons at non-standard offsets (relocated arrays in ROM
// hacks) and reports the delta so the per-second scan can watch it too.
export function deepScanIn(heap, candidates, isKnownPersonality, range = 0x4000) {
  const dv = new DataView(heap.buffer, heap.byteOffset, heap.byteLength)
  // Cluster candidates: one representative per region, so shifted variants
  // of the same party copy don't multiply the work.
  const regions = []
  for (const base of [...candidates].sort((a, b) => a - b)) {
    if (!regions.length || base - regions[regions.length - 1] > range) regions.push(base)
  }
  const found = []
  const seen = new Set()
  for (const base of regions.slice(0, 6)) {
    const lo = Math.max(0, base - range)
    const hi = Math.min(heap.byteLength - PARTY_STRIDE, base + range)
    for (let off = lo; off <= hi; off += 4) {
      let mon = null
      try { mon = parseMonAt(dv, heap, off) } catch { continue }
      if (!saneEnemy(mon)) continue
      if (seen.has(mon.personality) || isKnownPersonality(mon.personality)) continue
      seen.add(mon.personality)
      found.push({ delta: off - base, base, offset: off, mon })
    }
  }
  return found
}

export const calibrate = (party) => calibrateIn(getHeap(), party)
export const scanEnemies = (candidates, isKnown, deltas) => scanEnemiesIn(getHeap(), candidates, isKnown, deltas)
export const probe = (candidates) => probeIn(getHeap(), candidates)
export const deepScan = (candidates, isKnown) => deepScanIn(getHeap(), candidates, isKnown)

// Snapshot the entire emulator heap for offline analysis
export function dumpHeap() {
  const heap = getHeap()
  return new Uint8Array(heap) // copy, so the transfer isn't racing the emulator
}

// ---------------------------------------------------------------------------
// Species-name table lookup, read from the game's OWN data in memory.
// Vanilla keeps an 11-byte-stride name array; pokeemerald-expansion hacks
// embed the name in a 260-byte gSpeciesInfo entry. Either way: find
// "Bulbasaur" (species 1), derive the stride from "Ivysaur" (species 2),
// verify with "Venusaur" (species 3) — then any species id resolves to the
// hack's actual name, fakemon included.

function encodeGen3(str) {
  const out = []
  for (const ch of str) {
    const c = ch.charCodeAt(0)
    if (ch === ' ') out.push(0x00)
    else if (c >= 65 && c <= 90) out.push(0xbb + c - 65)
    else if (c >= 97 && c <= 122) out.push(0xd5 + c - 97)
    else if (c >= 48 && c <= 57) out.push(0xa1 + c - 48)
  }
  out.push(0xff)
  return out
}

function findBytesIn(heap, pattern, limit) {
  const found = []
  const first = pattern[0]
  outer: for (let i = 0; i < heap.byteLength - pattern.length; i++) {
    if (heap[i] !== first) continue
    for (let j = 1; j < pattern.length; j++) {
      if (heap[i + j] !== pattern[j]) continue outer
    }
    found.push(i)
    if (found.length >= limit) break
  }
  return found
}

export function findSpeciesTableIn(heap) {
  const bulba = findBytesIn(heap, encodeGen3('Bulbasaur'), 8)
  const ivy = findBytesIn(heap, encodeGen3('Ivysaur'), 24)
  const venu = encodeGen3('Venusaur')
  for (const b of bulba) {
    for (const i of ivy) {
      const stride = i - b
      if (stride < 11 || stride > 1024) continue
      const off = b + 2 * stride
      if (off + venu.length > heap.byteLength) continue
      let ok = true
      for (let k = 0; k < venu.length; k++) {
        if (heap[off + k] !== venu[k]) { ok = false; break }
      }
      if (ok) return { base: b, stride }
    }
  }
  return null
}

export function speciesTableNameIn(heap, table, id) {
  if (!table || !id || id < 1 || id > 4096) return null
  const off = table.base + (id - 1) * table.stride
  if (off + 13 > heap.byteLength) return null
  let out = ''
  for (let k = 0; k < 12; k++) {
    const b = heap[off + k]
    if (b === 0xff) break
    if (b >= 0xbb && b <= 0xd4) out += String.fromCharCode(65 + b - 0xbb)
    else if (b >= 0xd5 && b <= 0xee) out += String.fromCharCode(97 + b - 0xd5)
    else if (b >= 0xa1 && b <= 0xaa) out += String.fromCharCode(48 + b - 0xa1)
    else if (b === 0xad) out += '-'
    else if (b === 0xb4) out += "'"
    else if (b === 0x00) out += ' '
    else if (b === 0xb5 || b === 0xb6) continue // ♂/♀ (Nidoran)
    else return null
  }
  out = out.trim()
  return out.length >= 2 ? out : null
}

export const findSpeciesTable = () => findSpeciesTableIn(getHeap())
export const speciesTableName = (table, id) => speciesTableNameIn(getHeap(), table, id)
