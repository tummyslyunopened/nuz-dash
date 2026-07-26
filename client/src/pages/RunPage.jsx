import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LayoutDashboard, Gamepad2 } from 'lucide-react'
import { api } from '../api.js'
import EncountersPanel from '../components/EncountersPanel.jsx'
import MapPanel from '../components/MapPanel.jsx'
import TypeLookup from '../components/TypeLookup.jsx'
import DiaryPanel from '../components/DiaryPanel.jsx'
import EmulatorPanel from '../components/EmulatorPanel.jsx'
import LivePartyPanel from '../components/LivePartyPanel.jsx'
import EncounterRadar from '../components/EncounterRadar.jsx'
import WatchPartyPanel from '../components/WatchPartyPanel.jsx'

export default function RunPage() {
  const { token, id } = useParams()
  const [run, setRun] = useState(null)
  const [encounters, setEncounters] = useState([])
  const [locations, setLocations] = useState([])
  const [map, setMap] = useState(null)
  const [error, setError] = useState('')
  const [view, setView] = useState('play') // play (default) | dash
  const [prefill, setPrefill] = useState(null)
  const [lastParty, setLastParty] = useState([])

  useEffect(() => {
    api.get(`/api/runs/${id}`).then((r) => {
      setRun(r)
      api.get(`/api/maps/${r.gameId}`).then(setMap).catch(() => setMap({ image: null, pins: {}, nodes: {} }))
      api.get(`/api/locations/${r.gameId}`).then(setLocations).catch(() => setLocations([]))
    }).catch((e) => setError(e.message))
    api.get(`/api/runs/${id}/encounters`).then(setEncounters).catch(() => {})
  }, [id])

  if (error) {
    return (
      <div className="app-shell">
        <p className="error-note">{error}</p>
        <Link to={`/m/${token}`} style={{ color: 'var(--accent)' }}>← Back to lobby</Link>
      </div>
    )
  }
  if (!run || !map) return <div className="app-shell"><p className="empty-note">Loading run…</p></div>

  const saveRun = async (patch) => {
    const updated = await api.put(`/api/runs/${run.id}`, patch)
    setRun(updated)
  }

  const capIndex = Math.min(run.badges, Math.max(run.caps.length - 1, 0))
  const nextCap = run.caps[capIndex]
  const maxBadges = run.caps.length
  const deaths = encounters.filter((e) => e.status === 'caught' && !e.alive).length
  const team = encounters.filter((e) => e.status === 'caught' && e.alive).length

  const editCap = (value) => {
    const caps = run.caps.map((c, i) => (i === capIndex ? { ...c, cap: Number(value) || 0 } : c))
    saveRun({ caps })
  }

  const markEncounterDead = async (enc, note) => {
    const updated = await api.put(`/api/encounters/${enc.id}`, { alive: false, deathNote: note })
    setEncounters((es) => es.map((e) => (e.id === enc.id ? updated : e)))
  }

  const importFromGame = (mon) => {
    setPrefill({
      key: Date.now(),
      species: { name: mon.speciesName, id: mon.speciesId },
      nickname: mon.nickname,
      level: mon.level,
      shiny: mon.shiny
    })
  }

  return (
    <div className="app-shell">
      <div className="run-header">
        <div className="run-title">
          <h1>
            {run.attemptNumber ? `Attempt #${run.attemptNumber} — ` : ''}{run.name}
            {run.status === 'archived' && <span className="chip" style={{ marginLeft: 8, verticalAlign: 'middle' }}>ARCHIVED</span>}
          </h1>
          <div className="sub">
            <Link to={`/m/${token}`} style={{ color: 'var(--muted)' }}>← lobby</Link> · {run.gameName} · started {new Date(run.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div className="view-toggle">
          <button className={view === 'dash' ? 'active' : ''} onClick={() => setView('dash')}><LayoutDashboard size={13} /> Dashboard</button>
          <button className={view === 'play' ? 'active' : ''} onClick={() => setView('play')}><Gamepad2 size={13} /> Play</button>
        </div>
        <div className="stat-tiles">
          <div className="stat-tile">
            <div className="value">
              {run.badges}
              <span className="steppers">
                <button className="small" onClick={() => saveRun({ badges: run.badges - 1 })} disabled={run.badges <= 0}>−</button>
                <button className="small" onClick={() => saveRun({ badges: run.badges + 1 })} disabled={run.badges >= maxBadges}>+</button>
              </span>
            </div>
            <div className="label">Badges</div>
          </div>
          {run.rules.hardcore && nextCap && (
            <div className="stat-tile cap">
              <div className="value">
                <input
                  type="number"
                  value={nextCap.cap}
                  onChange={(e) => editCap(e.target.value)}
                  title="Level cap (editable — community cap lists vary)"
                />
              </div>
              <div className="label">Cap · {nextCap.label}</div>
            </div>
          )}
          <div className="stat-tile">
            <div className="value" style={{ color: 'var(--good)' }}>{team}</div>
            <div className="label">● Alive</div>
          </div>
          <div className="stat-tile">
            <div className="value" style={{ color: deaths > 0 ? 'var(--critical)' : 'var(--text)' }}>{deaths}</div>
            <div className="label">☠ Deaths</div>
          </div>
        </div>
        <div className="rule-chips">
          <button
            className={`chip ${run.rules.dupesClause ? 'on' : ''}`}
            onClick={() => saveRun({ rules: { dupesClause: !run.rules.dupesClause } })}
            title="Toggle dupes clause"
          >
            Dupes clause {run.rules.dupesClause ? 'ON' : 'OFF'}
          </button>
          <button
            className={`chip ${run.rules.shinyClause ? 'on' : ''}`}
            onClick={() => saveRun({ rules: { shinyClause: !run.rules.shinyClause } })}
            title="Toggle shiny clause"
          >
            ✦ Shiny clause {run.rules.shinyClause ? 'ON' : 'OFF'}
          </button>
          <button
            className={`chip ${run.rules.hardcore ? 'on' : ''}`}
            onClick={() => saveRun({ rules: { hardcore: !run.rules.hardcore } })}
            title="Toggle hardcore mode"
          >
            Hardcore {run.rules.hardcore ? 'ON — level caps · no battle items · set mode' : 'OFF'}
          </button>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-col">
          {/* The emulator must stay mounted once started, so views hide via CSS */}
          <div className="dash-col" style={{ display: view === 'play' ? 'flex' : 'none' }}>
            <EmulatorPanel run={run} setRun={setRun} />
            <EncounterRadar
              run={run}
              encounters={encounters}
              party={lastParty}
              locations={locations}
              onPrefill={importFromGame}
              onLogged={(enc) => setEncounters((es) => [...es, enc])}
            />
            <LivePartyPanel
              run={run}
              encounters={encounters}
              onMarkDead={markEncounterDead}
              onImport={importFromGame}
              onParty={setLastParty}
            />
          </div>
          <div className="dash-col" style={{ display: view === 'dash' ? 'flex' : 'none' }}>
            <MapPanel run={run} encounters={encounters} locations={locations} map={map} setMap={setMap} />
            <TypeLookup />
          </div>
        </div>
        <div className="dash-col">
          <EncountersPanel run={run} encounters={encounters} setEncounters={setEncounters} locations={locations} prefill={prefill} />
          <div style={{ display: view === 'play' ? 'block' : 'none' }}>
            <WatchPartyPanel />
          </div>
          <DiaryPanel run={run} locations={locations} />
        </div>
      </div>
    </div>
  )
}
