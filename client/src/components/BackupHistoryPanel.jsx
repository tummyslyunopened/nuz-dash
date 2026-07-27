import React, { useEffect, useState } from 'react'
import { History, RefreshCw, Download } from 'lucide-react'
import { authHeaders } from '../api.js'
import { api } from '../api.js'

// Rolling per-runner save archive — lives in the play area, next to the game
// it backs up. Every in-game save lands here automatically.
export default function BackupHistoryPanel() {
  const [history, setHistory] = useState(null)
  const [shown, setShown] = useState(10)
  const [error, setError] = useState('')

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

  return (
    <div className="panel">
      <h2>
        <span className="h2-title"><History size={14} /> Backup history</span>
        <span className="h-actions">
          <button className="small" onClick={load}><RefreshCw size={12} /> Refresh</button>
        </span>
      </h2>
      {error && <p className="error-note">{error}</p>}
      {!history || history.files.length === 0 ? (
        <p className="empty-note">No backups yet — they appear automatically every time you save in-game.</p>
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
