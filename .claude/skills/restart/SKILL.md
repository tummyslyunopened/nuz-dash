---
name: restart
description: Rebuild the client and restart the nuz-dash server correctly on this machine (PATH refresh, background task, tunnel survives)
---

# Restart the nuz-dash server

1. If client code (`client/`) changed, build first:
   ```powershell
   $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'); npm run build
   ```
   Server-only changes (server/*.js, admin.html) do NOT need a build.
2. Stop the currently running server background task with the TaskStop tool
   (find its task id from earlier in the conversation; it runs
   `node server/server.js`). If none is known, check
   `Get-NetTCPConnection -LocalPort 4517 -State Listen` and stop that PID.
3. Start again as a background task:
   ```powershell
   $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'); node server/server.js
   ```
4. Verify: `Invoke-WebRequest http://localhost:4517/ -UseBasicParsing` → 200.
   Admin: port 4518. If autoTunnel is on, the public hostname (see
   CLAUDE.local.md) comes back by itself — cloudflared reconnects automatically.
5. Tell the user to hard-refresh (Ctrl+Shift+R) if the client bundle changed.

Notes:
- Startup runs data migrations and prints important one-time info (e.g.
  migrated member links) — read the task output file after starting.
- Never run two servers at once: JSON stores are whole-file writes; a stale
  process saving late clobbers newer data.
