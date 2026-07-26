import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, rememberLink } from '../api.js'

export default function JoinPage() {
  const { invite } = useParams()
  const [lobbyName, setLobbyName] = useState(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    api.get(`/api/join/${invite}`)
      .then((d) => setLobbyName(d.lobbyName))
      .catch((e) => setError(e.message))
  }, [invite])

  const join = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const { memberToken } = await api.post(`/api/join/${invite}`, { name })
      rememberLink(memberToken, `${name} @ ${lobbyName}`)
      try { localStorage.setItem('nuz-tour-pending', '1') } catch { /* private mode */ }
      navigate(`/m/${memberToken}`)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="app-shell" style={{ maxWidth: 480 }}>
      <div className="home-title">
        <h1>Nuz-Dash</h1>
      </div>
      <div className="panel">
        <h2>Join lobby</h2>
        {error && <p className="error-note">{error}</p>}
        {lobbyName && (
          <form className="new-run-form" onSubmit={join}>
            <p>You've been invited to <strong>{lobbyName}</strong>.</p>
            <input placeholder="Your runner name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <button className="primary" type="submit" disabled={!name.trim()}>Join as {name.trim() || '…'}</button>
            <p className="map-tip">You'll get a personal secret link — bookmark it, it's your only way back in.</p>
          </form>
        )}
      </div>
    </div>
  )
}
