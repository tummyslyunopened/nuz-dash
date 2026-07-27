import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Radar, ScanSearch, HardDriveDownload } from 'lucide-react'
import { api, spriteUrl, titleCase, authHeaders } from '../api.js'
import { TYPE_COLORS, TYPE_EMOJI } from '../typechart.js'
import { calibrate, scanEnemies, probe, deepScan, dumpHeap, findSpeciesTable, speciesTableName } from '../gen3ram.js'
import { loadIndex } from './PokemonSearch.jsx'
import { emulatorRunning } from './EmulatorPanel.jsx'

export default function EncounterRadar({ run, encounters, party, trainerId, onLogged }) {
  const [watching, setWatching] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [recent, setRecent] = useState([]) // latest auto-logged detections
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [idToName, setIdToName] = useState({})
  const [debugOpen, setDebugOpen] = useState(false)
  const [probeInfo, setProbeInfo] = useState([])
  const [scanCount, setScanCount] = useState(0)
  const [extraDeltas, setExtraDeltas] = useState([])
  const [toolMsg, setToolMsg] = useState('')
  const [fsActive, setFsActive] = useState(() => !!window.__nuzMobileFs)
  const [toasts, setToasts] = useState([]) // informational, over the fullscreen emulator
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

  useEffect(() => {
    const h = (e) => setFsActive(!!e.detail)
    window.addEventListener('nuz:mobile-fs', h)
    return () => window.removeEventListener('nuz:mobile-fs', h)
  }, [])

  const addToast = (mon, name, trainer = false) => {
    const toast = { mon, name, trainer, id: `${mon.personality}-${Date.now()}`, types: null }
    setToasts((t) => [...t, toast])
    try { navigator.vibrate?.(80) } catch { /* fine */ }
    // Typing arrives async from the cached PokeAPI proxy; the pills pop in
    // when resolved. (Regional-form hacks may show the base form's typing.)
    if (name) {
      api.get(`/api/pokemon/${name}`)
        .then((p) => setToasts((t) => t.map((x) => (x.id === toast.id ? { ...x, types: p.types } : x))))
        .catch(() => {})
    }
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== toast.id)), 8000)
  }

  // Attach the best available species name/national id to a detected mon.
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

  // Fully automatic: every detection is logged immediately (status "missed",
  // no location) and annotated later in the Encounters panel. Catches flip to
  // "caught" automatically when the mon appears in the synced party.
  const autoLog = async (mon) => {
    const name = mon._name || (mon.nationalId && idToName[mon.nationalId]) || ''
    let chainId = null
    if (name) {
      try { chainId = (await api.get(`/api/family/${name}`)).chainId } catch { /* optional */ }
    }
    try {
      const enc = await api.post(`/api/runs/${run.id}/encounters`, {
        location: '',
        speciesName: name || `#${mon.maskedSpecies ?? mon.internalSpecies}`,
        speciesId: mon.nationalId ?? null,
        chainId,
        status: 'missed',
        nickname: '',
        level: mon.level,
        shiny: mon.shiny,
        personality: mon.personality
      })
      onLogged(enc)
      setRecent((r) => [{ mon, name }, ...r].slice(0, 6))
      if (window.__nuzMobileFs) addToast(mon, name)
    } catch { /* server hiccup — radar keeps running */ }
  }

  // Trainer battle: acknowledged, never logged. Wild mons carry the PLAYER's
  // trainer id as their OT (validated against a real heap dump); anything
  // else in the enemy slot belongs to a trainer.
  const noteTrainerBattle = (mon) => {
    const name = mon._name || (mon.nationalId && idToName[mon.nationalId]) || ''
    setRecent((r) => [{ mon, name, trainer: true }, ...r].slice(0, 6))
    if (window.__nuzMobileFs) addToast(mon, name, true)
  }

  const stoppedByUserRef = useRef(false)
  const doStartRef = useRef(null)

  // Emulator-menu state/save loads rewrite memory — recalibrate right away
  // instead of waiting for the recovery loop to notice.
  useEffect(() => {
    const h = () => {
      if (stoppedByUserRef.current) return
      setWatching(false)
      setTimeout(() => doStartRef.current?.(true), 900)
    }
    window.addEventListener('nuz:memory-reset', h)
    return () => window.removeEventListener('nuz:memory-reset', h)
  }, [])

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

  doStartRef.current = doStart

  const start = () => {
    stoppedByUserRef.current = false
    doStart(false)
  }

  const stop = () => {
    stoppedByUserRef.current = true
    setWatching(false)
    setStatus('')
  }

  // Auto-start (and auto-recover after errors or save-state loads)
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
          if (!mon || !primedRef.current) continue
          const isTrainerMon = trainerId != null && (mon.otId >>> 0) !== (trainerId >>> 0)
          if (isTrainerMon) noteTrainerBattle(mon)
          else autoLog(mon)
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

  // One-shot wide search — press this DURING a battle if a detection was missed.
  const runDeepScan = () => {
    setToolMsg('Deep scanning…')
    try {
      const results = deepScan(candidates, (pid) => seenRef.current.has(pid))
        .map((r) => ({ ...r, mon: enrich(r.mon) }))
        .filter((r) => r.mon)
      if (!results.length) {
        setToolMsg('Deep scan: no valid enemy Pokemon found within ±16KB of the watched regions. If you are mid-battle, take a memory dump so it can be analyzed.')
        return
      }
      const newDeltas = [...new Set(results.map((r) => r.delta))]
        .filter((d) => d !== 600 && d !== -600 && Math.abs(d) <= 2400)
      if (newDeltas.length) {
        setExtraDeltas((ds) => [...new Set([...ds, ...newDeltas])].slice(0, 12))
      }
      for (const r of results.slice(0, 8)) {
        seenRef.current.add(r.mon.personality)
        autoLog(r.mon)
      }
      setToolMsg(`Deep scan: logged ${Math.min(results.length, 8)} Pokemon (offsets ${results.slice(0, 10).map((r) => (r.delta > 0 ? '+' : '') + r.delta).join(', ')})${newDeltas.length ? ' — now watching nearby offsets continuously.' : '.'}`)
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
          'X-Dump-Meta': encodeURIComponent(JSON.stringify(meta)),
          ...authHeaders()
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

  const monLabel = (mon, name) =>
    name ? titleCase(name) : `#${mon.maskedSpecies ?? mon.internalSpecies}`

  const fsWrap = fsActive ? document.getElementById('ejs-wrap') : null

  return (
    <div className="panel">
      {fsWrap && toasts.length > 0 && createPortal(
        <div className="fs-toasts">
          {toasts.map((t) => (
            <div className={`fs-toast ${t.trainer ? 'trainer' : ''}`} key={t.id}>
              {t.mon.nationalId ? <img src={spriteUrl(t.mon.nationalId, t.mon.shiny)} alt="" /> : null}
              <div className="ft-text">
                <div>
                  {t.trainer ? 'Trainer battle · ' : 'Wild '}<strong>{monLabel(t.mon, t.name)}</strong> · Lv. {t.mon.level}
                  {t.mon.shiny && <span className="shiny-star"> ✦</span>}
                  {t.trainer
                    ? <span className="ft-skipped"> — not an encounter</span>
                    : <span className="ft-logged"> — logged ✓</span>}
                </div>
                {t.types && (
                  <div className="ft-types">
                    {t.types.map((ty) => (
                      <span key={ty} className="type-pill" style={{ background: TYPE_COLORS[ty] || 'var(--surface-2)' }}>
                        {TYPE_EMOJI[ty] || ''} {titleCase(ty)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button className="small" onClick={() => setToasts((x) => x.filter((y) => y !== t))}>✕</button>
            </div>
          ))}
        </div>,
        fsWrap
      )}
      <h2>
        <span className="h2-title"><Radar size={14} /> Encounter radar</span>
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
      ) : !watching && recent.length === 0 ? (
        <p className="empty-note">
          Starting automatically within a few seconds… every wild battle is logged the moment it starts — no clicks needed.
        </p>
      ) : null}
      {recent.length > 0 && (
        <div className="radar-recent">
          {recent.map((r, i) => (
            <div className={`rr-row ${r.trainer ? 'rr-trainer' : ''}`} key={`${r.mon.personality}-${i}`}>
              {r.mon.nationalId ? <img src={spriteUrl(r.mon.nationalId, r.mon.shiny)} alt="" /> : <span className="rr-noimg">?</span>}
              <span>
                <strong>{monLabel(r.mon, r.name)}</strong> · Lv. {r.mon.level}
                {r.mon.shiny && <span className="shiny-star"> ✦</span>}
              </span>
              <span className="rr-note">{r.trainer ? 'trainer battle — ignored' : 'logged — annotate in Encounters'}</span>
            </div>
          ))}
        </div>
      )}
      {watching && status && (
        <p className="map-tip">
          {status} Scans: {scanCount}. Wild battles auto-log; trainer battles are recognized (by OT id) and ignored.
          Catches flip to ● Caught automatically when the Pokemon joins your synced party.
        </p>
      )}
      {watching && (
        <details open={debugOpen} onToggle={(e) => setDebugOpen(e.target.open)}>
          <summary className="map-tip" style={{ cursor: 'pointer' }}>Diagnostics</summary>
          <div className="rc-row" style={{ display: 'flex', gap: 6, margin: '6px 0', flexWrap: 'wrap' }}>
            <button className="small" onClick={runDeepScan}><ScanSearch size={12} /> Deep scan (use during battle)</button>
            <button className="small" onClick={dump}><HardDriveDownload size={12} /> Dump memory for analysis</button>
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
    </div>
  )
}
