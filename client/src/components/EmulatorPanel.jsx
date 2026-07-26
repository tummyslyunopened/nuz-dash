import React, { useEffect, useRef, useState } from 'react'
import { Gamepad2, Radio, Play, Save, Download, Upload } from 'lucide-react'
import { authHeaders, memberToken } from '../api.js'

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
  const gm = window.EJS_emulator?.gameManager
  if (!gm) return null
  try {
    const bytes = gm.getState()
    const res = await fetch(`/api/runs/${runId}/states/auto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
      body: bytes
    })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

const fmtSize = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`)

const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  return hours < 24 ? `${hours}h ago` : new Date(iso).toLocaleString()
}

export default function EmulatorPanel({ run, setRun }) {
  const [started, setStarted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stateMsg, setStateMsg] = useState('')
  const [streaming, setStreaming] = useState(true)
  const fileRef = useRef(null)

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

  // Heartbeat: refresh the server's auto state every 3 minutes while playing
  useEffect(() => {
    if (!started) return
    const t = setInterval(async () => {
      const updated = await pushAutoState(run.id)
      if (updated) setRun(updated)
    }, 180000)
    return () => clearInterval(t)
  }, [started, run.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resume: when the game starts, load the NEWEST server-side state
  // (auto or manual slot). Manual loads remain available at any time.
  const autoResume = async () => {
    try {
      const fresh = await fetch(`/api/runs/${run.id}`, { headers: authHeaders() }).then((r) => r.json())
      const slots = Object.entries(fresh.states || {})
      if (!slots.length) return
      const [slot, meta] = slots.sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt))[0]
      const res = await fetch(`/api/runs/${run.id}/states/${slot}`, { headers: authHeaders() })
      if (!res.ok) return
      const gm = window.EJS_emulator?.gameManager
      if (!gm) return
      gm.loadState(new Uint8Array(await res.arrayBuffer()))
      setStateMsg(`Resumed from server state (${slot === 'auto' ? 'auto' : `slot ${slot}`}, saved ${timeAgo(meta.savedAt)}).`)
    } catch { /* fresh boot is fine */ }
  }

  // Watch-party broadcast: copy the emulator canvas to JPEG (~2fps) and push
  // the latest frame to the server for lobby-mates to watch. drawImage runs
  // inside requestAnimationFrame so the WebGL buffer is still valid.
  useEffect(() => {
    if (!started || !streaming) return
    const off = document.createElement('canvas')
    let inFlight = false
    const tick = () => {
      if (inFlight) return
      requestAnimationFrame(() => {
        try {
          const src = window.EJS_emulator?.canvas || document.querySelector('#ejs-mount canvas')
          if (!src || !src.width) return
          off.width = src.width
          off.height = src.height
          off.getContext('2d').drawImage(src, 0, 0)
          off.toBlob((blob) => {
            if (!blob || !blob.size) return
            inFlight = true
            fetch('/api/stream', {
              method: 'POST',
              headers: { 'Content-Type': 'image/jpeg', ...authHeaders() },
              body: blob
            }).catch(() => {}).finally(() => { inFlight = false })
          }, 'image/jpeg', 0.7)
        } catch { /* skip frame */ }
      })
    }
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [started, streaming, run.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveState = async (slot) => {
    setStateMsg('')
    try {
      const gm = window.EJS_emulator?.gameManager
      if (!gm) throw new Error('game is not running')
      const bytes = gm.getState()
      const res = await fetch(`/api/runs/${run.id}/states/${slot}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
        body: bytes
      })
      if (!res.ok) throw new Error((await res.json()).error || `${res.status}`)
      setRun(await res.json())
      setStateMsg(`Saved to slot ${slot} (${(bytes.length / 1024).toFixed(0)} KB).`)
    } catch (err) {
      setStateMsg(`Save failed: ${err.message}`)
    }
  }

  const loadState = async (slot) => {
    setStateMsg('')
    try {
      const gm = window.EJS_emulator?.gameManager
      if (!gm) throw new Error('game is not running')
      const res = await fetch(`/api/runs/${run.id}/states/${slot}`, { headers: authHeaders() })
      if (res.status === 404) throw new Error('slot is empty')
      if (!res.ok) throw new Error(`${res.status}`)
      gm.loadState(new Uint8Array(await res.arrayBuffer()))
      setStateMsg(`Loaded slot ${slot}. If the encounter radar is running, Stop/Start it and re-sync the party — memory moved.`)
    } catch (err) {
      setStateMsg(`Load failed: ${err.message}`)
    }
  }

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

  const start = async () => {
    // Seed the emulator with this member's saved controller bindings
    try {
      const me = await fetch('/api/me', { headers: authHeaders() }).then((r) => r.json())
      if (me?.member?.controls) window.EJS_defaultControls = me.member.controls
    } catch { /* built-in defaults are fine */ }
    window.EJS_onGameStart = () => setTimeout(autoResume, 1200)
    window.EJS_player = '#ejs-mount'
    window.EJS_core = run.rom.core
    window.EJS_gameName = run.rom.name.replace(/\.[^.]+$/, '')
    // EmulatorJS fetches the ROM itself and can't send headers — pass the token as a query param
    window.EJS_gameUrl = `/api/runs/${run.id}/rom?token=${memberToken}`
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
            {started && (
              <button
                className={`small ${streaming ? 'primary' : ''}`}
                onClick={() => setStreaming((s) => !s)}
                title="Broadcast your game to lobby-mates"
              ><Radio size={12} /> {streaming ? 'Streaming' : 'Stream off'}</button>
            )}
            <span className="chip">{run.rom.name} · {fmtSize(run.rom.size)} · {run.rom.core.toUpperCase()}</span>
            <button className="small" onClick={() => fileRef.current?.click()} disabled={busy || started}>Replace</button>
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
      {!run.rom ? (
        <div className="map-upload">
          <p>No ROM linked to this attempt. Pick one from the lobby's ROM library when starting an attempt, or upload one here (it's added to the lobby library).</p>
          <p>Legally-dumped ROMs only — patched ROM hacks welcome (.gb / .gbc / .gba / .nds, unzipped).</p>
          <button className="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload size={14} /> {busy ? 'Uploading…' : 'Upload ROM'}
          </button>
        </div>
      ) : (
        <>
          {!started && (
            <div className="map-upload">
              <p>{run.rom.name} is ready.</p>
              <button className="primary" onClick={start}><Play size={14} /> Start game</button>
            </div>
          )}
          <div id="ejs-mount" className="ejs-mount" style={{ display: started ? 'block' : 'none' }} />
          {started && (
            <>
              <div className="state-slots">
                <div className="state-slot" key="auto">
                  <span className="ss-label">
                    Auto
                    <span className="ss-meta">{run.states?.auto ? ` · ${timeAgo(run.states.auto.savedAt)}` : ' · none yet'}</span>
                  </span>
                  <button className="small" onClick={() => loadState('auto')} disabled={!run.states?.auto}><Download size={12} /> Load</button>
                </div>
                {['1', '2', '3'].map((slot) => {
                  const meta = run.states?.[slot]
                  return (
                    <div className="state-slot" key={slot}>
                      <span className="ss-label">
                        Slot {slot}
                        <span className="ss-meta">{meta ? ` · ${timeAgo(meta.savedAt)}` : ' · empty'}</span>
                      </span>
                      <button className="small" onClick={() => saveState(slot)}><Save size={12} /> Save</button>
                      <button className="small" onClick={() => loadState(slot)} disabled={!meta}><Download size={12} /> Load</button>
                    </div>
                  )
                })}
              </div>
              {stateMsg && <p className="map-tip">{stateMsg}</p>}
              <p className="map-tip">
                The Auto slot updates on every in-game save (plus every 3 minutes) and resumes automatically when you start the game.
                Manual slots and local .srm/.state downloads are your explicit checkpoints.
              </p>
            </>
          )}
        </>
      )}
      {error && <p className="error-note">{error}</p>}
    </div>
  )
}
