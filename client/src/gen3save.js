// Gen 3 (Ruby/Sapphire/Emerald/FireRed/LeafGreen) battery-save parser.
// Reads the party straight out of a raw .sav — works for vanilla and for the
// many ROM hacks that keep the stock save layout. Checksums are deliberately
// not enforced so lightly-modified hacks still parse.
//
// Save layout: two 57KB slots of 14 × 4KB sections; the slot with the higher
// save counter is current. Each section footer: id @0xFF4, checksum @0xFF6,
// signature @0xFF8 (0x08012025), save index @0xFFC.

const SECTION_SIZE = 0x1000
const SECTIONS_PER_SLOT = 14
const SIGNATURE = 0x08012025

// Substructure order permutations, indexed by personality % 24
// (G=growth, A=attacks, E=EVs, M=misc)
const ORDERS = [
  'GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA',
  'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
  'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG',
  'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'
]

// Internal species IDs 277–411 → national dex (internal 1–251 are identical,
// 252–276 are Unown letterforms). Hack-added species above 411 have no mapping.
const HOENN_TO_NATIONAL = [
  252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266,
  267, 268, 269, 270, 271, 272, 273, 274, 275, 290, 291, 292, 276, 277, 285,
  286, 327, 278, 279, 283, 284, 320, 321, 300, 301, 352, 343, 344, 299, 324,
  302, 339, 340, 370, 341, 342, 349, 350, 318, 319, 328, 329, 330, 296, 297,
  309, 310, 322, 323, 363, 364, 365, 331, 332, 361, 362, 337, 338, 298, 325,
  326, 311, 312, 303, 307, 308, 333, 334, 360, 355, 356, 315, 287, 288, 289,
  316, 317, 357, 293, 294, 295, 366, 367, 368, 359, 353, 354, 336, 335, 369,
  304, 305, 306, 351, 313, 314, 345, 346, 347, 348, 280, 281, 282, 371, 372,
  373, 374, 375, 376, 377, 378, 379, 382, 383, 384, 380, 381, 385, 386, 358
]

export function internalToNational(internal) {
  if (internal >= 1 && internal <= 251) return internal
  if (internal >= 277 && internal <= 411) return HOENN_TO_NATIONAL[internal - 277]
  return null
}

// Western Gen 3 text encoding (the subset that appears in names)
function decodeGen3Text(bytes) {
  let out = ''
  for (const b of bytes) {
    if (b === 0xff) break
    if (b === 0x00) out += ' '
    else if (b >= 0xa1 && b <= 0xaa) out += String.fromCharCode(48 + (b - 0xa1))
    else if (b >= 0xbb && b <= 0xd4) out += String.fromCharCode(65 + (b - 0xbb))
    else if (b >= 0xd5 && b <= 0xee) out += String.fromCharCode(97 + (b - 0xd5))
    else if (b === 0xab) out += '!'
    else if (b === 0xac) out += '?'
    else if (b === 0xad) out += '.'
    else if (b === 0xae) out += '-'
    else if (b === 0xb5) out += '♂'
    else if (b === 0xb6) out += '♀'
    else if (b === 0xb8) out += ','
    else if (b === 0xba) out += '/'
  }
  return out.trim()
}

function statusText(statusWord) {
  if (statusWord & 0x07) return 'SLP'
  if (statusWord & 0x08) return 'PSN'
  if (statusWord & 0x10) return 'BRN'
  if (statusWord & 0x20) return 'FRZ'
  if (statusWord & 0x40) return 'PAR'
  if (statusWord & 0x80) return 'PSN'
  return null
}

function readSlot(dv, base) {
  const sections = {}
  let saveIndex = null
  for (let i = 0; i < SECTIONS_PER_SLOT; i++) {
    const off = base + i * SECTION_SIZE
    if (dv.getUint32(off + 0xff8, true) !== SIGNATURE) return null
    sections[dv.getUint16(off + 0xff4, true)] = off
    saveIndex = dv.getUint32(off + 0xffc, true)
  }
  return { sections, saveIndex }
}

export function parseMonAt(dv, u8, off) {
  return parseMon(dv, u8, off)
}

// The 80-byte "box" portion shared by party and PC mons: header (personality,
// OT, nickname) + the encrypted/shuffled 48-byte substructure block. Party
// mons append 20 bytes of battle stats on top; PC mons are exactly this.
function parseBoxMonCore(dv, u8, off) {
  const personality = dv.getUint32(off, true)
  const otId = dv.getUint32(off + 4, true)
  if (personality === 0 && otId === 0) return null

  const nickname = decodeGen3Text(u8.subarray(off + 8, off + 18))
  const key = personality ^ otId

  // Decrypt the 48-byte data block (12 XORed little-endian words)
  const data = new Uint8Array(48)
  const ddv = new DataView(data.buffer)
  for (let w = 0; w < 12; w++) {
    ddv.setUint32(w * 4, dv.getUint32(off + 32 + w * 4, true) ^ key, true)
  }

  const order = ORDERS[personality % 24]
  const growthOff = order.indexOf('G') * 12
  const miscOff = order.indexOf('M') * 12
  const internalSpecies = ddv.getUint16(growthOff, true)
  if (internalSpecies === 0) return null
  const ivWord = ddv.getUint32(miscOff + 4, true)

  return {
    personality,
    otId,
    nickname,
    internalSpecies,
    // Expansion-based hacks pack flags into the top bits of the species field;
    // the low 11 bits are the actual species id (harmless for vanilla ids).
    maskedSpecies: internalSpecies & 0x7ff,
    nationalId: internalToNational(internalSpecies),
    isEgg: !!((ivWord >> 30) & 1),
    shiny: (((otId & 0xffff) ^ (otId >>> 16)) ^ ((personality & 0xffff) ^ (personality >>> 16))) < 8
  }
}

function parseMon(dv, u8, off) {
  const core = parseBoxMonCore(dv, u8, off)
  if (!core) return null
  const statusWord = dv.getUint32(off + 80, true)
  const hp = dv.getUint16(off + 86, true)
  return {
    ...core,
    level: u8[off + 84],
    hp,
    maxHp: dv.getUint16(off + 88, true),
    status: hp > 0 ? statusText(statusWord) : 'FNT'
  }
}

function pickCurrentSlot(u8) {
  if (u8.length < SECTION_SIZE * SECTIONS_PER_SLOT) {
    throw new Error(`Not a Gen 3 save (${u8.length} bytes — expected at least 57KB)`)
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const slots = [readSlot(dv, 0)]
  if (u8.length >= 0xe000 * 2) slots.push(readSlot(dv, 0xe000))
  const valid = slots.filter(Boolean)
  if (!valid.length) throw new Error('No valid Gen 3 save data found (bad section signatures)')
  // 0xFFFFFFFF marks a never-used slot
  const slot = valid
    .filter((s) => s.saveIndex !== 0xffffffff)
    .sort((a, b) => b.saveIndex - a.saveIndex)[0] || valid[0]
  return { slot, dv }
}

export function parseGen3Save(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const { slot, dv } = pickCurrentSlot(u8)

  const sec0 = slot.sections[0]
  const sec1 = slot.sections[1]
  if (sec0 === undefined || sec1 === undefined) throw new Error('Save is missing trainer/team sections')

  const gameCode = dv.getUint32(sec0 + 0xac, true)
  const game = gameCode === 0 ? 'Ruby/Sapphire' : gameCode === 1 ? 'FireRed/LeafGreen' : 'Emerald'
  const partyBase = gameCode === 1 ? 0x034 : 0x234
  // TrainerInfo: playerName[8], gender, unused, then trainer id u32 @ 0x0A.
  // Wild mons are created with THIS id as their OT — the basis for telling
  // wild encounters from trainer battles.
  const trainerId = dv.getUint32(sec0 + 0x0a, true)

  const count = Math.min(dv.getUint32(sec1 + partyBase, true), 6)
  const party = []
  for (let i = 0; i < count; i++) {
    const mon = parseMon(dv, u8, sec1 + partyBase + 4 + i * 100)
    if (mon) party.push(mon)
  }
  return {
    game,
    saveIndex: slot.saveIndex,
    trainerId,
    party,
    // Section 1 IS the start of SaveBlock1: pos.x/y (two s16) then the warp
    // location — mapGroup/mapNum. This is the save-time location; the LIVE
    // location comes from finding SaveBlock1 in emulator memory (gen3ram).
    location: { mapGroup: u8[sec1 + 4], mapNum: u8[sec1 + 5] },
    // Offset of party mon 0 within SaveBlock1 — the anchor that lets the
    // radar derive SaveBlock1's live address from its calibrated party hits.
    partyMonsOffset: partyBase + 4
  }
}

// ---------------------------------------------------------------------------
// PC storage (PokemonStorage): spans save sections 5-13, concatenated in
// section-id order. Layout: currentBox u32, then 14 boxes x 30 slots x
// 80-byte BoxPokemon, then 14 x 9-byte box names, then 14 wallpaper bytes =
// 33744 bytes total (8 full 3968-byte sections + 2000 from section 13).

const PC_SIZE = 33744
const PC_BOXES = 14
const PC_SLOTS = 30
const PC_BOXES_OFF = 4
const PC_NAMES_OFF = PC_BOXES_OFF + PC_BOXES * PC_SLOTS * 80

export function parsePCBoxes(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const { slot } = pickCurrentSlot(u8)
  const storage = new Uint8Array(PC_SIZE)
  let p = 0
  for (let id = 5; id <= 13 && p < PC_SIZE; id++) {
    const off = slot.sections[id]
    if (off === undefined) throw new Error(`PC storage section ${id} missing from the save`)
    const take = Math.min(3968, PC_SIZE - p)
    storage.set(u8.subarray(off, off + take), p)
    p += take
  }
  const sdv = new DataView(storage.buffer)
  const currentBox = sdv.getUint32(0, true)
  const boxes = []
  let count = 0
  for (let b = 0; b < PC_BOXES; b++) {
    const name = decodeGen3Text(storage.subarray(PC_NAMES_OFF + b * 9, PC_NAMES_OFF + b * 9 + 9)) || `Box ${b + 1}`
    const mons = []
    for (let s = 0; s < PC_SLOTS; s++) {
      const mon = parseBoxMonCore(sdv, storage, PC_BOXES_OFF + (b * PC_SLOTS + s) * 80)
      if (mon) mons.push({ slot: s, ...mon })
    }
    count += mons.length
    boxes.push({ name, mons })
  }
  return { currentBox: currentBox < PC_BOXES ? currentBox : 0, boxes, count }
}
