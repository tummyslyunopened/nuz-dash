# Nuz-Dash — agent guide

Multiplayer Pokemon Nuzlocke platform: browser emulator + auto-tracking + watch
party. One machine hosts (this one); players join via secret links. No accounts.

> **Read `CLAUDE.local.md` first when working on the primary dev machine** —
> it holds host-machine gotchas (Windows ARM64, PATH refresh, wrangler pin),
> tunnel hostnames, and account specifics. It is gitignored; keep it that way.

## Architecture

Two-process-free monolith: `server/server.js` (Express, ESM) serves the API, the
built client (`dist/`), vendored EmulatorJS, AND an admin app on a second port.

- **Main app**: `http://localhost:4517`, optionally public via the built-in
  Cloudflare tunnel manager (quick or named mode; auto-start in settings).
  Onboarding site: **nuzdash.dev** (Cloudflare Pages, source in `site/`).
- **Admin app**: `http://localhost:4518`, bound 127.0.0.1 ONLY (never tunneled).
  `server/admin.html` (vanilla JS). Manages lobbies/members/bug reports/tunnel.

### Data model (JSON stores in `server/data/`, see `server/store.js`)

- `lobbies.json`: lobby { id, name, inviteToken, roms:[max ONE rom] }. Upload
  replaces the rom in place keeping its id (attempts stay linked).
- `members.json`: member { id, token, lobbyId, name, controls, linkManager,
  romManager }. **token in the URL /m/<token> IS the auth** — sent as
  `X-Member-Token` header (or `?token=` query for fetches that can't set
  headers: EmulatorJS ROM fetch). Link recovery: anyone can rotate their OWN
  token; regenerating ANOTHER member's token requires `linkManager` (lobby
  creator gets it at creation; a boot migration grants it to each lobby's
  oldest member; managers grant/revoke via POST /api/members/:id/link-manager
  with a last-manager guard; the admin dashboard can always override).
  `romManager` follows the exact same model (creator default, same migration,
  POST /api/members/:id/rom-manager) and gates replacing the SHARED lobby ROM
  (POST /api/lobby/roms and POST /api/runs/:id/rom); unlinking a ROM from your
  own attempt (DELETE /api/runs/:id/rom) stays open to everyone. The CREATOR
  is protected: `lobby.creatorId` (set at creation, healed by the migration to
  the oldest member) blocks lobby-side changes to the creator's permissions
  and lobby-side regeneration of the creator's link — admin dashboard only
  (creator self-rotation still allowed).
- `runs.json`: a "run" = one ATTEMPT { memberId, lobbyId, attemptNumber, status
  active|archived, gameId, romId, rules, badges, caps, states meta }. One active
  per member; POST /api/runs archives the previous active.
- `encounters.json` / `diary.json`: keyed by runId.
- `maps.json`: keyed `` `${lobbyId}|${gameId}` `` (image + pins + nodes).
- `settings.json`: { autoTunnel, tunnelMode quick|named, tunnelName,
  tunnelHostname, localStateDownloads, adminTotp { secret base32, requireLocal,
  lastCounter } }. adminTotp powers admin 2FA (RFC 6238, no deps, qrcode pkg
  for enrollment QR): cloud /admin ALWAYS requires it and forces enrollment on
  first login; localhost enforcement is the requireLocal toggle. Session =
  HttpOnly cookie (in-memory Map, 12h). Brute force: GLOBAL fail counter, 5
  free tries then exponential lockout 30s→15min (valid codes also rejected
  while locked); timingSafeEqual compares; lastCounter makes codes single-use
  (replay = failure). Pending setup secret is memory-only until confirmed.
  Lost authenticator: delete adminTotp from settings.json + restart.
- Binary dirs under server/data: roms/, states/ (`<runId>-<slot>.state`, slots
  1,2,3,auto), sprites/ (proxy cache), dumps/ (heap dumps), bugreports/.
- Save-state "auto" slot: written ONLY when the live-party sync detects a new
  in-game save (save counter increment); it auto-loads on every game start.
  Manual slots 1-3 exist in the API but have no UI — the emulator's own menu
  covers manual states. Local auto-downloads are .state files only.
  CRITICAL nuance: savestates do NOT reliably include SRAM, so the battery
  save is ALSO backed up server-side (POST/GET /api/runs/:id/sav) on each
  detected save, and restored into the emulator FS on boot BEFORE the state
  loads — without it the party scanner/radar starve until the first new
  in-game save of the session.
- **Game-data reliability invariants** (do not weaken): the battery save (.sav)
  is the SOURCE OF TRUTH — everything correctness-critical parses it, and
  AUTO-RESUME RESTORES THE SAV ONLY (title screen → Continue, like real
  hardware). States are archive/manual-use artifacts, never auto-loaded.
  States are stamped with EMU_CORE_VERSION on write and refused on read if it
  mismatches — BUMP that constant in server.js whenever the vendored
  EmulatorJS cores are upgraded. All binary writes (sav/state/history/ROM) go
  through writeAtomic. The session's first party sync seeds the server pair.
  A single-session guard (X-Nuz-Session header + /api/runs/:id/session
  heartbeat) makes the server reject sav/state pushes from superseded
  sessions — prevents branching save lineages from concurrent tabs/devices.
  Launch UX: the Start button is a picker (latest sav default / any
  historical sav / fresh boot); post-start "Load a save" writes a chosen sav
  into the emulator FS and calls gameManager.restart() → title screen —
  the recovery path when boot restore fails (stale browser state).
- Live streams: in-memory Map only (memberId → jpeg frame), never persisted.

### Client (`client/`, React + Vite, no TS)

- Routes: `/` Landing, `/join/:invite`; `/m/:token(/run/:id|/view/:memberId)`
  are ENTRY-ONLY — TokenEntry mints a decoy sid (localStorage `nuz-sids`,
  in-memory overlay for private mode) and replace-redirects to the real UI
  tree `/s/:sid(/run/:id|/view/:memberId)` (LobbyHome / RunPage / Spectator)
  so streams never show the secret. `MemberScope` resolves sid→token
  (device-local, never sent to the server; unknown sid → `/`). NEVER put the
  member token in an internal route path — real-token flows (copy-secret
  chip, QR launch, share URLs) read `memberToken` from api.js instead;
  `forgetLink` also drops the token's sids.
- `api.js`: fetch helpers + auth header + STATUS_META + localStorage lobby links.
- Key components: EmulatorPanel (EmulatorJS boot, state slots, streaming
  broadcast, controller sync, auto-resume), LivePartyPanel (save polling,
  faint alerts, auto backups), EncounterRadar (live memory scanning),
  WatchPartyPanel, StreamView, MapPanel/RouteMap, EncountersPanel, BugReportButton.
- **Design system**: purple tokens in styles.css (`--accent:#8b5cf6` etc.).
  Status colors are FIXED (good #0ca30c / warning #fab219 / serious #ec835a /
  critical #d03b3b) — never retheme them; always pair color with icon+label.
  Icons: lucide-react. Form-control CSS is scoped `:where(:not(#ejs-mount *))`
  so it never leaks into EmulatorJS UI — keep any new global element styles
  scoped the same way.

### Emulator integration (the tricky part)

- EmulatorJS v4.2.3 vendored in `server/emulatorjs-data/` (runtime + gambatte/
  mgba/melonds cores incl. -thread/-legacy variants). Served at `/emulatorjs`.
  The SPA fallback regex MUST keep excluding `/emulatorjs` or missing files get
  index.html and the emulator breaks mysteriously.
- Boot: set `window.EJS_*` globals then inject `/emulatorjs/loader.js`. Emulator
  can't be torn down — panels stay mounted and views hide via CSS.
- **EmulatorJS event gotcha**: registering `EJS_onSaveState` / `EJS_onLoadState`
  / `EJS_onLoadSave` SUPPRESSES the emulator's default handling of those
  actions (`callEvent(...) > 0` short-circuits). Our save hook therefore
  replicates the local download itself; load detection is done by monkey-
  patching `gameManager.loadState`/`loadSaveFiles` (fires `nuz:memory-reset`,
  which re-syncs the party and recalibrates the radar). Do NOT add interval-
  based auto-STATES (EJS offers flavors of this) — checkpoints anchor to
  in-game saves only; that decision is settled.
- **Mobile fullscreen rule**: any prompt (confirm/permission/download priming/
  new dialogs of ANY kind) must fully resolve BEFORE `enterMobileFullscreen()`
  — a dialog appearing over fullscreen breaks it. When adding features that
  prompt, sequence them ahead of fullscreen entry in start(), or defer them
  until fullscreen exits (like the radar's info-only toasts).
- gameManager API (on `window.EJS_emulator.gameManager`): `getState()` (sync
  Uint8Array), `loadState(bytes)`, `getSaveFile()` (battery save),
  `Module.HEAPU8` (entire WASM heap — basis of the radar).
- **Gen 3 parsing** (`client/src/gen3save.js`): battery save → party. Vanilla
  encryption/shuffle (checksum-verified in analysis); substructure order =
  personality % 24; species field masks `& 0x7FF` (expansion hacks pack flags
  in top bits).
- **Radar** (`client/src/gen3ram.js`): self-calibrating — scans heap for synced
  party (personality,otId) pairs; enemy party is ±600 bytes from player party;
  species names read from the ROM's own table in memory (find "Bulbasaur",
  stride 260 = pokeemerald-expansion gSpeciesInfo, 11 = vanilla names array).
  NO hardcoded emulator or per-game addresses — keep it that way.
  Detections AUTO-LOG with no confirmation (status "missed", blank location,
  wild-mon personality stored); annotation happens inline in the Encounters
  table. Catches self-annotate: the party sync matches new party members'
  personality against auto-logged encounters and flips them to "caught".
  Trainer battles are distinguished by OT id: wild mons carry the PLAYER's
  trainer id (save TrainerInfo u32 @0x0A) as their OT — validated on a real
  heap dump; mismatched OT = trainer's mon, acknowledged but never logged.
  In mobile fullscreen, detections show info-only toasts portaled INTO
  #ejs-wrap (native fullscreen renders only descendants).
- Expansion-hack species enums are the hack's own (often natdex-ordered with
  forms appended) — never assume PokeAPI ids match; resolve via the ROM table.
- Debug tools already built in: radar Diagnostics panel, Deep scan (during
  battle), heap dump → `server/data/dumps/` (+ meta json). Past analysis
  scripts pattern: load dump in node, reuse gen3ram/gen3save pure functions
  (`calibrateIn`, `scanEnemiesIn`, `parseMonAt`, `findSpeciesTableIn`).

## Commands

```
npm run build         # build client to dist/ (needed before restart if client changed)
npm start             # server (main 4517 + admin 4518 + tunnel if autoTunnel)
npm run dev           # vite dev on 5173 + server (proxy in vite.config.js)
npm test              # unit tests for save parser + radar (tests/)
npm run site:preview  # deploy onboarding site to preview channel (safe)
npm run site:deploy   # deploy onboarding site to production (nuzdash.dev)
node tools/serve-site.mjs   # local site preview on 8790
```

## Workflows

- **Release** (see `release` skill): commit → tag vX.Y.Z → push --tags →
  `git archive` zip → `gh release create`. `.gitattributes` export-ignores
  `site/` so releases never contain the site. Site download buttons point at
  `releases/latest` — no per-release site edits needed.
- **Site deploys**: pre-push hook (`.githooks/`, hooksPath configured) publishes
  automatically when pushed commits touch `site/`. Never blocks the push.
- **Server data changes**: stores load at boot; ad-hoc edits to server/data
  JSON while the server runs get clobbered on next save. Startup migrations
  live near the top of server.js (single-user→lobby, multi-rom→single-rom).
- **Verifying changes**: API smoke tests via PowerShell Invoke-RestMethod work
  well (create lobby → member token → exercise endpoints → delete). WASM/
  emulator behavior can't be tested headless — ask the user to check and report
  the radar Diagnostics text or a bug report (admin dashboard shows them).
  TESTING.md is the honest ledger of verified vs untested surface — update it
  when coverage genuinely changes (both directions).

## Conventions & cautions

- ROMs are copyrighted: `server/data/` is gitignored — never commit or upload
  its contents anywhere.
- Commit messages end with the Co-Authored-By Claude trailer; commit/push only
  when the user asks.
- Auth checks live server-side in `requireMember` + `ownRun`/`findRun` helpers:
  reads are lobby-wide (spectating), writes are owner-only. Keep new endpoints
  consistent.
- Secret tokens must never appear in logs/bug reports (diagnostics.js redacts)
  or in <img> URLs (StreamView fetches with headers + object URLs).
- GitHub repo: `tummyslyunopened/nuz-dash` (public). Releases via `gh` CLI.
- `CLAUDE.local.md` and `server/data/` are private — never commit them or echo
  their contents into committed files, release notes, or the public site.
