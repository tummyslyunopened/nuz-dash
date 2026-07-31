import React, { useEffect, useRef, useState } from 'react'
import { Boxes, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { authHeaders, spriteUrl } from '../api.js'
import { parsePCBoxes } from '../gen3save.js'
import { readEmulatorSave, emulatorRunning } from './EmulatorPanel.jsx'

// PC storage viewer: parses the battery save's box data (sections 5-13).
// Reads the running emulator's save when possible, else the server backup.
// PC contents only change when the game writes a save, so this refreshes on
// the same signals as everything else: detected in-game saves + sav restores.
export default function PCBoxPanel({ run }) {
  const [pc, setPc] = useState(null)
  const [box, setBox] = useState(0)
  const [error, setError] = useState('')
  const [source, setSource] = useState('')
  const firstLoadRef = useRef(true)

  const load = async () => {
    setError('')
    try {
      let bytes
      let src
      if (emulatorRunning()) {
        bytes = await readEmulatorSave()
        src = 'running game'
      } else {
        const res = await fetch(`/api/runs/${run.id}/sav`, { headers: authHeaders() })
        if (!res.ok) throw new Error('No server save yet — boxes appear after your first in-game save.')
        bytes = new Uint8Array(await res.arrayBuffer())
        src = 'server backup'
      }
      const parsed = parsePCBoxes(bytes)
      setPc(parsed)
      setSource(src)
      if (firstLoadRef.current) {
        firstLoadRef.current = false
        // Open on the game's current box, or the first non-empty one
        const first = parsed.boxes.findIndex((b) => b.mons.length > 0)
        setBox(parsed.boxes[parsed.currentBox]?.mons.length ? parsed.currentBox : (first >= 0 ? first : parsed.currentBox))
      }
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { load() }, [run.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Save data just changed under us (in-game save detected / sav loaded)
    const h = () => setTimeout(load, 400)
    window.addEventListener('nuz:ingame-save', h)
    window.addEventListener('nuz:sav-restored', h)
    return () => {
      window.removeEventListener('nuz:ingame-save', h)
      window.removeEventListener('nuz:sav-restored', h)
    }
  }, [run.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Expansion hacks use their own species enums, usually natdex-ordered — for
  // ids the sprite proxy knows, masked id doubles as the dex number. Form
  // species (appended past the dex) may show a wrong sprite; the nickname is
  // the source of truth.
  const spriteIdOf = (m) => m.nationalId ?? (m.maskedSpecies >= 1 && m.maskedSpecies <= 1025 ? m.maskedSpecies : null)

  const b = pc?.boxes[box]
  const bySlot = new Map((b?.mons || []).map((m) => [m.slot, m]))
  return (
    <div className="panel">
      <h2>
        <span className="h2-title"><Boxes size={14} /> PC boxes{pc ? ` · ${pc.count}` : ''}</span>
        <span className="h-actions">
          <button className="small" onClick={load} title="Re-read the save"><RefreshCw size={12} /></button>
        </span>
      </h2>
      {error && <p className="empty-note">{error}</p>}
      {pc && (
        <>
          <div className="pcbox-nav">
            <button className="small" onClick={() => setBox((x) => (x + 13) % 14)}><ChevronLeft size={12} /></button>
            <select value={box} onChange={(e) => setBox(Number(e.target.value))}>
              {pc.boxes.map((bx, i) => (
                <option key={i} value={i}>{bx.name}{bx.mons.length ? ` (${bx.mons.length})` : ''}</option>
              ))}
            </select>
            <button className="small" onClick={() => setBox((x) => (x + 1) % 14)}><ChevronRight size={12} /></button>
            <span className="rr-note">{b?.mons.length || 0}/30</span>
          </div>
          <div className="pcbox-grid">
            {Array.from({ length: 30 }, (_, s) => {
              const m = bySlot.get(s)
              if (!m) return <div className="pc-cell empty" key={s} />
              const sid = spriteIdOf(m)
              return (
                <div className="pc-cell" key={s} title={`${m.nickname || '(no name)'} · #${m.maskedSpecies}${m.shiny ? ' · shiny' : ''}${m.isEgg ? ' · egg' : ''}`}>
                  {m.isEgg
                    ? <span className="pc-egg">🥚</span>
                    : sid
                      ? <img src={spriteUrl(sid, m.shiny)} alt="" loading="lazy" />
                      : <span className="pc-egg">?</span>}
                  <span className="pc-nick">{m.shiny && <span className="shiny-star">✦</span>}{m.nickname || `#${m.maskedSpecies}`}</span>
                </div>
              )
            })}
          </div>
          <p className="map-tip">
            From the {source}, as of the last in-game save — deposits/withdrawals show up after the next save.
          </p>
        </>
      )}
    </div>
  )
}
