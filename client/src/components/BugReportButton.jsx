import React, { useState } from 'react'
import { Bug } from 'lucide-react'
import { api } from '../api.js'
import { collectDiagnostics } from '../diagnostics.js'

export default function BugReportButton() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setResult('')
    try {
      const report = { description: text.trim(), diagnostics: collectDiagnostics() }
      const res = await api.post('/api/bug-report', report)
      setResult(`Saved: ${res.file}`)
      setText('')
    } catch (err) {
      setResult(`Failed to save: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="bug-fab" title="Report a bug" onClick={() => { setOpen((o) => !o); setResult('') }}><Bug size={20} /></button>
      {open && (
        <div className="bug-modal panel">
          <h2><span className="h2-title"><Bug size={14} /> Report a bug</span></h2>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea
              autoFocus
              placeholder="What went wrong? What were you doing when it happened?"
              value={text}
              onChange={(e) => setText(e.target.value)}
              style={{ minHeight: 90, resize: 'vertical' }}
            />
            <p className="map-tip" style={{ margin: 0 }}>
              Attaches automatically: recent console errors, browser info, current page (token redacted), and emulator status.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="small" onClick={() => setOpen(false)}>Close</button>
              <button type="submit" className="small primary" disabled={busy || !text.trim()}>
                {busy ? 'Saving…' : 'Submit report'}
              </button>
            </div>
            {result && <p className="map-tip">{result}</p>}
          </form>
        </div>
      )}
    </>
  )
}
