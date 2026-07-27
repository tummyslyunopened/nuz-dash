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
