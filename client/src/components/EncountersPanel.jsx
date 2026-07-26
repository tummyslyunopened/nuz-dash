import React, { useEffect, useState } from 'react'
import { api, spriteUrl, titleCase, STATUS_META, encounterState } from '../api.js'
import PokemonSearch from './PokemonSearch.jsx'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'team', label: 'Team' },
  { key: 'graveyard', label: 'Graveyard' },
  { key: 'failed', label: 'Failed' }
]

export default function EncountersPanel({ run, encounters, setEncounters, locations, prefill }) {
  const [filter, setFilter] = useState('all')
  const [location, setLocation] = useState('')
  const [species, setSpecies] = useState(null) // { name, id }
  const [family, setFamily] = useState(null) // { chainId, members }
  const [status, setStatus] = useState('caught')
  const [nickname, setNickname] = useState('')
  const [level, setLevel] = useState('')
  const [shiny, setShiny] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Prefill from the live-party "import" button in the emulator view
  useEffect(() => {
    if (!prefill) return
    setSpecies(prefill.species)
    setNickname(prefill.nickname || '')
    setLevel(prefill.level != null ? String(prefill.level) : '')
    setShiny(!!prefill.shiny)
    setStatus('caught')
  }, [prefill?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setFamily(null)
    if (!species) return
    let stale = false
    api.get(`/api/family/${species.name}`).then((f) => { if (!stale) setFamily(f) }).catch(() => {})
    return () => { stale = true }
  }, [species])

  const locationUsed = location && encounters.some(
    (e) => e.location.toLowerCase() === location.trim().toLowerCase()
  )
  const dupeHit = family && encounters.find(
    (e) => family.members.includes(e.speciesName) || (e.chainId && e.chainId === family.chainId)
  )
  const shinyExempt = shiny && run.rules.shinyClause

  const addEncounter = async (e) => {
    e.preventDefault()
    if (!species || !location.trim()) return
    setBusy(true)
    setError('')
    try {
      const enc = await api.post(`/api/runs/${run.id}/encounters`, {
        location: location.trim(),
        speciesName: species.name,
        speciesId: species.id,
        chainId: family?.chainId ?? null,
        status,
        nickname: nickname.trim(),
        level: level ? Number(level) : null,
        shiny
      })
      setEncounters((es) => [...es, enc])
      setSpecies(null)
      setNickname('')
      setLevel('')
      setShiny(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const update = async (id, patch) => {
    const enc = await api.put(`/api/encounters/${id}`, patch)
    setEncounters((es) => es.map((e) => (e.id === id ? enc : e)))
  }

  const markDead = (enc) => {
    const note = window.prompt(`How did ${enc.nickname || titleCase(enc.speciesName)} die?`, '')
    if (note === null) return
    update(enc.id, { alive: false, deathNote: note })
  }

  const remove = async (enc) => {
    if (!window.confirm(`Delete the ${titleCase(enc.speciesName)} encounter at ${enc.location}?`)) return
    await api.del(`/api/encounters/${enc.id}`)
    setEncounters((es) => es.filter((e) => e.id !== enc.id))
  }

  const visible = encounters.filter((e) => {
    if (filter === 'team') return e.status === 'caught' && e.alive
    if (filter === 'graveyard') return e.status === 'caught' && !e.alive
    if (filter === 'failed') return e.status !== 'caught'
    return true
  })

  return (
    <div className="panel">
      <h2>Encounters</h2>
      <form className="enc-form" onSubmit={addEncounter}>
        <input
          list="location-options"
          placeholder="Location (e.g. Route 101)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <datalist id="location-options">
          {locations.map((l) => <option key={l} value={l} />)}
        </datalist>
        <PokemonSearch value={species ? titleCase(species.name) : ''} onSelect={setSpecies} />
        <input placeholder="Nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        <div className="row-full">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="caught">Caught</option>
            <option value="killed">Killed</option>
            <option value="fled">Fled</option>
            <option value="missed">Missed</option>
          </select>
          <input
            type="number" min="1" max="100" placeholder="Lv."
            style={{ width: 70 }}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          />
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={shiny} onChange={(e) => setShiny(e.target.checked)} /> Shiny ✦
          </label>
          <button className="primary" type="submit" disabled={busy || !species || !location.trim()}>
            Log encounter
          </button>
        </div>
        {shinyExempt && (
          <div className="warn-note ok">✦ Shiny clause — always catchable, dupes and first-encounter rules don't apply.</div>
        )}
        {!shinyExempt && run.rules.dupesClause && dupeHit && (
          <div className="warn-note">
            Dupes clause: the {titleCase(dupeHit.speciesName)} family was already encountered at {dupeHit.location} — this doesn't count, look for another encounter.
          </div>
        )}
        {!shinyExempt && locationUsed && (
          <div className="warn-note">First-encounter rule: you already logged an encounter for this location.</div>
        )}
        {error && <div className="warn-note">{error}</div>}
      </form>

      <div className="filter-chips">
        {FILTERS.map((f) => {
          const count = f.key === 'all' ? encounters.length
            : f.key === 'team' ? encounters.filter((e) => e.status === 'caught' && e.alive).length
            : f.key === 'graveyard' ? encounters.filter((e) => e.status === 'caught' && !e.alive).length
            : encounters.filter((e) => e.status !== 'caught').length
          return (
            <button key={f.key} className={filter === f.key ? 'active' : ''} onClick={() => setFilter(f.key)}>
              {f.label} ({count})
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <p className="empty-note">Nothing here yet.</p>
      ) : (
        <table className="enc-table">
          <thead>
            <tr><th>Pokemon</th><th>Location</th><th>Lv.</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {visible.map((enc) => {
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
                          {enc.shiny && <span className="shiny-star" title="Shiny"> ✦</span>}
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
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {enc.status === 'caught' && enc.alive && (
                      <button className="small" onClick={() => markDead(enc)} title="Mark as dead">☠</button>
                    )}
                    {enc.status === 'caught' && !enc.alive && (
                      <button className="small" onClick={() => update(enc.id, { alive: true, deathNote: '' })} title="Revive (undo)">↺</button>
                    )}
                    {' '}
                    <button className="small danger" onClick={() => remove(enc)} title="Delete">✕</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
