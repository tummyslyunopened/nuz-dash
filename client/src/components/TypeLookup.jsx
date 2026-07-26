import React, { useState } from 'react'
import { api, spriteUrl, titleCase } from '../api.js'
import { TYPES, TYPE_COLORS, defensiveProfile } from '../typechart.js'
import PokemonSearch from './PokemonSearch.jsx'

const TypeChip = ({ type }) => (
  <span className="type-chip" style={{ background: TYPE_COLORS[type] }}>{type}</span>
)

const ROWS = [
  { mult: 4, label: '4×', cls: 'bad' },
  { mult: 2, label: '2×', cls: 'bad' },
  { mult: 0.5, label: '½×', cls: 'good' },
  { mult: 0.25, label: '¼×', cls: 'good' },
  { mult: 0, label: '0×', cls: 'good' }
]

export default function TypeLookup() {
  const [subject, setSubject] = useState(null) // { name, id, types }
  const [manual, setManual] = useState(['', ''])
  const [error, setError] = useState('')

  const pickPokemon = async (p) => {
    setError('')
    try {
      const details = await api.get(`/api/pokemon/${p.name}`)
      setSubject(details)
      setManual(['', ''])
    } catch (err) {
      setError(err.message)
    }
  }

  const setManualType = (i, val) => {
    const next = [...manual]
    next[i] = val
    setManual(next)
    setSubject(null)
  }

  const types = subject ? subject.types : manual.filter(Boolean)
  const profile = types.length ? defensiveProfile(types) : null

  return (
    <div className="panel type-lookup">
      <h2>Type matchups</h2>
      <div className="controls">
        <div style={{ flex: 1, minWidth: 180 }}>
          <PokemonSearch value={subject ? titleCase(subject.name) : ''} onSelect={pickPokemon} placeholder="Look up a Pokemon…" />
        </div>
        <span style={{ color: 'var(--muted)' }}>or</span>
        {[0, 1].map((i) => (
          <select key={i} value={manual[i]} onChange={(e) => setManualType(i, e.target.value)}>
            <option value="">{i === 0 ? 'Type 1…' : 'Type 2…'}</option>
            {TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
          </select>
        ))}
      </div>
      {error && <p className="error-note">{error}</p>}
      {subject && (
        <div className="subject">
          <img src={subject.sprite || spriteUrl(subject.id)} alt="" />
          <strong>{titleCase(subject.name)}</strong>
          <span className="types" style={{ display: 'flex', gap: 5 }}>
            {subject.types.map((t) => <TypeChip key={t} type={t} />)}
          </span>
        </div>
      )}
      {!profile ? (
        <p className="empty-note">Pick a Pokemon or type combo to see incoming damage multipliers.</p>
      ) : (
        <div>
          {ROWS.map(({ mult, label, cls }) => {
            const list = profile[mult]
            if (!list || !list.length) return null
            return (
              <div className="eff-row" key={mult}>
                <span className={`mult ${cls}`}>{label}</span>
                <span className="types">{list.map((t) => <TypeChip key={t} type={t} />)}</span>
              </div>
            )
          })}
          <p className="map-tip">Damage taken by this Pokemon, Gen 6+ chart. Unlisted types deal normal (1×) damage.</p>
        </div>
      )}
    </div>
  )
}
