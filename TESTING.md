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

## Feedback loops

- In-app bug report button (captures console errors + environment) →
  files under `server/data/bugreports/`, readable in the admin dashboard.
- Radar Diagnostics panel, Deep scan, and heap dumps for memory-layout
  issues on unusual ROM hacks.
