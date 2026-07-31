import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, HelpCircle } from 'lucide-react'
import { api, memberToken } from '../api.js'
import Tour from '../components/Tour.jsx'
import BackupHistoryPanel from '../components/BackupHistoryPanel.jsx'

const PLAY_TOUR_STEPS = [
  {
    title: 'Your play screen 🎮',
    body: 'Everything lives here now: the game, the trackers that watch it, and your lobby-mates\' streams. Quick lap around the room?'
  },
  {
    selector: '[data-tour="game"]',
    title: 'The game',
    body: 'Pick which save to boot (latest is the default — every in-game save is archived automatically) and hit Start. On phones the game goes fullscreen; the "Play on phone" button up top hops the run to your phone via QR.'
  },
  {
    selector: '[data-tour="radar"]',
    title: 'Encounter radar',
    body: 'Every wild battle is detected from the game\'s memory and logged automatically with its route — no clicks. Trainer battles are recognized and kept separate. If a detection is ever wrong, hit "✕ false?" right on the notification.'
  },
  {
    selector: '[data-tour="party"]',
    title: 'Live party',
    body: 'Your team, HP and current location, read straight from the running game. Faints prompt a one-tap "mark dead in tracker", and every in-game save updates your server backup.'
  },
  {
    selector: '[data-tour="map"]',
    title: 'Route map',
    body: 'The lobby\'s shared map — drag locations into the shape of the region and watch encounter pins fill it in as everyone plays.'
  },
  {
    selector: '[data-tour="encounters"]',
    title: 'Encounters',
    body: 'The Nuzlocke ledger. Auto-logged encounters land here with their route pre-filled — annotate status and nicknames inline. Catches flip to ● Caught by themselves when the Pokemon joins your party.'
  },
  {
    selector: '[data-tour="trainers"]',
    title: 'Trainers',
    body: 'Every trainer you battle, grouped by trainer — their Pokemon, where you fought, and a Beaten toggle. Name them as you figure out who\'s who.'
  },
  {
    selector: '[data-tour="watchparty"]',
    title: 'Watch while you play',
    body: 'Your lobby-mates\' live games, right next to yours. Tap a tile to spectate their full run.'
  },
  {
    selector: '[data-tour="backup"]',
    title: 'Backup history',
    body: 'Timestamped save backups pile up here automatically. Download any of them, or boot from one using the save picker above the Start button — your safety net lives next to the game it protects.'
  }
]
import EncountersPanel from '../components/EncountersPanel.jsx'
import MapPanel from '../components/MapPanel.jsx'
import TypeLookup from '../components/TypeLookup.jsx'
import DiaryPanel from '../components/DiaryPanel.jsx'
import EmulatorPanel from '../components/EmulatorPanel.jsx'
import LivePartyPanel from '../components/LivePartyPanel.jsx'
import EncounterRadar from '../components/EncounterRadar.jsx'
import WatchPartyPanel from '../components/WatchPartyPanel.jsx'
import QrLaunchButton from '../components/QrLaunchButton.jsx'
import TrainersPanel from '../components/TrainersPanel.jsx'
import PCBoxPanel from '../components/PCBoxPanel.jsx'

export default function RunPage() {
  const { sid, id } = useParams()
  const [run, setRun] = useState(null)
  const [encounters, setEncounters] = useState([])
  const [locations, setLocations] = useState([])
  const [map, setMap] = useState(null)
  const [error, setError] = useState('')
  const [prefill, setPrefill] = useState(null)
  const [lastParty, setLastParty] = useState([])
  const [trainerId, setTrainerId] = useState(null)
  const [savInfo, setSavInfo] = useState(null) // sav-derived layout facts for the radar
  const [area, setArea] = useState('') // live current location from the radar
  const [livePos, setLivePos] = useState(null) // live tile position from the radar
  const [trainers, setTrainers] = useState([])
  const [tourOpen, setTourOpen] = useState(false)

  // First visit to the play area: run the play tour once per member
  useEffect(() => {
    if (!run) return
    try {
      if (localStorage.getItem(`nuz-play-tour-done:${memberToken}`)) return
    } catch { return }
    const t = setTimeout(() => setTourOpen(true), 700)
    return () => clearTimeout(t)
  }, [run?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const closeTour = () => {
    setTourOpen(false)
    try { localStorage.setItem(`nuz-play-tour-done:${memberToken}`, '1') } catch { /* private mode */ }
  }

  useEffect(() => {
    api.get(`/api/runs/${id}`).then((r) => {
      setRun(r)
      api.get(`/api/maps/${r.gameId}`).then(setMap).catch(() => setMap({ image: null, pins: {}, nodes: {} }))
      api.get(`/api/locations/${r.gameId}`).then(setLocations).catch(() => setLocations([]))
    }).catch((e) => setError(e.message))
    api.get(`/api/runs/${id}/encounters`).then(setEncounters).catch(() => {})
    api.get(`/api/runs/${id}/trainers`).then(setTrainers).catch(() => {})
  }, [id])

  // Live overlay data for watch-party viewers — rides along with the stream
  // frames (read by the broadcast loop in EmulatorPanel).
  useEffect(() => {
    window.__nuzStreamMeta = {
      area: area || null,
      pos: livePos, // { x, y, map, gx?, gy? } — drives the lobby live map
      party: lastParty.slice(0, 6).map((m) => ({
        speciesId: m.nationalId ?? null,
        level: m.level,
        hp: m.hp,
        maxHp: m.maxHp,
        shiny: !!m.shiny
      }))
    }
    return () => { window.__nuzStreamMeta = null }
  }, [area, lastParty, livePos])

  if (error) {
    return (
      <div className="app-shell">
        <p className="error-note">{error}</p>
        <Link to={`/s/${sid}`} style={{ color: 'var(--accent)' }}>← Back to lobby</Link>
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

  // Radar auto-logged this mon and it just appeared in the synced party
  const autoCaught = async (enc, mon) => {
    try {
      const updated = await api.put(`/api/encounters/${enc.id}`, {
        status: 'caught',
        alive: true,
        nickname: mon.nickname || enc.nickname,
        level: mon.level ?? enc.level
      })
      setEncounters((es) => es.map((e) => (e.id === enc.id ? updated : e)))
    } catch { /* next sync retries the match */ }
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
      {tourOpen && <Tour steps={PLAY_TOUR_STEPS} onClose={closeTour} />}
      <div className="run-header">
        <div className="run-title">
          <h1>
            {run.attemptNumber ? `Attempt #${run.attemptNumber} — ` : ''}{run.name}
            {run.status === 'archived' && <span className="chip" style={{ marginLeft: 8, verticalAlign: 'middle' }}>ARCHIVED</span>}
          </h1>
          <div className="sub">
            <Link to={`/s/${sid}`} style={{ color: 'var(--muted)' }}>← lobby</Link> · {run.gameName} · started {new Date(run.createdAt).toLocaleDateString()}
          </div>
        </div>
        <Link to={`/s/${sid}`}>
          <button className="primary"><ArrowLeft size={13} /> Return to lobby</button>
        </Link>
        <QrLaunchButton runId={run.id} />
        <button className="chip" onClick={() => setTourOpen(true)} title="Replay the play-screen walkthrough">
          <HelpCircle size={13} /> Tour
        </button>
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
          <div data-tour="game"><EmulatorPanel run={run} setRun={setRun} /></div>
          <div data-tour="radar">
          <EncounterRadar
            run={run}
            encounters={encounters}
            party={lastParty}
            trainerId={trainerId}
            savInfo={savInfo}
            onLogged={(enc) => setEncounters((es) => [...es, enc])}
            onUnlogged={(encId) => setEncounters((es) => es.filter((e) => e.id !== encId))}
            onArea={setArea}
            onPos={setLivePos}
            onTrainerLogged={(t) => setTrainers((ts) => (ts.some((x) => x.id === t.id) ? ts.map((x) => (x.id === t.id ? t : x)) : [...ts, t]))}
          />
          </div>
          <div data-tour="party">
          <LivePartyPanel
            run={run}
            encounters={encounters}
            area={area}
            onMarkDead={markEncounterDead}
            onImport={importFromGame}
            onParty={(party, tid, parsed) => { setLastParty(party); if (tid != null) setTrainerId(tid); if (parsed) setSavInfo(parsed) }}
            onAutoCaught={autoCaught}
          />
          </div>
          <PCBoxPanel run={run} />
          <div data-tour="map"><MapPanel run={run} encounters={encounters} locations={locations} map={map} setMap={setMap} /></div>
          <TypeLookup />
        </div>
        <div className="dash-col">
          <div data-tour="encounters"><EncountersPanel run={run} encounters={encounters} setEncounters={setEncounters} locations={locations} prefill={prefill} /></div>
          <div data-tour="trainers"><TrainersPanel run={run} trainers={trainers} setTrainers={setTrainers} /></div>
          <div data-tour="watchparty"><WatchPartyPanel /></div>
          <div data-tour="backup"><BackupHistoryPanel run={run} /></div>
          <DiaryPanel run={run} locations={locations} />
        </div>
      </div>
    </div>
  )
}
