import React, { useRef, useState } from 'react'

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
  const fileRef = useRef(null)

  const saveState = async (slot) => {
    setStateMsg('')
    try {
      const gm = window.EJS_emulator?.gameManager
      if (!gm) throw new Error('game is not running')
      const bytes = gm.getState()
      const res = await fetch(`/api/runs/${run.id}/states/${slot}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
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
      const res = await fetch(`/api/runs/${run.id}/states/${slot}`)
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
        headers: { 'Content-Type': 'application/octet-stream' },
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
    if (!window.confirm(`Remove ${run.rom.name}?`)) return
    const res = await fetch(`/api/runs/${run.id}/rom`, { method: 'DELETE' })
    setRun(await res.json())
  }

  const start = () => {
    window.EJS_player = '#ejs-mount'
    window.EJS_core = run.rom.core
    window.EJS_gameName = run.rom.name.replace(/\.[^.]+$/, '')
    window.EJS_gameUrl = `/api/runs/${run.id}/rom`
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
        Game
        {run.rom && (
          <span className="h-actions">
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
          <p>Upload your own legally-dumped ROM — patched ROM hacks welcome (.gb / .gbc / .gba / .nds, unzipped).</p>
          <p>It's stored locally in <code>server/data/roms</code> and never leaves your machine.</p>
          <button className="primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Uploading…' : 'Upload ROM'}
          </button>
        </div>
      ) : (
        <>
          {!started && (
            <div className="map-upload">
              <p>{run.rom.name} is ready.</p>
              <button className="primary" onClick={start}>▶ Start game</button>
            </div>
          )}
          <div id="ejs-mount" className="ejs-mount" style={{ display: started ? 'block' : 'none' }} />
          {started && (
            <>
              <div className="state-slots">
                {['1', '2', '3'].map((slot) => {
                  const meta = run.states?.[slot]
                  return (
                    <div className="state-slot" key={slot}>
                      <span className="ss-label">
                        Slot {slot}
                        <span className="ss-meta">{meta ? ` · ${timeAgo(meta.savedAt)}` : ' · empty'}</span>
                      </span>
                      <button className="small" onClick={() => saveState(slot)}>Save</button>
                      <button className="small" onClick={() => loadState(slot)} disabled={!meta}>Load</button>
                    </div>
                  )
                })}
              </div>
              {stateMsg && <p className="map-tip">{stateMsg}</p>}
              <p className="map-tip">
                States are stored with the run on the server — reliable across restarts. The game keeps running if you switch back to the dashboard view.
              </p>
            </>
          )}
        </>
      )}
      {error && <p className="error-note">{error}</p>}
    </div>
  )
}
