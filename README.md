# Nuz-Dash

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/cool-keen?referralCode=rQ5Jyn&utm_medium=integration&utm_source=template&utm_campaign=generic)
[![Sponsor](https://img.shields.io/badge/♡_Sponsor-tummyslyunopened-8b5cf6)](https://github.com/sponsors/tummyslyunopened)

A multiplayer Pokemon Nuzlocke run platform. Create a lobby, invite friends with a
link, and race runs side by side — emulator, tracker, and watch party in one screen.
No accounts: personal secret links are the only auth.

## Run it

```
npm install        # first time only
npm run build      # first time, and after code changes
npm start          # then open http://localhost:4517
```

For development with hot reload: `npm run dev` (client on http://localhost:5173).

## Features

- **Runs** for all 21 mainline games (Gen 1–9), each with dupes clause, shiny clause,
  and hardcore mode toggles.
- **Encounter tracker** — log the first encounter per location (caught / killed / fled /
  missed), with species autocomplete and sprites via PokeAPI. Dupes-clause warnings are
  evolution-family aware; shiny encounters are exempt when the shiny clause is on.
  Filter by Team / Graveyard / Failed; mark deaths with a cause note.
- **Hardcore level caps** — badge counter drives the current cap (gym ace levels,
  editable per run since community cap lists vary slightly).
- **Route map** — the app draws its own map: every location you log becomes a node
  (showing the encounter's sprite) connected in travel order and colored by status,
  with your current position highlighted. Drag nodes to match the region's shape,
  pre-place upcoming locations, right-click to reset/remove — the layout is saved per
  game and reused across runs. Optionally switch to an uploaded map image instead
  (stored in `server/data/uploads`) with click-to-place pins.
- **Type matchup lookup** — search any Pokemon or pick a type combo to see incoming
  damage multipliers (Gen 6+ chart).
- **Run diary** — freeform timestamped entries, optionally tagged with a location.
- **Built-in emulator (Play view)** — a self-hosted [EmulatorJS](https://emulatorjs.org)
  (GPLv3) with GB/GBC (gambatte), GBA (mGBA) and NDS (melonDS) cores vendored in
  `server/emulatorjs-data/`, so it works offline. **BYO ROM**: your own
  legally-dumped ROM (patched ROM hacks included) loads straight from your browser
  and never touches the server — see [BYO ROM](#byo-rom-the-default) below.
  Save states are in the emulator's own menu.
- **Encounter radar** — live wild-battle detection for Gen 3 games (vanilla and
  expansion-based hacks): the app finds the party bytes in the emulator's memory
  (self-calibrating, no hardcoded addresses), watches the enemy-party slot, and reads
  species names from the game's own ROM data — fakemon and forms included. Starts
  automatically once the party has synced and self-recovers after save-state loads.
  When a wild battle starts, a confirm card pops up — pick the location and hit
  Caught/Killed/Fled/Missed, or dismiss (trainer battles trigger it too).
- **Mobile play** — the emulator goes fullscreen on phones with touch controls,
  and a "Play on phone" QR button on the run page hops your session to mobile
  instantly (the QR encodes your secret link — scan it yourself only).
- **Auto backups & resume** — live-party auto-sync is on by default; every new
  in-game save it detects downloads a `.state` backup to your browser and updates
  the server-side auto-save, which loads automatically the next time you start the
  game. Manual save states live in the emulator's own menu.
- **Live party sync** — for Gen 3 (GBA) games and hacks that keep the stock save
  layout: save in-game, hit "Sync from game" (or enable 10s auto-sync), and the app
  parses the battery save directly — party species, nicknames, levels, HP, status,
  shinies. Newly-fainted Pokemon trigger a "mark dead in tracker" prompt, and any
  party member can be imported as a caught encounter with one click. A `.sav` file
  from a desktop emulator can be loaded manually too.

## Deploying / sharing beyond localhost

The server binds locally; to let friends join over the internet, put a Cloudflare
Tunnel in front of it:

```
cloudflared tunnel --url http://localhost:4517     # quick tunnel, random *.trycloudflare.com URL
```

Tunnels are managed from the admin dashboard (`http://localhost:4518`), which
supports two modes:

- **quick** — zero config, random `*.trycloudflare.com` URL that changes each start.
- **named** — a permanent hostname on a domain you manage on Cloudflare. In the
  admin tunnel panel: switch mode to *named*, set the tunnel name and hostname
  (e.g. `app.example.com` or the apex), click **Login to Cloudflare** (approve in
  the browser), then **Create tunnel & route DNS**, then start the tunnel. The
  server runs `cloudflared tunnel run` for you and every copied invite/member
  link uses the hostname.

### BYO ROM (the default)

Nuz-Dash never stores or serves ROM files by default. A ROM manager
"registers" the lobby's game by picking their file — only its name, size and
SHA-256 fingerprint are sent. Each runner then picks their own legally-dumped
copy in their browser: it boots straight into the emulator, is fingerprint-
checked against the lobby's registered game, and never leaves the browser
(optionally remembered per device in the browser's own storage).

Hosting ROMs on the server (classic hosted mode: upload once, served to every
lobby member) is an explicit opt-in in the admin dashboard, gated behind a
typed confirmation — by disabling BYO ROM the host takes sole responsibility
for storing and distributing those files. Re-enabling BYO ROM later deletes
stored ROM files (fingerprints are kept; save data is never touched).
Servers that already had lobbies before this feature keep hosted mode until
the admin opts in, so nothing breaks on upgrade.

Found a security issue? See [SECURITY.md](SECURITY.md) — report privately to
**bucket-pox-depose@duck.com** rather than opening a public issue.

Remember: secret links are the only auth, so share them like passwords.
Streaming? The app is streamer-safe by default: right after you open your
secret link, the address bar switches to a random decoy session URL
(`/s/…`) that only works in that browser — screenshots and stream VODs of
the URL bar leak nothing. Use the "Copy my secret link" button (off-screen)
when you actually need to share or bookmark the real link. Anyone
can rotate their own link at any time; minting a new link for *someone else*
(link recovery) requires the **link manager** permission — the lobby creator has
it by default and can grant it to other runners from the lobby page (shield
button), and the admin dashboard can always manage links regardless. Replacing
the shared lobby ROM works the same way via the **ROM manager** permission
(creator by default, gamepad button to deputize others, admin override).

## Onboarding site (nuzdash.dev)

`site/` holds the public landing/onboarding page — a single self-contained
`index.html` with the self-host guide, linking to the latest public GitHub
release for downloads. It is hosted on Cloudflare Pages (project `nuzdash`,
domain nuzdash.dev) and excluded from release source archives via
`.gitattributes` (`export-ignore`).

Deployment is automatic: a `pre-push` git hook (in `.githooks/`, activated
with `git config core.hooksPath .githooks`) publishes the site whenever a push
contains commits touching `site/`. Deploy failures never block a push. Manual
controls:

```
npm run site:preview   # deploy to the preview channel (safe, separate URL)
npm run site:deploy    # deploy to production (nuzdash.dev)
```

Both require wrangler on PATH and a one-time `wrangler login`. On Windows
ARM64, install it as `npm i -g wrangler@2 --ignore-scripts` (newer wrangler
crashes there — its workerd runtime has no ARM64-Windows build).

## Cloud hosting (Railway / Docker)

The repo ships a `Dockerfile` and `railway.json` for one-click-style cloud
deploys. Environment variables:

- `NUZ_DATA_DIR` — where all persistent data lives (default `server/data`;
  set it to a mounted volume in the cloud, e.g. `/data`).
- `PORT` — main app port (cloud platforms set this automatically).
- `ADMIN_TOKEN` — when set, the admin dashboard is ALSO mounted on the main
  app at `/admin` behind HTTP basic auth (user `admin`, password = the token).
  Needed on platforms that expose a single port; leave unset locally.

### Admin two-factor authentication (TOTP)

The admin dashboard supports authenticator-app 2FA (no password — reaching the
interface is the first factor):

- A cloud `/admin` mount **always** requires it: the first login after basic
  auth forces enrollment (QR + confirm code), and every later login asks for a
  code before any data is served.
- The localhost dashboard is open by default; tick *"require a code to open
  this dashboard"* in Server settings to enforce 2FA locally too.
- Brute-force protection: five failed codes trigger an exponential lockout
  (30 s doubling up to 15 min) that blocks even valid codes, comparisons are
  constant-time, and each code is accepted at most once (replay-proof).
- Manage it from Server settings: set up, re-enroll with a fresh secret, or
  disable (requires a current code). If the authenticator is lost, delete the
  `adminTotp` block from `settings.json` in your data dir and restart.

On a cloud host the platform provides the public URL — the Cloudflare tunnel
is unnecessary (ignore the tunnel panel). Railway deploys need a volume
mounted at `/data` and `ADMIN_TOKEN` set.

## Data

Everything lives in `server/data/` as JSON files (plus uploaded map images) — back up
that folder to keep your runs. PokeAPI responses are cached there too, so after a
location/species has been fetched once the app works offline for it.

## Testing

`npm test` runs the save-parser and radar unit suites. For what's actually
verified beyond that — API smoke coverage, play-tested surface, and known
gaps (notably iOS) — see [TESTING.md](TESTING.md).

## Legal

- **License:** Nuz-Dash is free software under the **GPLv3** (see [LICENSE](LICENSE)).
  It is provided **as-is, without warranty of any kind**. Bundled third-party
  components and their licenses are listed in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Game files:** Nuz-Dash ships no ROMs, and by default (BYO ROM) the server
  stores none either — each runner supplies their own legally-obtained copy in
  their browser, verified against a fingerprint. If a host explicitly opts into
  hosted-ROM mode, that lobby's ROM is served to its members so everyone runs
  the same patched game — intended for private groups where **each runner owns
  their own copy of the game**, and the host bears responsibility for that
  choice.
- **Affiliation:** Nuz-Dash is a fan-made tool, not affiliated with or endorsed by
  Nintendo, Game Freak, or The Pokemon Company. Pokemon names and sprites are their
  trademarks and copyrights.
- **AI disclosure:** Nuz-Dash is developed largely by an AI coding agent (Claude,
  by Anthropic) working under human direction — commits carry a `Co-Authored-By`
  trailer reflecting this. Bugs and design decisions are the maintainer's
  responsibility either way.
