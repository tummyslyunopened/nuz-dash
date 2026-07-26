import React, { useEffect, useRef, useState } from 'react'
import { api, spriteUrl, titleCase } from '../api.js'
import { calibrate, scanEnemies, probe, deepScan, dumpHeap, findSpeciesTable, speciesTableName } from '../gen3ram.js'
import { loadIndex } from './PokemonSearch.jsx'
import { emulatorRunning } from './EmulatorPanel.jsx'

const STATUSES = [
  { key: 'caught', label: '● Caught' },
  { key: 'killed', label: '✖ Killed' },
  { key: 'fled', label: '→ Fled' },
  { key: 'missed', label: '○ Missed' }
]

function SuggestionCard({ mon, name, run, encounters, locations, onLog, onPrefill, onDismiss }) {
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const loc = location.trim()
  const locationUsed = loc && encounters.some((e) => e.location.toLowerCase() === loc.toLowerCase())
  const speciesSeen = mon.nationalId && encounters.some((e) => e.speciesId === mon.nationalId)

  return (
    <div className="radar-card">
      <img src={mon.nationalId ? spriteUrl(mon.nationalId, mon.shiny) : null} alt="" />
      <div className="rc-body">
        <div className="rc-title">
          Wild <strong>{name ? titleCase(name) : `species #${mon.maskedSpecies ?? mon.internalSpecies}`}</strong> · Lv. {mon.level}
          {mon.shiny && <span className="shiny-star" title="Shiny"> ✦</span>}
        </div>
        {name ? (
          <>
            <div className="rc-row">
              <input
                list="radar-location-options"
                placeholder="Location…"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
              <datalist id="radar-location-options">
                {locations.map((l) => <option key={l} value={l} />)}
              </datalist>
            </div>
            {(locationUsed || (speciesSeen && run.rules.dupesClause && !(mon.shiny && run.rules.shinyClause))) && (
              <div className="rc-warn">
                {locationUsed && 'Location already has an encounter. '}
                {speciesSeen && run.rules.dupesClause && !(mon.shiny && run.rules.shinyClause) && 'Species already encountered (dupes clause).'}
              </div>
            )}
            <div className="rc-row rc-actions">
              {STATUSES.map((s) => (
                <button
                  key={s.key}
                  className="small"
                  disabled={!loc || busy}
                  onClick={async () => {
                    setBusy(true)
                    try { await onLog(mon, name, s.key, loc) } finally { setBusy(false) }
                  }}
                >{s.label}</button>
              ))}
            </div>
          </>
        ) : (
          <div className="rc-warn">Unknown species id (ROM-hack addition?) — log it manually.</div>
        )}
        <div className="rc-row rc-actions">
          <button className="small" onClick={() => onPrefill(mon, name)}>Edit in form</button>
          <button className="small" onClick={onDismiss}>Dismiss (trainer battle / repeat)</button>
        </div>
      </div>
    </div>
  )
}

export default function EncounterRadar({ run, encounters, party, locations, onPrefill, onLogged }) {
  const [watching, setWatching] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [idToName, setIdToName] = useState({})
  const [debugOpen, setDebugOpen] = useState(false)
  const [probeInfo, setProbeInfo] = useState([])
  const [scanCount, setScanCount] = useState(0)
  const [extraDeltas, setExtraDeltas] = useState([])
  const [toolMsg, setToolMsg] = useState('')
  const seenRef = useRef(new Set())
  const primedRef = useRef(false)
  const tableRef = useRef(null) // species-name table found in the game's memory
  const nameToIdRef = useRef({})

  useEffect(() => {
    loadIndex().then((index) => {
      const m = {}
      const n = {}
      for (const p of index) { m[p.id] = p.name; n[p.name] = p.id }
      setIdToName(m)
      nameToIdRef.current = n
    }).catch(() => {})
  }, [])

  // Attach the best available species name/national id to a detected mon.
  // Vanilla path first; otherwise the hack's own ROM name table.
  const enrich = (mon) => {
    if (mon.nationalId && idToName[mon.nationalId]) {
      return { ...mon, _name: idToName[mon.nationalId] }
    }
    if (tableRef.current) {
      const romName = speciesTableName(tableRef.current, mon.maskedSpecies)
      if (romName) {
        const lower = romName.toLowerCase()
        const natId = nameToIdRef.current[lower] ?? null
        return { ...mon, _name: lower, nationalId: natId }
      }
      return null // table available but id has no readable name -> junk struct
    }
    return { ...mon, _name: '' }
  }

  const stoppedByUserRef = useRef(false)

  const doStart = (silent) => {
    if (!silent) setError('')
    try {
      if (!emulatorRunning()) throw new Error('Start the game first.')
      const { candidates: found, totalHits } = calibrate(party)
      setCandidates(found)
      seenRef.current = new Set(party.map((p) => p.personality))
      primedRef.current = false // first scan swallows stale pre-existing enemies
      setScanCount(0)
      try { tableRef.current = findSpeciesTable() } catch { tableRef.current = null }
      setWatching(true)
      setError('')
      setStatus(`Calibrated (${totalHits} party hit${totalHits === 1 ? '' : 's'}) — watching ${found.length} location${found.length === 1 ? '' : 's'}.${tableRef.current ? ` Species names read from the game's own table (stride ${tableRef.current.stride}).` : ''}`)
      return true
    } catch (err) {
      if (!silent) setError(err.message)
      return false
    }
  }

  const start = () => {
    stoppedByUserRef.current = false
    doStart(false)
  }

  const stop = () => {
    stoppedByUserRef.current = true
    setWatching(false)
    setStatus('')
  }

  // Auto-start (and auto-recover after errors or save-state loads): retry
  // every 5s whenever we have a party anchor and a running game, unless the
  // user explicitly pressed Stop.
  useEffect(() => {
    if (watching) return
    const t = setInterval(() => {
      if (stoppedByUserRef.current || !party.length || !emulatorRunning()) return
      doStart(true)
    }, 5000)
    return () => clearInterval(t)
  }, [watching, party]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!watching) return
    const tick = () => {
      try {
        const enemies = scanEnemies(candidates, (pid) => seenRef.current.has(pid), [600, -600, ...extraDeltas])
        for (const raw of enemies) {
          seenRef.current.add(raw.personality)
          const mon = enrich(raw)
          if (mon && primedRef.current) setSuggestions((s) => [...s, mon])
        }
        primedRef.current = true
        setScanCount((c) => c + 1)
        if (debugOpen) setProbeInfo(probe(candidates))
      } catch (err) {
        setError(`${err.message} — detection stopped.`)
        setWatching(false)
      }
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [watching, candidates, debugOpen, extraDeltas]) // eslint-disable-line react-hooks/exhaustive-deps

  // One-shot wide search — press this DURING a battle. Any valid enemy found at
  // a non-standard offset teaches the per-second scan its delta.
  const runDeepScan = () => {
    setToolMsg('Deep scanning…')
    try {
      const results = deepScan(candidates, (pid) => seenRef.current.has(pid))
        .map((r) => ({ ...r, mon: enrich(r.mon) }))
        .filter((r) => r.mon) // drop junk structs the name table can't validate
      if (!results.length) {
        setToolMsg('Deep scan: no valid enemy Pokemon found within ±16KB of the watched regions. If you are mid-battle, take a memory dump so I can analyze it.')
        return
      }
      // Learn only plausible nearby offsets, and keep the watch list small —
      // distant hits are box/save copies, not the enemy party.
      const newDeltas = [...new Set(results.map((r) => r.delta))]
        .filter((d) => d !== 600 && d !== -600 && Math.abs(d) <= 2400)
      if (newDeltas.length) {
        setExtraDeltas((ds) => [...new Set([...ds, ...newDeltas])].slice(0, 12))
      }
      for (const r of results.slice(0, 8)) {
        seenRef.current.add(r.mon.personality)
        setSuggestions((s) => [...s, r.mon])
      }
      setToolMsg(`Deep scan: found ${results.length} Pokemon at offset${results.length === 1 ? '' : 's'} ${results.slice(0, 10).map((r) => (r.delta > 0 ? '+' : '') + r.delta).join(', ')}${newDeltas.length ? ' — now watching nearby offsets continuously.' : '.'}`)
    } catch (err) {
      setToolMsg(`Deep scan failed: ${err.message}`)
    }
  }

  const dump = async () => {
    setToolMsg('Dumping emulator memory…')
    try {
      const bytes = dumpHeap()
      const meta = {
        note: 'nuz-dash heap dump',
        candidates,
        extraDeltas,
        party: party.map((m) => ({ personality: m.personality, otId: m.otId, nickname: m.nickname, internalSpecies: m.internalSpecies }))
      }
      const res = await fetch('/api/debug/heapdump', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Dump-Meta': encodeURIComponent(JSON.stringify(meta))
        },
        body: bytes
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const info = await res.json()
      setToolMsg(`Dump saved: ${info.file} (${(info.size / 1048576).toFixed(1)} MB). Take it during a battle for best results.`)
    } catch (err) {
      setToolMsg(`Dump failed: ${err.message}`)
    }
  }

  const dismiss = (mon) => setSuggestions((s) => s.filter((x) => x !== mon))

  const log = async (mon, name, statusKey, location) => {
    let chainId = null
    try { chainId = (await api.get(`/api/family/${name}`)).chainId } catch { /* optional */ }
    const enc = await api.post(`/api/runs/${run.id}/encounters`, {
      location,
      speciesName: name,
      speciesId: mon.nationalId,
      chainId,
      status: statusKey,
      nickname: '',
      level: mon.level,
      shiny: mon.shiny
    })
    onLogged(enc)
    dismiss(mon)
  }

  const prefill = (mon, name) => {
    onPrefill({
      speciesName: name || '',
      speciesId: mon.nationalId,
      nickname: '',
      level: mon.level,
      shiny: mon.shiny
    })
    dismiss(mon)
  }

  return (
    <div className="panel">
      <h2>
        Encounter radar
        <span className="h-actions">
          {watching
            ? <button className="small" onClick={stop}>Stop</button>
            : <button className="small primary" onClick={start} disabled={!party.length}>Start detection</button>}
        </span>
      </h2>
      {error && <p className="error-note">{error}</p>}
      {!party.length ? (
        <p className="empty-note">
          Starts automatically once the game is running and the party has synced (save in-game if it hasn't yet).
        </p>
      ) : !watching && !suggestions.length ? (
        <p className="empty-note">
          Starting automatically within a few seconds… wild battles will pop up here for confirmation.
        </p>
      ) : null}
      {watching && status && (
        <p className="map-tip">
          {status} Scans: {scanCount}. Trainer battles trigger suggestions too — just dismiss those. Re-calibrate after loading a save state.
        </p>
      )}
      {watching && (
        <details open={debugOpen} onToggle={(e) => setDebugOpen(e.target.open)}>
          <summary className="map-tip" style={{ cursor: 'pointer' }}>Diagnostics</summary>
          <div className="rc-row" style={{ display: 'flex', gap: 6, margin: '6px 0', flexWrap: 'wrap' }}>
            <button className="small" onClick={runDeepScan}>Deep scan (use during battle)</button>
            <button className="small" onClick={dump}>Dump memory for analysis</button>
          </div>
          {extraDeltas.length > 0 && (
            <p className="map-tip">Learned offsets: {extraDeltas.map((d) => (d > 0 ? '+' : '') + d).join(', ')}</p>
          )}
          {toolMsg && <p className="map-tip">{toolMsg}</p>}
          {probeInfo.length === 0 ? (
            <p className="map-tip">Waiting for next scan…</p>
          ) : (
            <ul className="map-tip" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {probeInfo.map((p, i) => (
                <li key={i}>
                  base 0x{p.base.toString(16)} {p.delta > 0 ? '+' : ''}{p.delta}: species {p.species}, Lv {p.level}, HP {p.hp} — {p.sane ? 'valid mon ✓' : 'not a mon'}
                </li>
              ))}
            </ul>
          )}
        </details>
      )}
      {suggestions.map((mon) => (
        <SuggestionCard
          key={mon.personality}
          mon={mon}
          name={mon._name || (mon.nationalId && idToName[mon.nationalId]) || ''}
          run={run}
          encounters={encounters}
          locations={locations}
          onLog={log}
          onPrefill={prefill}
          onDismiss={() => dismiss(mon)}
        />
      ))}
    </div>
  )
}
