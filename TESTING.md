# Testing status

An honest ledger of what has actually been verified, how, and what hasn't.
Nuz-Dash is a small-team hobby project — "tested" below means exactly what
each tier says, no more.

Run the automated tier with:

```
npm test
```

Development convention: destructive/API testing happens against a scratch
instance (`NUZ_DATA_DIR=<tmp> PORT=4621 ADMIN_PORT=4622 node server/server.js`),
never against live data.

## Tier 1 — Automated unit tests (run on every release)

`tests/gen3save.test.mjs` — Gen 3 battery-save parser:
- Section/slot layout, signatures, save-index slot selection
- Pokemon decryption (personality⊕OT key), substructure shuffle orders,
  checksum-relevant fields, Gen 3 text decoding
- Emerald and FireRed/LeafGreen party offsets
- PC storage (sections 5-13): box mons incl. one spanning a section
  boundary, box names + unnamed fallback, currentBox; ALSO verified against
  the maintainer's real expansion-hack sav (12 mons across 3 boxes,
  nicknames/species/slots all correct)
- Hoenn internal→national species table (spot checks incl. boundaries)
- Expansion-hack species masking (`& 0x7FF`)

`tests/gen3ram.test.mjs` — encounter radar memory scanning:
- Self-calibration from party bytes, incl. reordered parties and the
  candidate-cap regression (direct hits must survive ranking)
- Enemy detection at ±600 (both R/S/E and FR/LG layouts), dedupe by
  personality, junk-struct rejection
- Deep scan finding enemies at non-standard offsets with correct deltas
- Expansion species masking; ROM species-name table discovery (stride
  detection) and name lookup
- Live position: x/y read from SaveBlock1, DMA re-anchor (frozen stale
  header rejected via party-copy personality anchor, shifted block found
  nearby, wrong anchor → null)
- Global Hoenn grid: origin+local math, Route 101/Littleroot seam
  continuity, null for indoor/dungeon/Sootopolis maps

Additionally validated once against a **real 128MB heap dump** of a running
pokeemerald-expansion hack (calibration → detection → name resolution,
end-to-end). That artifact is user data and not part of the repo/CI.

## Tier 2 — API-verified via scripted smoke tests (during development)

Exercised with real HTTP calls against scratch instances; both success and
failure paths asserted:

- Auth: member-token requirement (401s), lobby-scoped reads, owner-only
  writes (cross-member mutation rejected), invalid-invite handling
- Lobby lifecycle: create, join, member link regeneration (old token dies,
  progress survives), lobby scoping of regeneration
- Single ROM per lobby: upload, in-place replace keeping the entry id,
  attempts auto-linking, unsupported-extension rejection
- Attempts: numbering, auto-archive of previous active, history listing
- Save architecture: auto state + battery sav round-trips, core-version
  gating (state refused after simulated core upgrade; sav unaffected),
  session guard full matrix (claim / conflict 409 / takeover / superseded
  pushes rejected on both sav and state), manual-state archiving
- History archive: write, listing, download (content-disposition), cap
  pruning (oldest-first, verified with a scaled-down cap), path-traversal
  rejection
- Streaming: frame push/fetch, lobby scoping, 404 on stale/unknown
- Admin: overview, lobby/member deletion cascades, bug report write/read/
  delete + filename validation, storage listing, settings toggle round-trip
  (incl. propagation to /api/me), tunnel config endpoints
- Permissions: link/ROM-manager enforcement (403s for non-managers, self-
  rotation open, grant/revoke, last-manager guard, creator protection,
  admin overrides) and the boot migrations (flags + creatorId to oldest
  member, independent healing)
- Admin 2FA: enrollment/confirm/verify with real TOTP codes, localhost
  toggle gating, brute-force lockout (429 incl. valid codes), replay
  rejection, secret persistence across restart, cloud /admin forced
  enrollment + basic-auth+code flow, unauthed re-setup/disable blocked
- ROM-clean mode: enable converts hosted ROM to a correct SHA-256
  fingerprint and deletes the file, upload/download gating both scopes,
  fingerprint registration (manager-only, id preserved), run serialization
  carries sha256/hosted, disable restores uploads keeping the entry id
- Trainer tracking: upsert grouping by OT id (same trainer appends mons,
  personality-deduped; new OT = new record), annotation (name/status/notes,
  invalid status rejected), owner-only writes vs lobby-wide reads, delete,
  missing-otId validation
- Live location: locateSaveBlock1In + readLocationIn on synthetic heaps
  (unit tests) AND on all four real heap dumps (consistent SaveBlock1
  address, Route 101 — matches that session); map-name table unit-tested
- Watch party backend: chat post/read/empty-rejection, presence flags in
  summary, stream frames with X-Stream-Meta round-tripping area+party via
  the meta endpoint, watcher tracking (frame fetch → watcher names in both
  stream meta and lobby summary)
- Live map positions: pos in stream meta → /api/lobby/positions round-trip
  (live entry with area/lead/at), junk pos rejected by the sanitizer
  (strings/oversized/object fields → no entry)
- BYO sav upload tagging: ?source=upload → run.sav.uploaded + .usav history
  entry (listed as type sav + uploaded:true); a following normal push
  clears the latest-uploaded flag and lists uploaded:false
- Static/serving: SPA fallback exclusions (emulator files 404 properly),
  sprite proxy, anonymous release downloads, full onboarding flow (site →
  zip → install → build → boot) once per major site change

## Tier 3 — Play-verified by the maintainer (single instance, small lobby)

Confirmed working in real play on the maintainer's desktop + phone, with a
pokeemerald-expansion Emerald hack:

- Emulator boot, ROM serving, controller bindings sync
- Encounter radar live detection (incl. the expansion species path) and
  auto-logging; fullscreen toasts
- Live party sync, save detection, server pair updates, backup history
  accumulation, auto-resume from battery save
- Mobile: responsive layout, fullscreen takeover + exit/re-enter,
  virtual gamepad
- Onboarding tour (auto-fire on fresh join)
- Cloudflare named tunnel + public instance; Railway template deploy
  (one deploy, by the maintainer)

## Tier 4 — Known gaps and untested areas

- **iOS/WebKit**: known compatibility problems under investigation
  (tabled). All iOS browsers share WebKit; suspect areas are WASM memory
  limits, `100dvh`/`aspect-ratio` on iOS < 15.4, and single-threaded core
  performance.
- **Vanilla Gen 3 games**: radar/party paths are covered by synthetic
  tests and design, but have not been play-tested against a real vanilla
  R/S/E/FR/LG ROM.
- **GB/GBC/NDS**: the emulator ships these cores, but deep integration
  (radar, party sync, auto-backups) is Gen 3/GBA-only by design; NDS
  performance in-browser is unvetted.
- **Multi-runner scale**: verified with 2 members; never load-tested with
  a full 8+ runner lobby streaming simultaneously.
- **Session takeover UX**: server logic fully API-tested; the two-device
  human flow has had limited real-world use.
- **Third-party Railway deploys**: template deployed once by the
  maintainer; no external deployer reports yet.
- **Desktop Firefox/Safari**: developed and play-tested on Chromium.
- **ROM-clean mode client path**: the browser side (object-URL emulator
  boot, in-browser SHA-256 verify, IndexedDB ROM cache reuse across
  reloads) is API-backed but has not been exercised in a real browser yet.
- **Streamer decoy URLs + join interstitial**: bundle builds and route
  logic reviewed; not yet click-tested end-to-end in a browser.
- **Live-location UI + false-detection button + trainers panel**: server
  and parsing layers are unit/dump/API-tested; the in-browser experience
  (📍 chip updating as you walk, toast button in mobile fullscreen,
  trainers panel filling during play) awaits real-play verification.
- **Group-24 dungeon map names**: best-effort vanilla ordering — floor
  ranges past Abandoned Ship are lower-confidence; wrong names are
  inline-editable and fall back to "Area g.n".
- **Stream crop + framerate in real play**: the content-bbox crop
  (letterbox/keypad removal), ~6fps feel over the tunnel, and the live
  party/area overlays need real multi-device play to verify; the crop
  heuristic's transition-frame handling (keep previous box) is untested
  against real fade-to-black battles.
- **Lobby hangout UX on phones**: new layout (watch grid + chat first)
  reviewed in code only.
- **Position pill + lobby live map + save pickers (browser side)**: the
  emulator-overlay pill (incl. post-save/post-battle DMA survival), the
  canvas live map (schematic region, sprite interpolation, indoor dimming),
  the .sav upload flow (validation preview, session-conflict 409 path), and
  the parsed-preview "Load a save" picker are server/unit-tested but await
  real-play verification.

## Feedback loops

- In-app bug report button (captures console errors + environment) →
  files under `server/data/bugreports/`, readable in the admin dashboard.
- Radar Diagnostics panel, Deep scan, and heap dumps for memory-layout
  issues on unusual ROM hacks.
