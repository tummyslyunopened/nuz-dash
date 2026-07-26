# Third-party notices

Nuz-Dash is licensed under GPLv3 (see LICENSE). It redistributes or depends on
the following third-party software and services.

## Vendored (redistributed in this repository and releases)

- **EmulatorJS** v4.2.3 — `server/emulatorjs-data/` (runtime, UI, loader).
  License: **GPLv3**. Source: https://github.com/EmulatorJS/EmulatorJS
  The vendored files are unmodified copies from the official v4.2.3 release.
- **Libretro cores** (emscripten builds bundled with the EmulatorJS release,
  in `server/emulatorjs-data/cores/`):
  - **gambatte** (Game Boy / Game Boy Color) — GPLv2 —
    https://github.com/libretro/gambatte-libretro
  - **mGBA** (Game Boy Advance) — MPL-2.0 —
    https://github.com/mgba-emu/mgba
  - **melonDS** (Nintendo DS) — GPLv3 —
    https://github.com/melonDS-emu/melonDS

## npm dependencies (bundled into built client / server at deploy time)

- **express** — MIT — https://github.com/expressjs/express
- **react**, **react-dom** — MIT — https://github.com/facebook/react
- **react-router-dom** — MIT — https://github.com/remix-run/react-router
- **lucide-react** — ISC — https://github.com/lucide-icons/lucide

## Runtime services (not redistributed)

- **PokeAPI** — Pokemon species data and sprites are fetched at runtime and
  cached locally. https://pokeapi.co — used under PokeAPI's fair use policy,
  with thanks.
- **Cloudflare cloudflared** — optional tunnel binary, downloaded separately
  by the host (Apache-2.0). https://github.com/cloudflare/cloudflared

## Trademarks

Pokemon and all related names and sprites are trademarks and copyrights of
Nintendo, Game Freak, and The Pokemon Company. Nuz-Dash is a fan-made tool,
not affiliated with or endorsed by any of them. Nuz-Dash ships no game files:
users supply their own legally-obtained ROMs.
