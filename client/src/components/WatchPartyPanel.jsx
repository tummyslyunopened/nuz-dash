import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Users, Eye } from 'lucide-react'
import { api } from '../api.js'
import StreamView from './StreamView.jsx'

// Live tiles of everyone else's games, for watching mid-run.
export default function WatchPartyPanel() {
  const { token } = useParams()
  const [myId, setMyId] = useState(null)
  const [summary, setSummary] = useState([])

  useEffect(() => {
    api.get('/api/me').then((d) => setMyId(d.member.id)).catch(() => {})
    const refresh = () => api.get('/api/lobby/summary').then(setSummary).catch(() => {})
    refresh()
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [])

  const others = summary.filter((s) => s.member.id !== myId)
  const live = others.filter((s) => s.live)
  const idle = others.filter((s) => !s.live && s.active)

  return (
    <div className="panel">
      <h2><span className="h2-title"><Users size={14} /> Watch party</span></h2>
      {others.length === 0 ? (
        <p className="empty-note">No other runners in this lobby yet — share the invite link from the lobby page.</p>
      ) : live.length === 0 ? (
        <p className="empty-note">Nobody else is live right now.</p>
      ) : (
        <div className="watch-grid">
          {live.map((s) => (
            <Link key={s.member.id} to={`/m/${token}/view/${s.member.id}`} className="watch-tile" title={`Watch ${s.member.name}`}>
              <StreamView memberId={s.member.id} interval={1000} />
              <div className="wt-label">
                <strong>{s.member.name}</strong>
                {s.active && (
                  <span className="wt-stats">#{s.active.attemptNumber} · 🏅{s.active.badges} · ●{s.active.alive} · ☠{s.active.deaths}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      {idle.length > 0 && (
        <p className="map-tip">
          Not live: {idle.map((s) => s.member.name).join(', ')} —
          {' '}<Eye size={11} style={{ verticalAlign: -1 }} /> their trackers are still viewable from the lobby.
        </p>
      )}
    </div>
  )
}
