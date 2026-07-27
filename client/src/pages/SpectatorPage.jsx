import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, spriteUrl, titleCase, STATUS_META, encounterState } from '../api.js'
import StreamView from '../components/StreamView.jsx'
import StreamDiagnostics from '../components/StreamDiagnostics.jsx'

export default function SpectatorPage() {
  const { sid, memberId } = useParams()
  const [attempts, setAttempts] = useState(null)
  const [selected, setSelected] = useState(null)
  const [encounters, setEncounters] = useState([])
  const [entries, setEntries] = useState([])
  const [runnerName, setRunnerName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/api/me').then((d) => {
      const runner = d.members.find((m) => m.id === memberId)
      setRunnerName(runner?.name || 'Runner')
    }).catch(() => {})
    api.get(`/api/runs?memberId=${memberId}`).then((rs) => {
      setAttempts(rs)
      setSelected(rs.find((r) => r.status === 'active')?.id || rs[0]?.id || null)
    }).catch((e) => setError(e.message))
  }, [memberId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return
    api.get(`/api/runs/${selected}/encounters`).then(setEncounters).catch(() => setEncounters([]))
    api.get(`/api/runs/${selected}/diary`).then(setEntries).catch(() => setEntries([]))
    const t = setInterval(() => {
      api.get(`/api/runs/${selected}/encounters`).then(setEncounters).catch(() => {})
      api.get(`/api/runs/${selected}/diary`).then(setEntries).catch(() => {})
    }, 15000)
    return () => clearInterval(t)
  }, [selected])

  if (error) return <div className="app-shell"><p className="error-note">{error}</p></div>
  if (!attempts) return <div className="app-shell"><p className="empty-note">Loading…</p></div>

  const run = attempts.find((r) => r.id === selected)

  return (
    <div className="app-shell">
      <div className="run-header">
        <div className="run-title">
          <h1>👁 {runnerName}</h1>
          <div className="sub"><Link to={`/s/${sid}`} style={{ color: 'var(--muted)' }}>← back to lobby</Link> · spectating (read-only, refreshes every 15s)</div>
        </div>
        {run && (
          <div className="stat-tiles">
            <div className="stat-tile"><div className="value">{run.badges}</div><div className="label">Badges</div></div>
            <div className="stat-tile"><div className="value" style={{ color: 'var(--good)' }}>{run.alive}</div><div className="label">● Alive</div></div>
            <div className="stat-tile"><div className="value" style={{ color: run.deaths > 0 ? 'var(--critical)' : 'var(--text)' }}>{run.deaths}</div><div className="label">☠ Deaths</div></div>
          </div>
        )}
      </div>

      <div className="dash-grid">
        <div className="dash-col">
          <div className="panel">
            <h2>Live game</h2>
            <StreamView memberId={memberId} interval={250} showMeta />
            <p className="map-tip">Party and location update live from the runner's game — the tracker below refreshes every 15s.</p>
            <StreamDiagnostics source="view" memberId={memberId} />
          </div>
          <div className="panel">
            <h2>
              Attempts
            </h2>
            {attempts.length === 0 && <p className="empty-note">No attempts yet.</p>}
            {attempts.map((a) => (
              <div className="run-card" key={a.id} style={a.id === selected ? { borderColor: 'var(--accent)' } : {}}>
                <div className="info">
                  <a href="#" onClick={(e) => { e.preventDefault(); setSelected(a.id) }} style={{ color: 'var(--text)', fontWeight: 650 }}>
                    Attempt #{a.attemptNumber} — {a.name} {a.status === 'active' && <span className="chip on" style={{ fontSize: 11 }}>ACTIVE</span>}
                  </a>
                  <div className="sub">{a.gameName} · 🏅{a.badges} · {a.caught} caught · ☠{a.deaths} deaths</div>
                </div>
              </div>
            ))}
          </div>
          <div className="panel">
            <h2>Diary</h2>
            {entries.length === 0 ? <p className="empty-note">No entries.</p> : entries.map((entry) => (
              <div className="diary-entry" key={entry.id}>
                <div className="meta">
                  <span>{new Date(entry.createdAt).toLocaleString()}</span>
                  {entry.location && <span className="loc">@ {entry.location}</span>}
                </div>
                <p>{entry.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Encounters {run && `— Attempt #${run.attemptNumber}`}</h2>
          {encounters.length === 0 ? (
            <p className="empty-note">Nothing yet.</p>
          ) : (
            <div className="table-scroll">
            <table className="enc-table">
              <thead><tr><th>Pokemon</th><th>Location</th><th>Lv.</th><th>Status</th></tr></thead>
              <tbody>
                {encounters.map((enc) => {
                  const state = encounterState(enc)
                  const meta = STATUS_META[state]
                  return (
                    <tr key={enc.id} className={state === 'dead' ? 'enc-dead' : ''}>
                      <td>
                        <div className="enc-name">
                          <img src={spriteUrl(enc.speciesId, enc.shiny)} alt="" loading="lazy" />
                          <div>
                            <div className="nick">
                              {enc.nickname || titleCase(enc.speciesName)}
                              {enc.shiny && <span className="shiny-star"> ✦</span>}
                            </div>
                            <div className="species">
                              {titleCase(enc.speciesName)}
                              {state === 'dead' && enc.deathNote && <span className="death-note"> — {enc.deathNote}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>{enc.location}</td>
                      <td className="mono">{enc.level ?? '—'}</td>
                      <td><span className={`status-badge ${meta.cls}`}>{meta.icon} {meta.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
