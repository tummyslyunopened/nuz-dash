# Nuz-Dash

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
  `server/emulatorjs-data/`, so it works offline. Upload your own legally-dumped ROM
  (patched ROM hacks included) per run — stored in `server/data/roms/`, served only to
  your browser. Save states are in the emulator's own menu.
- **Encounter radar** — live wild-battle detection for Gen 3 games (vanilla and
  expansion-based hacks): the app finds the party bytes in the emulator's memory
  (self-calibrating, no hardcoded addresses), watches the enemy-party slot, and reads
  species names from the game's own ROM data — fakemon and forms included. Starts
  automatically once the party has synced and self-recovers after save-state loads.
  When a wild battle starts, a confirm card pops up — pick the location and hit
  Caught/Killed/Fled/Missed, or dismiss (trainer battles trigger it too).
- **Auto backups** — live-party auto-sync is on by default; every new in-game save it
  detects triggers browser downloads of the battery save (.srm) and a save state
  (.state), so there's always a local recovery point.
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

Remember: secret links are the only auth, so share them like passwords.

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

On a cloud host the platform provides the public URL — the Cloudflare tunnel
is unnecessary (ignore the tunnel panel). Railway deploys need a volume
mounted at `/data` and `ADMIN_TOKEN` set.

## Data

Everything lives in `server/data/` as JSON files (plus uploaded map images) — back up
that folder to keep your runs. PokeAPI responses are cached there too, so after a
location/species has been fetched once the app works offline for it.
