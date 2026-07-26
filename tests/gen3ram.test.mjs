// Synthetic-heap tests for the encounter radar (calibration, enemy scan,
// deep scan, candidate ranking, ROM species-name table discovery).
import assert from 'node:assert'
import { calibrateIn, scanEnemiesIn, deepScanIn, findSpeciesTableIn, speciesTableNameIn } from '../client/src/gen3ram.js'

const heap = new Uint8Array(1 << 20) // 1MB fake WASM heap
const dv = new DataView(heap.buffer)

const ORDERS = [
  'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA',
  'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG',
  'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'
]

function writeMon(off, { personality, otId, species, level, hp, maxHp }) {
  dv.setUint32(off, personality, true)
  dv.setUint32(off + 4, otId, true)
  const key = personality ^ otId
  const plain = new Uint8Array(48)
  const pdv = new DataView(plain.buffer)
  const order = ORDERS[personality % 24]
  pdv.setUint16(order.indexOf('G') * 12, species, true)
  for (let w = 0; w < 12; w++) {
    dv.setUint32(off + 32 + w * 4, pdv.getUint32(w * 4, true) ^ key, true)
  }
  heap[off + 84] = level
  dv.setUint16(off + 86, hp, true)
  dv.setUint16(off + 88, maxHp, true)
}

// Player party at an aligned offset (as it would sit in EWRAM)
const partyAddr = 0x41230 + 0x8000
writeMon(partyAddr, { personality: 1111, otId: 2222, species: 277, level: 20, hp: 50, maxHp: 60 })
writeMon(partyAddr + 100, { personality: 3333, otId: 2222, species: 25, level: 18, hp: 40, maxHp: 45 })

const party = [
  { personality: 1111, otId: 2222 },
  { personality: 3333, otId: 2222 }
]

// A stale duplicate of the party elsewhere (e.g. save block copy)
const staleAddr = 0x90000
writeMon(staleAddr, { personality: 1111, otId: 2222, species: 277, level: 20, hp: 50, maxHp: 60 })
writeMon(staleAddr + 100, { personality: 3333, otId: 2222, species: 25, level: 18, hp: 40, maxHp: 45 })

const { candidates, totalHits } = calibrateIn(heap, party)
assert.ok(totalHits >= 4)
assert.ok(candidates.includes(partyAddr))
assert.ok(candidates.includes(staleAddr))

// Reordered party (saved order differs from live memory order) still calibrates
const recal = calibrateIn(heap, [party[1], party[0]])
assert.ok(recal.candidates.includes(partyAddr))

// No enemy yet: nothing found
const known = new Set(party.map((p) => p.personality))
assert.equal(scanEnemiesIn(heap, candidates, (p) => known.has(p)).length, 0)

// Wild Zigzagoon (internal 288 -> national 263) appears at +600 (R/S/E layout)
writeMon(partyAddr + 600, { personality: 777777, otId: 888888, species: 288, level: 4, hp: 16, maxHp: 16 })
let found = scanEnemiesIn(heap, candidates, (p) => known.has(p))
assert.equal(found.length, 1)
assert.equal(found[0].nationalId, 263)

// Once seen, it stops appearing
known.add(777777)
assert.equal(scanEnemiesIn(heap, candidates, (p) => known.has(p)).length, 0)

// FR/LG layout: enemy at -600 also detected
writeMon(partyAddr - 600, { personality: 555555, otId: 888888, species: 25, level: 5, hp: 20, maxHp: 20 })
found = scanEnemiesIn(heap, candidates, (p) => known.has(p))
assert.equal(found.length, 1)
known.add(555555)

// Expansion-hack species pass sanity after masking (raw 0x399C -> 412)
writeMon(partyAddr + 600, { personality: 999999, otId: 888888, species: 0x399c, level: 3, hp: 15, maxHp: 15 })
found = scanEnemiesIn(heap, candidates, (p) => known.has(p))
assert.equal(found.length, 1)
assert.equal(found[0].maskedSpecies, 412)
known.add(999999)

// Deep scan finds an enemy at a NON-standard offset and reports the delta
writeMon(partyAddr + 1240, { personality: 424242, otId: 111, species: 304, level: 7, hp: 22, maxHp: 22 })
const deep = deepScanIn(heap, candidates, (p) => known.has(p))
const hit = deep.find((r) => r.mon.personality === 424242)
assert.ok(hit, 'deep scan found relocated enemy')
assert.equal(hit.mon.nationalId, 276) // internal 304 = Taillow
assert.equal(hit.offset, partyAddr + 1240)

// Single-mon party: direct hits must survive the candidate cap despite many
// equal-score shifted bases (regression: the cap once hid the live party)
const soloHeap = new Uint8Array(1 << 20)
const sdv = new DataView(soloHeap.buffer)
const soloWrite = (off, personality) => {
  sdv.setUint32(off, personality, true)
  sdv.setUint32(off + 4, 9999, true)
  const key = personality ^ 9999
  const plain = new Uint8Array(48)
  new DataView(plain.buffer).setUint16(ORDERS[personality % 24].indexOf('G') * 12, 25, true)
  for (let w = 0; w < 12; w++) {
    sdv.setUint32(off + 32 + w * 4, new DataView(plain.buffer).getUint32(w * 4, true) ^ key, true)
  }
  soloHeap[off + 84] = 10
  sdv.setUint16(off + 86, 30, true)
  sdv.setUint16(off + 88, 30, true)
}
for (const off of [0x10000, 0x20000, 0x30000, 0x40000, 0xe0000]) soloWrite(off, 42424242)
const solo = calibrateIn(soloHeap, [{ personality: 42424242, otId: 9999 }])
for (const off of [0x10000, 0x20000, 0x30000, 0x40000, 0xe0000]) {
  assert.ok(solo.candidates.includes(off), `direct hit 0x${off.toString(16)} kept`)
}

// ROM species-name table discovery (expansion stride 260) + lookup
const encode = (s) => {
  const out = []
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    if (c >= 65 && c <= 90) out.push(0xbb + c - 65)
    else if (c >= 97 && c <= 122) out.push(0xd5 + c - 97)
  }
  out.push(0xff)
  return out
}
const tableBase = 0xc0000
const put = (idx, name) => heap.set(encode(name), tableBase + (idx - 1) * 260)
put(1, 'Bulbasaur'); put(2, 'Ivysaur'); put(3, 'Venusaur'); put(412, 'Burmy'); put(959, 'Sandshrew')
const table = findSpeciesTableIn(heap)
assert.ok(table, 'species table located')
assert.equal(table.stride, 260)
assert.equal(speciesTableNameIn(heap, table, 412), 'Burmy')
assert.equal(speciesTableNameIn(heap, table, 959), 'Sandshrew')

console.log('gen3ram: all assertions passed')
