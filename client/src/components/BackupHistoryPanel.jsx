import React, { useEffect, useRef, useState } from 'react'
import { History, RefreshCw, Download, Upload } from 'lucide-react'
import { authHeaders, sessionHeaders, titleCase } from '../api.js'
import { api } from '../api.js'
import { parseGen3Save, parsePCBoxes } from '../gen3save.js'
import { areaLabel } from '../gen3maps.js'
import { emulatorRunning } from './EmulatorPanel.jsx'

// Rolling per-runner save archive — lives in the play area, next to the game
// it backs up. Every in-game save lands here automatically. Also the door for
// BYO saves: a .sav played on an offline emulator can be uploaded to become
// the latest battery (validated + previewed first; the previous battery stays
// in this history).
export default function BackupHistoryPanel({ run }) {
  const [history, setHistory] = useState(null)
  const [shown, setShown] = useState(10)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null) // { bytes, parsed, name } awaiting confirm
  const [uploadMsg, setUploadMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)

  const load = () => api.get('/api/me/save-history').then(setHistory).catch(() => {})
  useEffect(() => { load() }, [])

  const download = async (f) => {
    try {
      const res = await fetch(`/api/me/save-history/${encodeURIComponent(f.file)}`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`${res.status}`)
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `attempt${f.attemptNumber ?? 'x'}-${f.savedAt.replace(/[:.]/g, '-').slice(0, 19)}.${f.type === 'mstate' ? 'state' : f.type}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (err) {
      setError(`Download failed: ${err.message}`)
    }
  }

  // Validate + preview BEFORE anything is sent: junk files never leave the
  // browser, and the runner sees exactly whose save they're about to promote.
  const pickFile = async (file) => {
    setError('')
    setUploadMsg('')
    setPending(null)
    if (!file) return
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const parsed = parseGen3Save(bytes)
      let pcCount = null
      try { pcCount = parsePCBoxes(bytes).count } catch { /* boxes optional */ }
      setPending({ bytes, parsed, pcCount, name: file.name })
    } catch (err) {
      setError(`"${file.name}" doesn't look like a Gen 3 battery save: ${err.message}`)
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const confirmUpload = async () => {
    if (!pending || !run) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/runs/${run.id}/sav?source=upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...authHeaders(), ...sessionHeaders() },
        body: pending.bytes
      })
      if (res.status === 409) throw new Error('this run is open in another session — close it there first')
      if (!res.ok) throw new Error((await res.json()).error || `${res.status}`)
      setUploadMsg(emulatorRunning()
        ? 'Uploaded — it is now your latest save. Use "Load a save" (or restart the game) to play it; saving in-game before then will overwrite it.'
        : 'Uploaded — it is now your latest save. Hit Start and the picker boots it by default.')
      setPending(null)
      load()
    } catch (err) {
      setError(`Upload failed: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  const lead = pending?.parsed.party[0]
  return (
    <div className="panel">
      <h2>
        <span className="h2-title"><History size={14} /> Backup history</span>
        <span className="h-actions">
          {run && (
            <button className="small" title="Import a battery save from an offline emulator (.sav)" onClick={() => fileRef.current?.click()}>
              <Upload size={12} /> Upload .sav
            </button>
          )}
          <button className="small" onClick={load}><RefreshCw size={12} /> Refresh</button>
        </span>
      </h2>
      <input ref={fileRef} type="file" accept=".sav,.srm,.sa1,.fla" style={{ display: 'none' }} onChange={(e) => pickFile(e.target.files?.[0])} />
      {error && <p className="error-note">{error}</p>}
      {uploadMsg && <p className="map-tip">{uploadMsg}</p>}
      {pending && (
        <div className="upload-confirm">
          <p style={{ margin: '0 0 6px' }}>
            <strong>{pending.name}</strong> — {pending.parsed.game}, save #{pending.parsed.saveIndex}:
            {' '}party of {pending.parsed.party.length}
            {lead && <> led by <strong>{titleCase(lead.nickname || '?')}</strong> Lv. {lead.level}</>}
            {pending.pcCount ? <>, {pending.pcCount} in the PC</> : null}
            {' '}at {areaLabel(pending.parsed.location.mapGroup, pending.parsed.location.mapNum)}.
          </p>
          <p className="map-tip" style={{ margin: '0 0 8px' }}>
            This becomes your latest battery save (the one Start boots by default). Your current one stays in the history below.
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="small primary" disabled={busy} onClick={confirmUpload}>{busy ? 'Uploading…' : 'Make it my latest save'}</button>
            <button className="small" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
      {!history || history.files.length === 0 ? (
        <p className="empty-note">No backups yet — they appear automatically every time you save in-game{run ? ', or upload a .sav from an offline emulator' : ''}.</p>
      ) : (
        <>
          <p className="map-tip" style={{ marginTop: 0 }}>
            {history.files.length} file{history.files.length === 1 ? '' : 's'} ·
            {' '}{(history.totalSize / 1048576).toFixed(1)} MB of {(history.cap / 1073741824).toFixed(0)} GB —
            oldest are pruned automatically. The newest pair is what the game auto-resumes from.
          </p>
          <div className="hist-list">
            {history.files.slice(0, shown).map((f) => (
              <div className="hist-row" key={f.file}>
                <span className="hist-main">
                  Attempt #{f.attemptNumber ?? '?'} · <code>{f.type === 'mstate' ? '.state (manual)' : `.${f.type}`}</code>
                  {f.uploaded && <span className="hist-tag" title="Imported from an offline emulator">uploaded</span>}
                </span>
                <span className="hist-meta">{new Date(f.savedAt).toLocaleString()} · {(f.size / 1024).toFixed(0)} KB</span>
                <button className="small" title="Download" onClick={() => download(f)}><Download size={12} /></button>
              </div>
            ))}
          </div>
          {history.files.length > shown && (
            <button className="small" style={{ marginTop: 6 }} onClick={() => setShown((n) => n + 25)}>
              Show more ({history.files.length - shown} hidden)
            </button>
          )}
        </>
      )}
    </div>
  )
}
