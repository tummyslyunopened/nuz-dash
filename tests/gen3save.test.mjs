// Synthetic-save unit test for the Gen 3 battery-save parser.
import assert from 'node:assert'
import { parseGen3Save, parsePCBoxes, internalToNational } from '../client/src/gen3save.js'

const buf = new Uint8Array(0x20000)
const dv = new DataView(buf.buffer)

// Build slot A: 14 valid sections, ids 0..13, saveIndex 5
for (let i = 0; i < 14; i++) {
  const off = i * 0x1000
  dv.setUint16(off + 0xff4, i, true) // section id
  dv.setUint32(off + 0xff8, 0x08012025, true) // signature
  dv.setUint32(off + 0xffc, 5, true) // save index
}
// Slot B left invalid (zeroed signatures)

// Section 0 (offset 0): game code -> nonzero+non-one = Emerald
dv.setUint32(0 + 0xac, 0xdeadbeef, true)
// Trainer id (u32 @ 0x0A) — wild mons carry this as OT (trainer-battle detection)
dv.setUint32(0 + 0x0a, 777001, true)

// Section 1 (offset 0x1000): party count 2 @0x234, party data @0x238
const sec1 = 0x1000
dv.setUint32(sec1 + 0x234, 2, true)

const ORDERS = [
  'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA',
  'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG',
  'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'
]

function writeMon(off, { personality, otId, nickBytes, species, level, hp, maxHp, ivWord = 0 }) {
  dv.setUint32(off, personality, true)
  dv.setUint32(off + 4, otId, true)
  buf.set(nickBytes, off + 8)
  const key = personality ^ otId
  const order = ORDERS[personality % 24]
  const plain = new Uint8Array(48)
  const pdv = new DataView(plain.buffer)
  pdv.setUint16(order.indexOf('G') * 12, species, true)
  pdv.setUint32(order.indexOf('M') * 12 + 4, ivWord, true)
  for (let w = 0; w < 12; w++) {
    dv.setUint32(off + 32 + w * 4, pdv.getUint32(w * 4, true) ^ key, true)
  }
  buf[off + 84] = level
  dv.setUint16(off + 86, hp, true)
  dv.setUint16(off + 88, maxHp, true)
}

// Mon 1: Treecko (internal 277 -> national 252), nickname "TREE"
writeMon(sec1 + 0x238, {
  personality: 305419896, // % 24 === 0 -> GAEM
  otId: 0x9abcdef0,
  nickBytes: [0xce, 0xcc, 0xbf, 0xbf, 0xff], // T R E E
  species: 277,
  level: 42, hp: 100, maxHp: 120
})
// Mon 2: Pikachu (internal 25 = national 25), fainted, order index 7
writeMon(sec1 + 0x238 + 100, {
  personality: 7, // AGME
  otId: 0x11112222,
  nickBytes: [0xff],
  species: 25,
  level: 13, hp: 0, maxHp: 33
})

const result = parseGen3Save(buf)
assert.equal(result.game, 'Emerald')
assert.equal(result.saveIndex, 5)
assert.equal(result.trainerId, 777001)
assert.equal(result.party.length, 2)
assert.equal(result.party[0].nationalId, 252)
assert.equal(result.party[0].nickname, 'TREE')
assert.equal(result.party[0].level, 42)
assert.equal(result.party[0].hp, 100)
assert.equal(result.party[0].status, null)
assert.equal(result.party[0].maskedSpecies, 277)
assert.equal(result.party[1].nationalId, 25)
assert.equal(result.party[1].hp, 0)
assert.equal(result.party[1].status, 'FNT')
assert.equal(internalToNational(411), 358) // Chimecho, last table entry
assert.equal(internalToNational(300), 275) // Shiftry
assert.equal(internalToNational(999), null) // hack species out of range

// Expansion-hack species: top bits are flags, low 11 bits the id
writeMon(sec1 + 0x238, {
  personality: 305419896, otId: 0x9abcdef0,
  nickBytes: [0xff],
  species: 0x399c, // 412 | 0x3800 -> Burmy in expansion hacks
  level: 3, hp: 15, maxHp: 15
})
assert.equal(parseGen3Save(buf).party[0].maskedSpecies, 412)

// FRLG offset path: switch game code to 1 and move party to 0x034
dv.setUint32(0 + 0xac, 1, true)
dv.setUint32(sec1 + 0x34, 1, true)
writeMon(sec1 + 0x38, {
  personality: 24, otId: 1, nickBytes: [0xff], species: 1, level: 5, hp: 20, maxHp: 20
})
const frlg = parseGen3Save(buf)
assert.equal(frlg.game, 'FireRed/LeafGreen')
assert.equal(frlg.party.length, 1)
assert.equal(frlg.party[0].nationalId, 1)

// ---- PC storage (sections 5-13 concatenated, 3968 data bytes each) ----
// Map a PokemonStorage offset to its location in the save file
const pcByte = (off) => (5 + Math.floor(off / 3968)) * 0x1000 + (off % 3968)
function writePCMon(storageOff, { personality, otId, nickBytes, species }) {
  const tmp = new Uint8Array(80)
  const tdv = new DataView(tmp.buffer)
  tdv.setUint32(0, personality, true)
  tdv.setUint32(4, otId, true)
  tmp.set(nickBytes, 8)
  const key = personality ^ otId
  const order = ORDERS[personality % 24]
  const plain = new Uint8Array(48)
  const pdv = new DataView(plain.buffer)
  pdv.setUint16(order.indexOf('G') * 12, species, true)
  for (let w = 0; w < 12; w++) tdv.setUint32(32 + w * 4, pdv.getUint32(w * 4, true) ^ key, true)
  for (let i = 0; i < 80; i++) buf[pcByte(storageOff + i)] = tmp[i]
}
dv.setUint32(5 * 0x1000, 1, true) // currentBox = 1
// Box 1 slot 0: Treecko
writePCMon(4, { personality: 305419896, otId: 1, nickBytes: [0xce, 0xcc, 0xbf, 0xbf, 0xff], species: 277 })
// Box 2 slot 19: Pikachu — this mon SPANS the section 5/6 boundary
writePCMon(4 + (30 + 19) * 80, { personality: 24, otId: 2, nickBytes: [0xff], species: 25 })
// Box 2 name "CAVE" (names live at storage offset 33604, inside section 13)
const nameBytes = [0xbd, 0xbb, 0xd0, 0xbf, 0xff] // C A V E
for (let i = 0; i < nameBytes.length; i++) buf[pcByte(33604 + 9 + i)] = nameBytes[i]

const pc = parsePCBoxes(buf)
assert.equal(pc.currentBox, 1)
assert.equal(pc.count, 2)
assert.equal(pc.boxes[0].mons.length, 1)
assert.equal(pc.boxes[0].mons[0].slot, 0)
assert.equal(pc.boxes[0].mons[0].nickname, 'TREE')
assert.equal(pc.boxes[0].mons[0].nationalId, 252)
assert.equal(pc.boxes[1].mons.length, 1)
assert.equal(pc.boxes[1].mons[0].slot, 19, 'boundary-spanning mon lands in the right slot')
assert.equal(pc.boxes[1].mons[0].nationalId, 25)
assert.equal(pc.boxes[1].name, 'CAVE')
assert.equal(pc.boxes[2].name, 'Box 3') // unnamed fallback

console.log('gen3save: all assertions passed')
