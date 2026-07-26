---
name: radar-debug
description: Debug the Gen 3 encounter radar / live party sync when detection fails (diagnostics, deep scan, heap dump analysis)
---

# Debugging the encounter radar

The radar reads the mGBA WASM heap (`EJS_emulator.gameManager.Module.HEAPU8`).
It self-calibrates: scans for the synced party's (personality, otId) pairs,
then watches ±600 bytes (enemy party) around every candidate. Species names
come from the ROM's own table found in memory. No hardcoded addresses exist —
never add per-game or per-emulator addresses.

## Triage ladder (in order)

1. Ask the user for the radar **Diagnostics** text (expand it in the panel
   while a battle is on screen). Reading it:
   - `Calibrated (N party hits) — watching M locations`: N≈(party size ×
     copies in memory). M capped at 24; direct hits are rank-protected.
   - Probe lines `base 0x… ±600: species S, Lv L — valid mon ✓/not a mon`:
     a `valid mon ✓` during battle with no card ⇒ dedupe/enrichment bug in
     EncounterRadar.jsx. Never valid ⇒ enemy isn't at ±600 for this hack.
2. Have them press **Deep scan** DURING a battle: searches ±16KB around
   candidates, auto-learns non-standard offsets (≤±2400 only, capped at 12).
3. Have them press **Dump memory for analysis** during a battle → writes
   `server/data/dumps/heap-<ts>.bin` + `.json` meta (party anchors,
   candidates). Then analyze offline in node — reuse the PURE functions:
   ```js
   import { calibrateIn, scanEnemiesIn, deepScanIn, findSpeciesTableIn,
            speciesTableNameIn } from '<repo>/client/src/gen3ram.js'
   import { parseMonAt } from '<repo>/client/src/gen3save.js'
   // load the .bin as Uint8Array, meta party gives calibration anchors
   ```
   Checksum check to validate a decode: sum of the 24 decrypted u16 words
   (mod 0x10000) equals the u16 at struct offset 28.

## Known facts (validated on the host's hack)

- Struct layout/encryption/shuffle are VANILLA even in expansion hacks;
  substructure order = ORDERS[personality % 24]; key = personality ^ otId.
- Species u16 packs flags in bits 11-15: always mask `& 0x7FF`.
- Expansion species-info table: found by scanning for "Bulbasaur" in Gen 3
  text encoding; entry stride 260 (name embedded), vanilla names array
  stride 11. IDs are the hack's own enum — resolve names from the table,
  then map name → PokeAPI id for sprites (client does this already).
- Enemy party = player party ±600 (R/S/E: +600, FR/LG: −600). Stale copies
  of the party in the heap (save blocks, flash buffer) are expected and
  harmless — they're just extra watched addresses.
- After a save-state load, calibration is stale; the radar auto-recovers
  within ~5s (auto-start loop). Party sync reads the BATTERY SAVE, i.e. the
  state at the last in-game save, not live RAM.

## Regression tests

`npm test` covers calibration (incl. reordering + cap regression), ±600 scan,
masking, deep scan, and table discovery. Add a failing case there first when
fixing radar bugs.
