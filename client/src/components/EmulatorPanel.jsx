import React, { useEffect, useRef, useState } from 'react'
import { Gamepad2, Radio, Play, Upload, Maximize, X } from 'lucide-react'
import { authHeaders, memberToken, sessionHeaders } from '../api.js'
import { sha256Hex, cacheRom, cachedRom } from '../romcache.js'
import StreamDiagnostics from './StreamDiagnostics.jsx'

// "Mobile" = touch device with a small screen (a touch laptop shouldn't count)
const isMobile = () => window.matchMedia('(pointer: coarse) and (max-width: 900px)').matches

// Pull the current battery save out of the running EmulatorJS instance.
// API surface differs slightly between versions, so probe defensively.
export async function readEmulatorSave() {
  const em = window.EJS_emulator
  const gm = em?.gameManager
  if (!gm) throw new Error('Emulator is not running')
  try { if (typeof gm.saveSaveFiles === 'function') gm.saveSaveFiles() } catch { /* best effort */ }
  if (typeof gm.getSaveFile === 'function') {
    const file = await gm.getSaveFile()
    if (file && file.length) return file
  }
  if (typeof gm.getSaveFilePath === 'function' && gm.FS) {
    const p = gm.getSaveFilePath()
    try {
      if (gm.FS.analyzePath(p).exists) return gm.FS.readFile(p)
    } catch { /* fall through */ }
  }
  throw new Error('Could not read the save file from the emulator — save in-game first, then retry.')
}

export const emulatorRunning = () => !!window.EJS_emulator?.gameManager

// Push the current emulator state to the server's rolling "auto" slot.
// Called on detected in-game saves and on a heartbeat while playing.
export async function pushAutoState(runId) {
  if (window.__nuzSessionLost) return null
  const gm = window.EJS_emulator?.gameManager
  if (!gm) return null
  try {
    const bytes = gm.getState()
    const res = await fetch(`/api/runs/${runId}/states/auto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders(), ...sessionHeaders() },
      body: bytes
    })
    if (res.status === 409) {
      window.__nuzSessionLost = true
      window.dispatchEvent(new Event('nuz:session-lost'))
      return null
    }
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

const fmtSize = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`)

export default function EmulatorPanel({ run, setRun }) {
  const [started, setStarted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stateMsg, setStateMsg] = useState('')
  const [streaming, setStreaming] = useState(true)
  const [mobileFs, setMobileFs] = useState(false)
  // Replacing the ROM swaps the SHARED lobby game — ROM managers only
  const [canManageRom, setCanManageRom] = useState(false)
  const [cleanMode, setCleanMode] = useState(false)
  // Streaming is ALWAYS ON unless the host enabled optional streaming —
  // the watch party is part of the draw of the app
  const [optionalStreaming, setOptionalStreaming] = useState(false)
  // ROM-clean mode: the ROM comes from the runner's own machine and only
  // ever exists in this browser. { bytes, name, sha256, match }
  const [localRom, setLocalRom] = useState(null)
  const [keepCopy, setKeepCopy] = useState(true)
  const [hashing, setHashing] = useState(false)
  const fileRef = useRef(null)
  const romPickRef = useRef(null)
  const mountWrapRef = useRef(null)

  // This run's ROM entry is a fingerprint, not a hosted file
  const byoRom = !!run.rom && run.rom.hosted === false

  useEffect(() => {
    fetch('/api/me', { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        setCanManageRom(!!d.member?.romManager)
        setCleanMode(!!d.romCleanMode)
        setOptionalStreaming(!!d.optionalStreaming)
        if (!d.optionalStreaming) setStreaming(true)
      })
      .catch(() => {})
  }, [])

  // BYO boot: reuse the copy this browser already has, if any
  useEffect(() => {
    if (!byoRom || localRom) return
    cachedRom(run.rom.sha256).then((entry) => {
      if (entry) setLocalRom({ bytes: entry.bytes, name: entry.name, sha256: run.rom.sha256, match: true, cached: true })
    })
  }, [byoRom, run.rom?.sha256]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickLocalRom = async (file) => {
    setHashing(true)
    setError('')
    try {
      const bytes = await file.arrayBuffer()
      const hash = await sha256Hex(bytes)
      const match = run.rom.sha256 ? hash === run.rom.sha256 : null
      setLocalRom({ bytes, name: file.name, sha256: hash, match, cached: false })
      if (keepCopy) cacheRom(hash, file.name, bytes)
    } catch (err) {
      setError(`Could not read the ROM file: ${err.message}`)
    } finally {
      setHashing(false)
    }
  }

  // Mobile fullscreen: CSS takeover everywhere (iPhone has no element
  // fullscreen API), plus native fullscreen + landscape lock where supported.
  // The emulator only notices size changes via window resize, so nudge it.
  const nudgeEmulatorResize = () => setTimeout(() => window.dispatchEvent(new Event('resize')), 60)

  // Fullscreen state is broadcast so the encounter radar can portal detection
  // toasts INTO the wrapper (native fullscreen only renders its descendants).
  const setFsBroadcast = (active) => {
    window.__nuzMobileFs = active
    window.dispatchEvent(new CustomEvent('nuz:mobile-fs', { detail: active }))
  }

  const enterMobileFullscreen = () => {
    setMobileFs(true)
    setFsBroadcast(true)
    const el = mountWrapRef.current
    if (el?.requestFullscreen) {
      el.requestFullscreen().then(() => {
        try { screen.orientation?.lock?.('landscape').catch(() => {}) } catch { /* not supported */ }
      }).catch(() => { /* CSS takeover still applies */ })
    }
    nudgeEmulatorResize()
  }

  const exitMobileFullscreen = () => {
    setMobileFs(false)
    setFsBroadcast(false)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    try { screen.orientation?.unlock?.() } catch { /* fine */ }
    nudgeEmulatorResize()
  }

  // Let other components (radar toasts) request a fullscreen exit
  const exitRef = useRef(() => {})
  exitRef.current = exitMobileFullscreen
  useEffect(() => {
    const h = () => exitRef.current()
    window.addEventListener('nuz:exit-mobile-fs', h)
    return () => window.removeEventListener('nuz:exit-mobile-fs', h)
  }, [])

  // Controller bindings follow the member: watch the live mapping while
  // playing and push changes to the server (loaded back at game start).
  useEffect(() => {
    if (!started) return
    let lastSent = JSON.stringify(window.EJS_defaultControls || null)
    const t = setInterval(async () => {
      const controls = window.EJS_emulator?.controls
      if (!controls) return
      const snapshot = JSON.stringify(controls)
      if (snapshot === lastSent) return
      try {
        const res = await fetch('/api/me/controls', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ controls })
        })
        if (res.ok) lastSent = snapshot
      } catch { /* retry next tick */ }
    }, 10000)
    return () => clearInterval(t)
  }, [started])

  // ---- Launch source: latest server save (default), any historical battery
  // save from the archive, or a fresh boot. Battery saves ONLY — states stay
  // manual (emulator menu); the sav is the source of truth.
  const [savOptions, setSavOptions] = useState([])
  const [selectedSave, setSelectedSave] = useState('latest')
  const [showLoader, setShowLoader] = useState(false)
  const [loaderChoice, setLoaderChoice] = useState('latest')

  const loadSavHistory = async () => {
    try {
      const h = await fetch('/api/me/save-history', { headers: authHeaders() }).then((r) => r.json())
      setSavOptions((h.files || []).filter((f) => f.runId === run.id && f.type === 'sav'))
    } catch { /* picker just shows Latest */ }
  }
  useEffect(() => { if (run.rom) loadSavHistory() }, [run.id, run.rom?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const fmtWhen = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  const fetchSavBytes = async (choice) => {
    const url = choice === 'latest'
      ? `/api/runs/${run.id}/sav`
      : `/api/me/save-history/${encodeURIComponent(choice)}`
    const res = await fetch(url, { headers: authHeaders() })
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  }

  const writeSavToFs = (gm, bytes) => {
    const p = gm.getSaveFilePath()
    const parts = p.split('/')
    let cur = ''
    for (let i = 0; i < parts.length - 1; i++) {
      if (!parts[i]) continue
      cur += '/' + parts[i]
      if (!gm.FS.analyzePath(cur).exists) gm.FS.mkdir(cur)
    }
    try { gm.FS.unlink(p) } catch { /* fresh */ }
    gm.FS.writeFile(p, bytes)
    if (typeof gm.loadSaveFiles === 'function') gm.loadSaveFiles()
    window.dispatchEvent(new Event('nuz:sav-restored')) // party panel syncs immediately
  }

  const autoResume = async () => {
    try {
      const gm = window.EJS_emulator?.gameManager
      if (!gm) return
      if (selectedSave === 'fresh') { setStateMsg('Fresh boot — no save restored.'); return }
      const bytes = await fetchSavBytes(selectedSave)
      if (!bytes) {
        setStateMsg('No server save available — booted fresh. If one should exist, use "Load a save" below.')
        return
      }
      writeSavToFs(gm, bytes)
      const label = selectedSave === 'latest'
        ? 'Latest battery save'
        : `Battery save from ${fmtWhen(savOptions.find((f) => f.file === selectedSave)?.savedAt || '')}`
      setStateMsg(`${label} restored — hit Continue on the title screen to resume.`)
    } catch (err) {
      setStateMsg(`Save restore failed (${err.message}) — use "Load a save" below.`)
    }
  }

  // Post-start recovery: apply any battery save and restart the emulator to
  // the title screen — fixes "my save didn't load" without a page reload.
  const applySave = async () => {
    try {
      const gm = window.EJS_emulator?.gameManager
      if (!gm) throw new Error('game is not running')
      const bytes = await fetchSavBytes(loaderChoice)
      if (!bytes) throw new Error('save not found on the server')
      writeSavToFs(gm, bytes)
      gm.restart()
      setShowLoader(false)
      setStateMsg('Save applied and game restarted — hit Continue on the title screen.')
    } catch (err) {
      setStateMsg(`Load failed: ${err.message}`)
    }
  }

  // ---- Single-session guard: only one live tab/device syncs a run ----
  const [sessionLost, setSessionLost] = useState(false)

  const claimSession = async (takeover) => {
    const res = await fetch(`/api/runs/${run.id}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...sessionHeaders() },
      body: JSON.stringify({ takeover: !!takeover })
    })
    return res.status
  }

  const loseSession = () => {
    window.__nuzSessionLost = true
    setSessionLost(true)
    try { window.EJS_emulator?.pause?.(true) } catch { /* best effort */ }
  }

  useEffect(() => {
    const h = () => loseSession()
    window.addEventListener('nuz:session-lost', h)
    return () => window.removeEventListener('nuz:session-lost', h)
  }, [])

  useEffect(() => {
    if (!started || sessionLost) return
    const t = setInterval(async () => {
      try {
        if ((await claimSession(false)) === 409) loseSession()
      } catch { /* offline blip; retry next beat */ }
    }, 10000)
    return () => clearInterval(t)
  }, [started, sessionLost, run.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Watch-party broadcast (~15fps): crop the emulator canvas to its actual
  // game content — mobile portrait/fullscreen leaves big black regions
  // (letterboxing, virtual keypad area) that would waste every viewer's
  // screen — then scale to a normalized width so all lobby streams look the
  // same. Live party + current area ride along in a header for viewer
  // overlays. drawImage runs inside requestAnimationFrame so the WebGL
  // buffer is still valid.
  useEffect(() => {
    if (!started || !streaming) return
    const out = document.createElement('canvas')
    const detect = document.createElement('canvas')
    const blackProbe = document.createElement('canvas')
    blackProbe.width = 16
    blackProbe.height = 12
    let inFlight = false
    let bbox = null // content bounding box in source pixels
    let sinceDetect = 999
    // Broadcast diagnostics — shown in the Stream diagnostics panel and
    // attached to every bug report, so black-frame hunts have real data.
    const stats = {
      startedAt: Date.now(),
      captured: 0,
      sent: 0,
      sendFail: 0,
      droppedBlack: 0,
      blobNull: 0,
      noSrc: 0,
      bboxChanges: 0,
      bbox: null,
      srcSize: null,
      lums: [], // max-luminance (0..765) of recent captured frames
      detectLog: [] // bbox re-detections with timestamps
    }
    window.__nuzStreamStats = stats
    // Max pixel luminance of a frame (0 = pure black). Reading a WebGL
    // canvas can race the emulator's render and return a cleared buffer —
    // frames at/below the threshold are DROPPED, viewers hold the last
    // good frame.
    const frameLum = (canvas) => {
      try {
        const ctx = blackProbe.getContext('2d', { willReadFrequently: true })
        // MUST clear first: a TRANSPARENT frame (empty WebGL read) draws
        // nothing, and stale probe pixels would read as a bright frame —
        // while toBlob encodes the same transparent canvas as pure black.
        // (That mismatch was the black-flicker bug.)
        ctx.clearRect(0, 0, 16, 12)
        ctx.drawImage(canvas, 0, 0, 16, 12)
        const px = ctx.getImageData(0, 0, 16, 12).data
        let max = 0
        for (let i = 0; i < px.length; i += 4) {
          if (px[i + 3] === 0) continue // transparent = nothing rendered
          const v = px[i] + px[i + 1] + px[i + 2]
          if (v > max) max = v
        }
        return max
      } catch {
        return -1 // probe failed (tainted canvas etc.) — don't drop
      }
    }
    const findContent = (src) => {
      const dw = 80
      const dh = Math.max(1, Math.round((src.height / src.width) * dw))
      detect.width = dw
      detect.height = dh
      const dctx = detect.getContext('2d', { willReadFrequently: true })
      dctx.drawImage(src, 0, 0, dw, dh)
      const px = dctx.getImageData(0, 0, dw, dh).data
      let minX = dw, minY = dh, maxX = -1, maxY = -1
      for (let y = 0; y < dh; y++) {
        for (let x = 0; x < dw; x++) {
          const i = (y * dw + x) * 4
          if (px[i] + px[i + 1] + px[i + 2] > 48) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (maxX < 0) return null
      const bw = maxX - minX + 1
      const bh = maxY - minY + 1
      // Fades/battle transitions go near-black — keep the previous crop then
      if (bw * bh < dw * dh * 0.08) return null
      const sx = src.width / dw
      const sy = src.height / dh
      return {
        x: Math.max(0, Math.floor(minX * sx)),
        y: Math.max(0, Math.floor(minY * sy)),
        w: Math.min(src.width, Math.ceil(bw * sx)),
        h: Math.min(src.height, Math.ceil(bh * sy))
      }
    }
    const tick = () => {
      if (inFlight) return
      requestAnimationFrame(() => {
        try {
          const src = window.EJS_emulator?.canvas || document.querySelector('#ejs-mount canvas')
          if (!src || !src.width) { stats.noSrc += 1; return }
          stats.captured += 1
          stats.srcSize = `${src.width}x${src.height}`
          sinceDetect += 1
          if (sinceDetect >= 12) { // re-detect the content box ~every 2s
            const b = findContent(src)
            if (b) {
              const changed = !bbox || b.x !== bbox.x || b.y !== bbox.y || b.w !== bbox.w || b.h !== bbox.h
              if (changed) {
                stats.bboxChanges += 1
                stats.detectLog.push({ t: new Date().toISOString().slice(11, 23), box: `${b.x},${b.y} ${b.w}x${b.h}` })
                if (stats.detectLog.length > 20) stats.detectLog.shift()
              }
              bbox = b
            }
            sinceDetect = 0
          }
          const box = bbox || { x: 0, y: 0, w: src.width, h: src.height }
          const scale = Math.min(1, 480 / box.w)
          const ow = Math.max(1, Math.round(box.w * scale))
          const oh = Math.max(1, Math.round(box.h * scale))
          // Resize ONLY when needed — assigning width clears the canvas to
          // transparent, and an empty WebGL read would then encode as black.
          // Keeping the previous frame means a raced read just re-sends the
          // last good image instead.
          if (out.width !== ow || out.height !== oh) {
            out.width = ow
            out.height = oh
          }
          out.getContext('2d').drawImage(src, box.x, box.y, box.w, box.h, 0, 0, ow, oh)
          stats.bbox = `${box.x},${box.y} ${box.w}x${box.h}`
          const lum = frameLum(out)
          stats.lums.push(lum)
          if (stats.lums.length > 80) stats.lums.shift()
          if (lum >= 0 && lum <= 45) { stats.droppedBlack += 1; return } // stale WebGL read or mid-fade
          out.toBlob((blob) => {
            if (!blob || !blob.size) { stats.blobNull += 1; return }
            inFlight = true
            // Set by RunPage from the live party sync + radar location
            let metaHdr = null
            try { metaHdr = window.__nuzStreamMeta ? encodeURIComponent(JSON.stringify(window.__nuzStreamMeta)) : null } catch { /* skip */ }
            fetch('/api/stream', {
              method: 'POST',
              headers: {
                'Content-Type': 'image/jpeg',
                ...(metaHdr ? { 'X-Stream-Meta': metaHdr } : {}),
                ...authHeaders()
              },
              body: blob
            }).then((r) => { if (r.ok) stats.sent += 1; else stats.sendFail += 1 })
              .catch(() => { stats.sendFail += 1 })
              .finally(() => { inFlight = false })
          }, 'image/jpeg', 0.6)
        } catch { /* skip frame */ }
      })
    }
    // ~15fps target; the in-flight guard self-throttles to the actual upload
    // round-trip, so slow links degrade to fewer fps instead of piling up.
    const t = setInterval(tick, 66)
    return () => clearInterval(t)
  }, [started, streaming, run.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (file) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/runs/${run.id}/rom?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
        body: file
      })
      if (!res.ok) throw new Error((await res.json()).error || `${res.status}`)
      setRun(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeRom = async () => {
    if (started) {
      setError('Reload the page first to stop the emulator, then remove the ROM.')
      return
    }
    if (!window.confirm(`Unlink ${run.rom.name} from this attempt? (It stays in the lobby library.)`)) return
    const res = await fetch(`/api/runs/${run.id}/rom`, { method: 'DELETE', headers: authHeaders() })
    setRun(await res.json())
  }

  // Browsers only surface the "allow multiple downloads" permission when a
  // second programmatic download happens — there's no API to request it.
  // So we provoke the prompt ONCE, here inside the Start tap (before
  // fullscreen), so it never interrupts gameplay later.
  // Returns true when it primed (first ever start): the emulator does NOT
  // boot on that click, so the permission prompt can never collide with
  // fullscreen. The user answers it, then presses Start again.
  const primeDownloadPermission = () => {
    if (!window.__nuzLocalDownloads) return false // downloads disabled server-side: nothing to prime
    if (localStorage.getItem('nuz-dl-primed')) return false
    localStorage.setItem('nuz-dl-primed', '1')
    const msg = 'Nuz-Dash download-permission check. Automatic save backups need this. Safe to delete.'
    for (const n of [1, 2]) {
      const url = URL.createObjectURL(new Blob([msg], { type: 'text/plain' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `nuz-dash-backup-check-${n}.txt`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    }
    setStateMsg('One-time download check: if the browser asks to allow multiple downloads, choose Allow — then press Start game again. (The two tiny check files are safe to delete.)')
    return true
  }

  // Detect emulator-menu loads (state or save file) by patching gameManager —
  // the EJS_onLoad* events can't be used: registering them SUPPRESSES the
  // menu's default load behavior. A load rewrites memory, so the party
  // scanner and radar re-baseline immediately via this event.
  const patchLoadHooks = () => {
    const gm = window.EJS_emulator?.gameManager
    if (!gm || gm.__nuzPatched) return
    gm.__nuzPatched = true
    const fireReset = () => setTimeout(() => window.dispatchEvent(new Event('nuz:memory-reset')), 600)
    const origLoadState = gm.loadState.bind(gm)
    gm.loadState = (d) => { const r = origLoadState(d); fireReset(); return r }
    const origLoadSaves = gm.loadSaveFiles.bind(gm)
    gm.loadSaveFiles = () => { const r = origLoadSaves(); fireReset(); return r }
  }

  const start = async () => {
    if (byoRom && !localRom) {
      setError('Pick your ROM file first — BYO ROM boots straight from your browser.')
      return
    }
    if (primeDownloadPermission()) return // answer the prompt first, then tap Start again
    // RULE: every prompt (confirm/permission) must resolve BEFORE entering
    // mobile fullscreen — a dialog over fullscreen breaks it. Keep the awaits
    // here short so the tap's activation still covers the fullscreen request;
    // if native fullscreen is denied anyway, the CSS takeover still applies.
    try {
      if ((await claimSession(false)) === 409) {
        if (!window.confirm('This run is already being played in another tab or device. Take over here? (The other session will stop syncing saves.)')) return
        await claimSession(true)
      }
      window.__nuzSessionLost = false
      setSessionLost(false)
    } catch { /* offline: play on, guard re-engages when the server is back */ }
    if (isMobile()) enterMobileFullscreen()
    // Seed the emulator with this member's saved controller bindings
    try {
      const me = await fetch('/api/me', { headers: authHeaders() }).then((r) => r.json())
      if (me?.member?.controls) window.EJS_defaultControls = me.member.controls
      window.__nuzLocalDownloads = !!me?.localDownloads
    } catch { /* built-in defaults are fine */ }
    window.EJS_onGameStart = () => setTimeout(() => { patchLoadHooks(); autoResume() }, 1200)
    // Emulator-menu manual states: registering this handler REPLACES the
    // default flow, so we do both jobs — local download + server archive.
    window.EJS_onSaveState = (e) => {
      const bytes = e?.state
      if (!bytes || !bytes.length) return
      if (window.__nuzLocalDownloads) {
        try {
          const url = URL.createObjectURL(new Blob([bytes]))
          const a = document.createElement('a')
          a.href = url
          a.download = `manual-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.state`
          a.click()
          setTimeout(() => URL.revokeObjectURL(url), 30000)
        } catch { /* download is best-effort */ }
      }
      if (!window.__nuzSessionLost) {
        fetch(`/api/runs/${run.id}/manual-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', ...authHeaders(), ...sessionHeaders() },
          body: bytes
        }).catch(() => {})
      }
      setStateMsg(window.__nuzLocalDownloads
        ? 'Manual state saved — downloaded locally and archived to your backup history.'
        : 'Manual state saved — archived to your backup history.')
    }
    // Keep the FS save file fresh even if our auto-sync is toggled off
    window.EJS_defaultOptions = { 'save-save-interval': '30' }
    window.EJS_player = '#ejs-mount'
    window.EJS_core = run.rom.core
    window.EJS_gameName = run.rom.name.replace(/\.[^.]+$/, '')
    // EmulatorJS fetches the ROM itself and can't send headers — pass the
    // token as a query param. In ROM-clean mode the bytes never touch the
    // network at all: boot from an object URL over this browser's copy.
    window.EJS_gameUrl = byoRom
      ? URL.createObjectURL(new Blob([localRom.bytes]))
      : `/api/runs/${run.id}/rom?token=${memberToken}`
    window.EJS_pathtodata = '/emulatorjs/'
    window.EJS_startOnLoaded = true
    window.EJS_backgroundColor = '#0d0d0d'
    const script = document.createElement('script')
    script.src = '/emulatorjs/loader.js'
    script.onerror = () => setError('Failed to load the emulator runtime from /emulatorjs/.')
    document.body.appendChild(script)
    setStarted(true)
  }

  return (
    <div className="panel">
      <h2>
        <span className="h2-title"><Gamepad2 size={14} /> Game</span>
        {run.rom && (
          <span className="h-actions">
            {started && isMobile() && (
              <button className="small" onClick={enterMobileFullscreen} title="Fullscreen">
                <Maximize size={12} />
              </button>
            )}
            {started && (optionalStreaming ? (
              <button
                className={`small ${streaming ? 'primary' : ''}`}
                onClick={() => setStreaming((s) => !s)}
                title="Broadcast your game to lobby-mates"
              ><Radio size={12} /> {streaming ? 'Streaming' : 'Stream off'}</button>
            ) : (
              <span className="chip" title="Your game streams to the lobby's watch party — that's the fun part. (The host can make streaming optional from the admin dashboard.)">
                <Radio size={12} /> Streaming
              </span>
            ))}
            <span className="chip rom-chip" title={`${run.rom.name} · ${fmtSize(run.rom.size)} · ${run.rom.core.toUpperCase()}`}>
              {run.rom.name} · {fmtSize(run.rom.size)} · {run.rom.core.toUpperCase()}
            </span>
            {canManageRom && !byoRom && (
              <button className="small" onClick={() => fileRef.current?.click()} disabled={busy || started}>Replace</button>
            )}
            <button className="small danger" onClick={removeRom} disabled={busy}>Remove</button>
          </span>
        )}
      </h2>
      <input
        ref={fileRef}
        type="file"
        accept=".gb,.gbc,.sgb,.gba,.nds"
        style={{ display: 'none' }}
        onChange={(e) => e.target.files[0] && upload(e.target.files[0])}
      />
      <input
        ref={romPickRef}
        type="file"
        accept=".gb,.gbc,.sgb,.gba,.nds"
        style={{ display: 'none' }}
        onChange={(e) => e.target.files[0] && pickLocalRom(e.target.files[0])}
      />
      {!run.rom ? (
        <div className="map-upload">
          {cleanMode ? (
            <p>BYO ROM: a ROM manager registers the lobby's game from the lobby page (only its
            fingerprint is stored). Each runner then supplies their own copy here — it never leaves the browser.</p>
          ) : (
            <>
              <p>No ROM linked to this attempt. Pick one from the lobby's ROM library when starting an attempt{canManageRom ? ", or upload one here (it's added to the lobby library)" : ''}.</p>
              {canManageRom ? (
                <>
                  <p>Legally-dumped ROMs only — patched ROM hacks welcome (.gb / .gbc / .gba / .nds, unzipped).</p>
                  <button className="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
                    <Upload size={14} /> {busy ? 'Uploading…' : 'Upload ROM'}
                  </button>
                </>
              ) : (
                <p>Uploading a new lobby ROM is limited to ROM managers (the lobby creator, by default).</p>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {!started && byoRom && !localRom && (
            <div className="map-upload">
              <p>This lobby races <strong>{run.rom.name}</strong> ({fmtSize(run.rom.size)}), but the server
              doesn't host it — pick your own copy to play. It loads straight into the emulator and
              never leaves your browser.</p>
              <button className="primary" onClick={() => romPickRef.current?.click()} disabled={hashing}>
                <Upload size={14} /> {hashing ? 'Checking…' : 'Pick your ROM file'}
              </button>
              <p className="map-tip" style={{ marginTop: 8 }}>
                <label><input type="checkbox" checked={keepCopy} onChange={(e) => setKeepCopy(e.target.checked)} />
                {' '}Remember it in this browser so you don't have to pick it again (stored locally only)</label>
              </p>
            </div>
          )}
          {!started && (!byoRom || localRom) && (
            <div className="map-upload">
              {byoRom ? (
                <p>
                  {localRom.name} loaded from {localRom.cached ? 'this browser' : 'your file'} ·{' '}
                  {localRom.match === true && <span style={{ color: 'var(--good)' }}>fingerprint matches the lobby ✓</span>}
                  {localRom.match === false && <span style={{ color: 'var(--warning, #fab219)' }}>⚠ fingerprint differs from the lobby's registered ROM — you may be racing a different patch</span>}
                  {localRom.match === null && 'no lobby fingerprint to compare against'}
                  {' '}<button className="small" style={{ marginLeft: 6 }} onClick={() => romPickRef.current?.click()}>Pick a different file</button>
                </p>
              ) : (
                <p>{run.rom.name} is ready.</p>
              )}
              <div className="launch-row">
                <select value={selectedSave} onChange={(e) => setSelectedSave(e.target.value)} title="Which save to boot from">
                  <option value="latest">Resume latest save{run.sav?.savedAt ? ` (${fmtWhen(run.sav.savedAt)})` : ''}</option>
                  {savOptions.map((f) => (
                    <option key={f.file} value={f.file}>Save from {fmtWhen(f.savedAt)}</option>
                  ))}
                  <option value="fresh">Fresh boot (no save)</option>
                </select>
                <button className="primary" onClick={start}><Play size={14} /> Start</button>
              </div>
            </div>
          )}
          <div ref={mountWrapRef} id="ejs-wrap" className={`ejs-wrap ${mobileFs ? 'mobile-fs' : ''}`}>
            <div id="ejs-mount" className="ejs-mount" style={{ display: started ? 'block' : 'none' }} />
            {mobileFs && (
              <button className="fs-exit" onClick={exitMobileFullscreen} title="Exit fullscreen"><X size={18} /></button>
            )}
            {sessionLost && (
              <div className="session-lost">
                <div>
                  <h3>Session taken over</h3>
                  <p>This run started playing on another tab or device, so this one stopped syncing saves to avoid conflicting timelines.</p>
                  <button className="primary" onClick={() => window.location.reload()}>Reload to take back</button>
                </div>
              </div>
            )}
          </div>
          {stateMsg && <p className="map-tip">{stateMsg}</p>}
          {started && streaming && <StreamDiagnostics source="broadcast" />}
          {started && (
            <>
              <div className="launch-row" style={{ justifyContent: 'flex-start', marginTop: 6 }}>
                {!showLoader ? (
                  <button className="small" onClick={() => { loadSavHistory(); setShowLoader(true) }}>
                    Load a save…
                  </button>
                ) : (
                  <>
                    <select value={loaderChoice} onChange={(e) => setLoaderChoice(e.target.value)}>
                      <option value="latest">Latest save{run.sav?.savedAt ? ` (${fmtWhen(run.sav.savedAt)})` : ''}</option>
                      {savOptions.map((f) => (
                        <option key={f.file} value={f.file}>Save from {fmtWhen(f.savedAt)}</option>
                      ))}
                    </select>
                    <button className="small primary" onClick={applySave}>Apply &amp; restart game</button>
                    <button className="small" onClick={() => setShowLoader(false)}>Cancel</button>
                  </>
                )}
              </div>
              <p className="map-tip">
                Progress resumes automatically: every in-game save updates the server auto-save, which loads on your
                next launch. "Load a save" restarts the game to the title screen with the chosen save — picking an
                older one rolls your run back (the newer save stays in Backup history).
              </p>
            </>
          )}
        </>
      )}
      {error && <p className="error-note">{error}</p>}
    </div>
  )
}
