import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Radar, Gamepad2, Map, Users, HeartPulse, BookOpen, Plus, KeyRound, Swords, X } from 'lucide-react'
import { api, rememberLink, knownLinks, forgetLink } from '../api.js'

const FEATURES = [
  { icon: Gamepad2, title: 'Play in the browser', text: 'Built-in GB/GBA/NDS emulator with your own patched ROMs, save-state slots, and automatic .srm/.state backups on every in-game save.' },
  { icon: Radar, title: 'Encounter radar', text: 'Wild battles are detected straight from the running game’s memory — species, level, shiny — and logged with one click. Works with expansion ROM hacks.' },
  { icon: HeartPulse, title: 'Live party sync', text: 'Your team, HP bars and faint alerts read directly from the save. Deaths flow into the tracker with a cause-of-death note.' },
  { icon: Users, title: 'Watch party', text: 'Everyone in the lobby streams their game live. Watch your friends’ runs unfold — and their inevitable wipes — in real time.' },
  { icon: Map, title: 'Route map', text: 'A map that draws itself as you play, with encounter status pins. Drag it into the shape of the region, shared across the lobby.' },
  { icon: BookOpen, title: 'Attempts & history', text: 'Dupes and shiny clause, hardcore level caps, a run diary — and when a run dies, restart into a fresh attempt with the full history preserved.' }
]

export default function Landing() {
  const [lobbyName, setLobbyName] = useState('')
  const [runnerName, setRunnerName] = useState('')
  const [error, setError] = useState('')
  const [links, setLinks] = useState(knownLinks)
  const navigate = useNavigate()

  const removeLink = (l) => {
    if (!window.confirm(`Remove "${l.label || 'this lobby'}" from this device? The lobby itself is untouched — you can get back in with the link or by re-joining via invite.`)) return
    forgetLink(l.token)
    setLinks(knownLinks())
  }

  const create = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const { memberToken } = await api.post('/api/lobbies', { lobbyName, runnerName })
      rememberLink(memberToken, `${runnerName} @ ${lobbyName}`)
      try { localStorage.setItem('nuz-tour-pending', '1') } catch { /* private mode */ }
      navigate(`/m/${memberToken}`)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="app-shell">
      <div className="hero">
        <div className="logo-mark"><Swords size={38} /></div>
        <h1>Nuz-Dash</h1>
        <p className="tagline">
          The multiplayer Nuzlocke platform. Create a lobby, invite your friends with a link,
          and race your runs side by side — emulator, tracker, and watch party in one screen.
        </p>
      </div>

      <div className="feature-grid">
        {FEATURES.map((f) => (
          <div className="feature-card" key={f.title}>
            <span className="fi"><f.icon size={18} /></span>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </div>

      <div className="landing-grid">
        <div className="panel">
          <h2><span className="h2-title"><Plus size={14} /> Create a lobby</span></h2>
          <form className="new-run-form" onSubmit={create}>
            <input placeholder="Lobby name (e.g. Kaizo League Summer)" value={lobbyName} onChange={(e) => setLobbyName(e.target.value)} />
            <input placeholder="Your runner name" value={runnerName} onChange={(e) => setRunnerName(e.target.value)} />
            <button className="primary" type="submit" disabled={!lobbyName.trim() || !runnerName.trim()}>
              <Plus size={14} /> Create lobby
            </button>
            {error && <p className="error-note">{error}</p>}
            <p className="map-tip">
              You'll get a personal secret link — that link is your identity, so bookmark it.
              Invite others with the lobby's invite link. No accounts, no passwords.
            </p>
          </form>
        </div>
        <div className="panel">
          <h2><span className="h2-title"><KeyRound size={14} /> Your lobbies on this device</span></h2>
          {links.length === 0 ? (
            <p className="empty-note">None yet — create a lobby, or open an invite link someone shared with you.</p>
          ) : (
            links.map((l) => (
              <div className="run-card" key={l.token}>
                <div className="info">
                  <Link to={`/m/${l.token}`}>{l.label || 'Lobby'}</Link>
                  <div className="sub">last opened {new Date(l.at).toLocaleDateString()}</div>
                </div>
                <span className="spacer" />
                <button className="small danger" title="Remove from this device" onClick={() => removeLink(l)}><X size={12} /></button>
              </div>
            ))
          )}
        </div>
      </div>

      <p className="landing-foot">
        Runs locally on your machine · bring your own legally-dumped ROMs · powered by EmulatorJS (GPLv3) &amp; PokeAPI
      </p>
    </div>
  )
}
