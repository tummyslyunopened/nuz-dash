// Vanilla Emerald (mapGroup, mapNum) → area name. This is game-constant DATA
// (like the Hoenn→national dex table), not a memory address — Emerald-based
// hacks overwhelmingly keep these map slots for the standard routes/areas.
// Multi-floor dungeons collapse to ONE area name on purpose: Nuzlocke rules
// (dupes clause, one-catch-per-area) operate on areas, not floors.
// Unknown maps fall back to `Area group.num`, editable inline in the tracker.

// Group 0: towns, cities, routes, underwater routes (order is fixed in-game)
const GROUP0 = [
  'Petalburg City', 'Slateport City', 'Mauville City', 'Rustboro City',
  'Fortree City', 'Lilycove City', 'Mossdeep City', 'Sootopolis City',
  'Ever Grande City', 'Littleroot Town', 'Oldale Town', 'Dewford Town',
  'Lavaridge Town', 'Fallarbor Town', 'Verdanturf Town', 'Pacifidlog Town'
]
// nums 16..49 are Route 101..134; 50..56 are underwater maps
const UNDERWATER0 = [
  'Underwater (Route 124)', 'Underwater (Route 126)', 'Underwater (Route 127)',
  'Underwater (Route 128)', 'Underwater (Route 129)', 'Underwater (Route 105)',
  'Underwater (Route 125)'
]

// Group 24 (dungeons), collapsed to areas. Best-effort vanilla ordering —
// entries past the well-known ones fall through to the generic label.
const GROUP24_RANGES = [
  [0, 3, 'Meteor Falls'],
  [4, 4, 'Rusturf Tunnel'],
  [5, 5, 'Underwater (Sootopolis)'],
  [6, 6, 'Desert Ruins'],
  [7, 10, 'Granite Cave'],
  [11, 11, 'Petalburg Woods'],
  [12, 12, 'Mt. Chimney'],
  [13, 13, 'Jagged Pass'],
  [14, 14, 'Fiery Path'],
  [15, 22, 'Mt. Pyre'],
  [23, 25, 'Aqua Hideout'],
  [26, 26, 'Underwater (Seafloor Cavern)'],
  [27, 36, 'Seafloor Cavern'],
  [37, 42, 'Cave of Origin'],
  [43, 45, 'Victory Road'],
  [46, 51, 'Shoal Cave'],
  [52, 53, 'New Mauville'],
  [54, 66, 'Abandoned Ship'],
  [67, 67, 'Island Cave'],
  [68, 68, 'Ancient Tomb'],
  [69, 69, 'Underwater (Route 134)'],
  [70, 70, 'Underwater (Sealed Chamber)'],
  [71, 72, 'Sealed Chamber'],
  [73, 73, 'Scorched Slab'],
  [77, 84, 'Sky Pillar'],
  [85, 85, 'Magma Hideout']
]

export function mapAreaName(group, num) {
  if (group === 0) {
    if (num >= 0 && num <= 15) return GROUP0[num]
    if (num >= 16 && num <= 49) return `Route ${101 + (num - 16)}`
    if (num >= 50 && num <= 56) return UNDERWATER0[num - 50]
    return null
  }
  if (group === 24) {
    for (const [lo, hi, name] of GROUP24_RANGES) {
      if (num >= lo && num <= hi) return name
    }
    return null
  }
  if (group === 26 && num >= 0 && num <= 3) return 'Safari Zone'
  return null
}

// Display helper: named area, or a raw-but-stable fallback the runner can
// rename inline in the tracker.
export function areaLabel(group, num) {
  return mapAreaName(group, num) || `Area ${group}.${num}`
}

// Global Hoenn tile grid: each group-0 overworld map's origin, computed by
// stitching vanilla Emerald's map-connection graph (pret/pokeemerald
// data/maps/*/map.json, BFS from Littleroot, shifted non-negative — world is
// 800x383 tiles). Same vanilla-constants caveat as the names above. Three
// map pairs (Verdanturf/R116, Fallarbor/R114, Dewford/R107) have reciprocal
// connections that disagree by 2 tiles in the game's own data; BFS order
// picked one. Sootopolis (0.7) has no land connections — no global position.
// Keyed by mapNum (group 0 only); indoor/dungeon maps have no global origin.
// Entries are [ox, oy, width, height] — dims come from the game's layouts
// and let the lobby live-map draw the region as a schematic.
const OVERWORLD_ORIGINS = {
  0: [40, 232, 30, 30],   // Petalburg City
  1: [200, 260, 40, 60],  // Slateport City
  2: [200, 140, 40, 20],  // Mauville City
  3: [0, 122, 40, 60],    // Rustboro City
  4: [320, 0, 40, 20],    // Fortree City
  5: [480, 70, 80, 40],   // Lilycove City
  6: [640, 100, 80, 40],  // Mossdeep City
  8: [760, 180, 40, 80],  // Ever Grande City
  9: [120, 282, 20, 20],  // Littleroot Town
  10: [120, 242, 20, 20], // Oldale Town
  11: [60, 362, 20, 20],  // Dewford Town
  12: [140, 60, 20, 20],  // Lavaridge Town
  13: [80, 0, 20, 20],    // Fallarbor Town
  14: [120, 140, 20, 20], // Verdanturf Town
  15: [480, 260, 20, 40], // Pacifidlog Town
  16: [120, 262, 20, 20], // Route 101
  17: [70, 242, 50, 20],  // Route 102
  18: [120, 220, 80, 22], // Route 103
  19: [0, 182, 40, 80],   // Route 104
  20: [0, 262, 40, 80],   // Route 105
  21: [0, 342, 80, 20],   // Route 106
  22: [80, 360, 60, 20],  // Route 107
  23: [140, 360, 60, 20], // Route 108
  24: [200, 320, 40, 63], // Route 109
  25: [200, 160, 40, 100],// Route 110
  26: [200, 0, 40, 140],  // Route 111
  27: [160, 20, 40, 60],  // Route 112
  28: [100, 0, 100, 20],  // Route 113
  29: [40, 2, 40, 80],    // Route 114
  30: [0, 42, 40, 80],    // Route 115
  31: [40, 122, 100, 20], // Route 116
  32: [140, 140, 60, 20], // Route 117
  33: [240, 140, 80, 20], // Route 118
  34: [280, 0, 40, 140],  // Route 119
  35: [360, 0, 40, 100],  // Route 120
  36: [400, 80, 80, 20],  // Route 121
  37: [420, 100, 40, 40], // Route 122
  38: [320, 140, 140, 20],// Route 123
  39: [560, 60, 80, 80],  // Route 124
  40: [640, 60, 80, 40],  // Route 125
  41: [560, 140, 80, 80], // Route 126
  42: [640, 140, 80, 80], // Route 127
  43: [640, 220, 120, 40],// Route 128
  44: [640, 260, 80, 40], // Route 129
  45: [560, 260, 80, 40], // Route 130
  46: [500, 260, 60, 40], // Route 131
  47: [400, 260, 80, 40], // Route 132
  48: [320, 260, 80, 40], // Route 133
  49: [240, 260, 80, 40]  // Route 134
}

// The stitched world's bounding box (tiles) — for scaling the live-map canvas.
export const WORLD_SIZE = { w: 800, h: 383 }

// Everything the live map needs to draw the region: one rect per overworld
// map, plus its display name and whether it's a town/city (nums 0-15).
export function overworldMaps() {
  return Object.entries(OVERWORLD_ORIGINS).map(([num, [x, y, w, h]]) => ({
    num: Number(num), x, y, w, h,
    town: Number(num) <= 15,
    name: mapAreaName(0, Number(num))
  }))
}

// Map-local player position → global Hoenn tile position, or null when the
// map isn't part of the stitched overworld (indoors, caves, Sootopolis).
export function globalPosition(group, num, x, y) {
  if (group !== 0) return null
  const o = OVERWORLD_ORIGINS[num]
  if (!o) return null
  return { gx: o[0] + x, gy: o[1] + y }
}
