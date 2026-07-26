import React, { useEffect, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { api } from '../api.js'

export default function DiaryPanel({ run, locations }) {
  const [entries, setEntries] = useState([])
  const [text, setText] = useState('')
  const [location, setLocation] = useState('')

  useEffect(() => {
    api.get(`/api/runs/${run.id}/diary`).then(setEntries).catch(() => {})
  }, [run.id])

  const add = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    const entry = await api.post(`/api/runs/${run.id}/diary`, { text: text.trim(), location: location.trim() })
    setEntries((es) => [entry, ...es])
    setText('')
    setLocation('')
  }

  const remove = async (entry) => {
    if (!window.confirm('Delete this diary entry?')) return
    await api.del(`/api/diary/${entry.id}`)
    setEntries((es) => es.filter((e) => e.id !== entry.id))
  }

  return (
    <div className="panel">
      <h2><span className="h2-title"><BookOpen size={14} /> Run diary</span></h2>
      <form className="diary-form" onSubmit={add}>
        <textarea
          placeholder="What just happened? (deaths, clutch catches, near-wipes…)"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row">
          <input
            list="diary-location-options"
            placeholder="Location (optional)"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            style={{ flex: 1 }}
          />
          <datalist id="diary-location-options">
            {locations.map((l) => <option key={l} value={l} />)}
          </datalist>
          <button className="primary" type="submit" disabled={!text.trim()}>Add entry</button>
        </div>
      </form>
      {entries.length === 0 ? (
        <p className="empty-note">No entries yet — the story starts here.</p>
      ) : (
        entries.map((entry) => (
          <div className="diary-entry" key={entry.id}>
            <button className="small danger del" onClick={() => remove(entry)} title="Delete">✕</button>
            <div className="meta">
              <span>{new Date(entry.createdAt).toLocaleString()}</span>
              {entry.location && <span className="loc">@ {entry.location}</span>}
            </div>
            <p>{entry.text}</p>
          </div>
        ))
      )}
    </div>
  )
}
