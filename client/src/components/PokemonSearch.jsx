import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, spriteUrl, titleCase } from '../api.js'

let indexPromise = null
export const loadIndex = () => {
  if (!indexPromise) indexPromise = api.get('/api/pokemon-index')
  return indexPromise
}

export default function PokemonSearch({ value, onSelect, placeholder = 'Search Pokemon…' }) {
  const [index, setIndex] = useState([])
  const [query, setQuery] = useState(value || '')
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(0)
  const rootRef = useRef(null)

  useEffect(() => { loadIndex().then(setIndex).catch(() => {}) }, [])
  useEffect(() => { setQuery(value || '') }, [value])

  useEffect(() => {
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/\s+/g, '-')
    if (!q) return []
    const starts = []
    const contains = []
    for (const p of index) {
      if (p.name.startsWith(q)) starts.push(p)
      else if (p.name.includes(q)) contains.push(p)
      if (starts.length >= 8) break
    }
    return [...starts, ...contains].slice(0, 8)
  }, [query, index])

  const pick = (p) => {
    setQuery(titleCase(p.name))
    setOpen(false)
    onSelect(p)
  }

  const onKeyDown = (e) => {
    if (!open || !matches.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[hl] || matches[0]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div className="poke-search" ref={rootRef}>
      <input
        style={{ width: '100%' }}
        placeholder={placeholder}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHl(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && matches.length > 0 && (
        <div className="results">
          {matches.map((p, i) => (
            <button type="button" key={p.name} className={i === hl ? 'hl' : ''} onClick={() => pick(p)}>
              <img src={spriteUrl(p.id)} alt="" loading="lazy" />
              {titleCase(p.name)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
