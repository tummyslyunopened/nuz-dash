import React, { useEffect, useRef, useState } from 'react'
import { HeartPulse, RefreshCw, FileUp } from 'lucide-react'
import { spriteUrl, titleCase } from '../api.js'
import { parseGen3Save } from '../gen3save.js'
import { loadIndex } from './PokemonSearch.jsx'
import { readEmulatorSave, emulatorRunning, pushAutoState } from './EmulatorPanel.jsx'
import { findSpeciesTable, speciesTableName } from '../gen3ram.js'

const hpClass = (hp, maxHp) => {
  if (!maxHp || hp === 0) return 'hp-crit'
  const pct = hp / maxHp
  return pct > 0.5 ? 'hp-good' : pct > 0.2 ? 'hp-warn' : 'hp-crit'
}

export default function LivePartyPanel({ run, encounters, onMarkDead, onImport, onParty }) {
  const [party, setParty] = useState(null)
  const [game, setGame] = useState('')
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [auto, setAuto] = useState(true)
  const [backupMsg, setBackupMsg] = useState('')
  const lastSaveIndexRef = useRef(null)
  const [fainted, setFainted] = useState([]) // newly-fainted mons awaiting user action
  const [idToName, setIdToName] = useState({})
  const prevRef = useRef({})
  const fileRef = useRef(null)
  const tableRef = useRef(null)
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

  // Expansion hacks use their own species ids — resolve names from the game's
  // ROM table in emulator memory when the vanilla mapping comes up empty.
  const enrichParty = (mons) => {
    if (!mons.some((m) => !m.nationalId) || !emulatorRunning()) return mons
    try {
      if (!tableRef.current) tableRef.current = findSpeciesTable()
      if (!tableRef.current) return mons
      return mons.map((m) => {
        if (m.nationalId) return m
        const romName = speciesTableName(tableRef.current, m.maskedSpecies)
        if (!romName) return m
        return { ...m, displayName: romName, nationalId: nameToIdRef.current[romName.toLowerCase()] ?? null }
      })
    } catch {
      return mons
    }
  }

  const applyParsed = (rawParsed, src) => {
    const parsed = { ...rawParsed, party: enrichParty(rawParsed.party) }
    const prev = prevRef.current
    const newlyFainted = parsed.party.filter(
      (m) => m.hp === 0 && prev[m.personality] && prev[m.personality].hp > 0
    )
    if (newlyFainted.length) setFainted((f) => [...f, ...newlyFainted])
    const snapshot = {}
    for (const m of parsed.party) snapshot[m.personality] = m
    prevRef.current = snapshot
    setParty(parsed.party)
    setGame(parsed.game)
    setSource(src)
    setError('')
    onParty?.(parsed.party)
  }

  const downloadBlob = (bytes, filename) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  }

  // Every in-game save bumps the save counter — back up the battery save
  // (.srm, same raw bytes as .sav) plus a fresh .state to the browser's
  // downloads so there's always a local recovery point.
  const backupNow = (savBytes, saveIndex) => {
    try {
      const stampStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const slug = (run?.name || 'run').replace(/[^a-z0-9-]+/gi, '_').slice(0, 30)
      downloadBlob(savBytes, `${slug}-save${saveIndex}-${stampStr}.srm`)
      const gm = window.EJS_emulator?.gameManager
      if (gm) downloadBlob(gm.getState(), `${slug}-save${saveIndex}-${stampStr}.state`)
      if (run?.id) pushAutoState(run.id) // refresh the server's auto-resume state too
      setBackupMsg(`In-game save #${saveIndex} detected — downloaded .srm + .state backups and updated the server auto state.`)
    } catch (err) {
      setBackupMsg(`Auto-backup failed: ${err.message}`)
    }
  }

  const syncFromEmulator = async () => {
    try {
      const bytes = await readEmulatorSave()
      const parsed = parseGen3Save(bytes)
      applyParsed(parsed, 'emulator save')
      const prev = lastSaveIndexRef.current
      lastSaveIndexRef.current = parsed.saveIndex
      if (prev !== null && parsed.saveIndex > prev) backupNow(bytes, parsed.saveIndex)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => {
      if (emulatorRunning()) syncFromEmulator()
    }, 10000)
    return () => clearInterval(t)
  }, [auto]) // eslint-disable-line react-hooks/exhaustive-deps

  const syncFromFile = async (file) => {
    try {
      applyParsed(parseGen3Save(await file.arrayBuffer()), file.name)
    } catch (err) {
      setError(err.message)
    }
  }

  const monName = (mon) =>
    mon.nickname || mon.displayName ||
    (mon.nationalId && idToName[mon.nationalId] ? titleCase(idToName[mon.nationalId]) : `#${mon.maskedSpecies ?? mon.internalSpecies}`)

  const speciesLabel = (mon) =>
    mon.displayName ||
    (mon.nationalId && idToName[mon.nationalId] ? titleCase(idToName[mon.nationalId]) : `Species #${mon.maskedSpecies ?? mon.internalSpecies}`)

  const matchEncounter = (mon) => {
    const alive = encounters.filter((e) => e.status === 'caught' && e.alive)
    return (
      alive.find((e) => mon.nickname && e.nickname.toLowerCase() === mon.nickname.toLowerCase()) ||
      alive.find((e) => mon.nationalId && e.speciesId === mon.nationalId)
    )
  }

  const resolveFaint = (mon) => {
    setFainted((f) => f.filter((x) => x !== mon))
  }

  const markFaintDead = (mon) => {
    const enc = matchEncounter(mon)
    if (enc) onMarkDead(enc, `Fainted in game at Lv. ${mon.level}`)
    resolveFaint(mon)
  }

  return (
    <div className="panel">
      <h2>
        <span className="h2-title"><HeartPulse size={14} /> Live party</span> <span style={{ textTransform: 'none', letterSpacing: 0 }}>{game && `· ${game}`}</span>
        <span className="h-actions">
          <label style={{ fontSize: 12, display: 'inline-flex', gap: 5, alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto (10s)
          </label>
          <button className="small" onClick={() => fileRef.current?.click()} title="Parse a .sav file from any emulator"><FileUp size={12} /> Load .sav</button>
          <button className="small primary" onClick={syncFromEmulator}><RefreshCw size={12} /> Sync from game</button>
        </span>
      </h2>
      <input
        ref={fileRef}
        type="file"
        accept=".sav,.srm"
        style={{ display: 'none' }}
        onChange={(e) => e.target.files[0] && syncFromFile(e.target.files[0])}
      />

      {fainted.map((mon, i) => {
        const enc = matchEncounter(mon)
        return (
          <div className="warn-note faint-alert" key={`${mon.personality}-${i}`}>
            ☠ <strong>{monName(mon)}</strong> ({speciesLabel(mon)}, Lv. {mon.level}) has fainted!
            {enc
              ? <button className="small danger" onClick={() => markFaintDead(mon)}>Mark dead in tracker</button>
              : <span style={{ marginLeft: 6 }}>No matching tracker entry found.</span>}
            <button className="small" onClick={() => resolveFaint(mon)}>Dismiss</button>
          </div>
        )
      })}

      {error && <p className="error-note">{error}</p>}
      {!party ? (
        <p className="empty-note">
          Gen 3 (GBA) saves supported. Save in-game, then "Sync from game" — or load a .sav from any emulator.
        </p>
      ) : party.length === 0 ? (
        <p className="empty-note">Party is empty (has the game been saved in-game yet?).</p>
      ) : (
        <div className="party-grid">
          {party.map((mon) => (
            <div className={`party-card ${mon.hp === 0 ? 'fainted' : ''}`} key={mon.personality}>
              <img src={mon.nationalId ? spriteUrl(mon.nationalId, mon.shiny) : null} alt="" />
              <div className="pc-info">
                <div className="pc-name">
                  {monName(mon)}
                  {mon.shiny && <span className="shiny-star" title="Shiny"> ✦</span>}
                  {mon.isEgg && ' 🥚'}
                </div>
                <div className="pc-sub">
                  {speciesLabel(mon)} · Lv. {mon.level}
                  {mon.status && <span className={`pc-status ${mon.status === 'FNT' ? 'st-dead' : 'st-fled'}`}> {mon.status}</span>}
                </div>
                <div className="hp-bar" title={`${mon.hp}/${mon.maxHp} HP`}>
                  <div
                    className={`hp-fill ${hpClass(mon.hp, mon.maxHp)}`}
                    style={{ width: `${mon.maxHp ? Math.max(2, (mon.hp / mon.maxHp) * 100) : 0}%` }}
                  />
                </div>
                <div className="pc-hp">{mon.hp}/{mon.maxHp} HP</div>
              </div>
              <button
                className="small"
                title="Log as a caught encounter"
                onClick={() => onImport({
                  speciesName: (mon.nationalId && idToName[mon.nationalId]) || (mon.displayName || '').toLowerCase(),
                  speciesId: mon.nationalId,
                  nickname: mon.nickname,
                  level: mon.level,
                  shiny: mon.shiny
                })}
                disabled={!((mon.nationalId && idToName[mon.nationalId]) || mon.displayName)}
              >＋</button>
            </div>
          ))}
        </div>
      )}
      {backupMsg && <p className="map-tip">{backupMsg}</p>}
      {source && (
        <p className="map-tip">
          Last synced from {source}. The party reflects your last in-game save. Each new in-game save auto-downloads
          .srm + .state backups (allow "download multiple files" if the browser asks; rename .srm to .sav for mGBA).
        </p>
      )}
    </div>
  )
}
