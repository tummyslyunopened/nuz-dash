import React, { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import { api, spriteUrl, titleCase } from '../api.js'

const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  return hours < 24 ? `${hours}h ago` : new Date(iso).toLocaleDateString()
}

// One renderer per event type — add an entry here when the server starts
// emitting a new type (deaths, badges, gym clears…). Unknown types fall back
// to a generic row instead of breaking the feed.
const RENDERERS = {
  encounter: (ev) => ({
    icon: ev.data.speciesId
      ? <img src={spriteUrl(ev.data.speciesId, ev.data.shiny)} alt="" />
      : <span className="rr-noimg">?</span>,
    text: (
      <>
        <strong>{ev.runner}</strong>
        {ev.data.status === 'caught' ? (ev.data.alive ? ' caught ' : ' caught (since lost) ') : ' encountered '}
        <strong>{titleCase(ev.data.speciesName)}</strong>
        {ev.data.shiny && <span className="shiny-star"> ✦</span>}
        {ev.data.level ? ` · Lv. ${ev.data.level}` : ''}
        {ev.data.location ? ` · ${ev.data.location}` : ''}
      </>
    )
  }),
  trainer: (ev) => ({
    icon: <span className="el-emoji">⚔️</span>,
    text: (
      <>
        <strong>{ev.runner}</strong> battled <strong>{ev.data.name || `Trainer #${String(ev.data.otId).slice(-5)}`}</strong>
        {ev.data.mons ? ` (${ev.data.mons} mon${ev.data.mons === 1 ? '' : 's'})` : ''}
        {ev.data.location ? ` · ${ev.data.location}` : ''}
        {ev.data.status === 'beaten' ? ' · beaten ✓' : ''}
      </>
    )
  })
}
const fallbackRenderer = (ev) => ({
  icon: <span className="el-emoji">•</span>,
  text: <><strong>{ev.runner}</strong> · {ev.type}</>
})

// Aggregate feed of everything the trackers detect across the lobby.
export default function EventLogPanel() {
  const [events, setEvents] = useState([])

  useEffect(() => {
    const load = () => api.get('/api/lobby/events').then(setEvents).catch(() => {})
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="panel">
      <h2><span className="h2-title"><Activity size={14} /> Event log</span></h2>
      {events.length === 0 ? (
        <p className="empty-note">Quiet so far — encounters and trainer battles show up here as the lobby plays.</p>
      ) : (
        <div className="event-log">
          {events.map((ev) => {
            const { icon, text } = (RENDERERS[ev.type] || fallbackRenderer)(ev)
            return (
              <div className="el-row" key={ev.id}>
                <span className="el-icon">{icon}</span>
                <span className="el-text">{text}</span>
                <span className="el-when">{ev.at ? timeAgo(ev.at) : ''}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
