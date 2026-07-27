import React, { useState } from 'react'
import { Swords, Check, X } from 'lucide-react'
import { api, spriteUrl, titleCase } from '../api.js'

// Trainer battles, auto-tracked by the radar and grouped by the opposing
// trainer's OT id — one row per trainer, however many mons they threw at you.
// Name/location/notes annotate inline, like the Encounters table.
export default function TrainersPanel({ run, trainers, setTrainers, readOnly }) {
  const [busyId, setBusyId] = useState(null)

  const patch = async (t, body) => {
    setBusyId(t.id)
    try {
      const updated = await api.put(`/api/trainers/${t.id}`, body)
      setTrainers((ts) => ts.map((x) => (x.id === updated.id ? updated : x)))
    } catch { /* stale row — next radar upsert refreshes */ } finally {
      setBusyId(null)
    }
  }

  const remove = async (t) => {
    if (!window.confirm(`Remove trainer ${t.name || '#' + String(t.otId).slice(-5)} from the list?`)) return
    try {
      await api.del(`/api/trainers/${t.id}`)
      setTrainers((ts) => ts.filter((x) => x.id !== t.id))
    } catch { /* already gone */ }
  }

  const rows = [...trainers].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))

  return (
    <div className="panel">
      <h2><span className="h2-title"><Swords size={14} /> Trainers</span>
        <span style={{ textTransform: 'none', letterSpacing: 0 }}> · {rows.length} met · {rows.filter((t) => t.status === 'beaten').length} beaten</span>
      </h2>
      {rows.length === 0 ? (
        <p className="empty-note">
          Trainer battles are detected automatically (the enemy's OT id gives them away) and collected here —
          one row per trainer, with every Pokemon they used.
        </p>
      ) : (
        <div className="radar-recent">
          {rows.map((t) => (
            <div className="rr-row trainer-row" key={t.id} style={{ flexWrap: 'wrap', opacity: busyId === t.id ? 0.6 : 1 }}>
              {readOnly ? (
                <strong>{t.name || `Trainer #${String(t.otId).slice(-5)}`}</strong>
              ) : (
                <input
                  style={{ width: 130 }}
                  defaultValue={t.name}
                  placeholder={`Trainer #${String(t.otId).slice(-5)}`}
                  title={`Opponent trainer id ${t.otId}`}
                  onBlur={(e) => e.target.value !== t.name && patch(t, { name: e.target.value })}
                />
              )}
              <span className="rr-note">📍 {t.location || '?'}</span>
              <span className="trainer-mons">
                {t.mons.map((m) => (
                  <span key={m.personality} className="trainer-mon" title={`${titleCase(m.speciesName)} · Lv. ${m.level}`}>
                    {m.speciesId
                      ? <img src={spriteUrl(m.speciesId)} alt={m.speciesName} />
                      : <span className="rr-noimg">?</span>}
                    <span className="tm-lv">{m.level}</span>
                  </span>
                ))}
              </span>
              <span className="spacer" />
              {readOnly ? (
                <span className={`rr-note ${t.status === 'beaten' ? 'st-caught' : ''}`}>{t.status === 'beaten' ? '✓ beaten' : 'seen'}</span>
              ) : (
                <>
                  <button
                    className={`small ${t.status === 'beaten' ? 'primary' : ''}`}
                    title={t.status === 'beaten' ? 'Mark as not beaten yet' : 'Mark trainer as beaten'}
                    onClick={() => patch(t, { status: t.status === 'beaten' ? 'seen' : 'beaten' })}
                  ><Check size={12} /> {t.status === 'beaten' ? 'Beaten' : 'Beat?'}</button>
                  <button className="small danger" title="Remove from list" onClick={() => remove(t)}><X size={12} /></button>
                </>
              )}
              {!readOnly && (
                <input
                  style={{ flexBasis: '100%', marginTop: 4 }}
                  defaultValue={t.notes}
                  placeholder="notes (team, strategy, rematch…)"
                  onBlur={(e) => e.target.value !== t.notes && patch(t, { notes: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
