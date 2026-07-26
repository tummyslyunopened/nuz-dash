import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api.js'

export default function Home() {
  const [games, setGames] = useState([])
  const [runs, setRuns] = useState([])
  const [name, setName] = useState('')
  const [gameId, setGameId] = useState('')
  const [rules, setRules] = useState({ dupesClause: true, shinyClause: true, hardcore: false })
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/api/games').then((g) => {
      setGames(g)
      if (g.length) setGameId(g[0].id)
    }).catch((e) => setError(e.message))
    api.get('/api/runs').then(setRuns).catch((e) => setError(e.message))
  }, [])

  const createRun = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const run = await api.post('/api/runs', { name: name.trim() || 'My Nuzlocke', gameId, rules })
      navigate(`/run/${run.id}`)
    } catch (err) {
      setError(err.message)
    }
  }

  const deleteRun = async (run) => {
    if (!window.confirm(`Delete run "${run.name}" and all its encounters/diary entries?`)) return
    await api.del(`/api/runs/${run.id}`)
    setRuns((rs) => rs.filter((r) => r.id !== run.id))
  }

  return (
    <div className="app-shell">
      <div className="home-title">
        <h1>Nuz-Dash</h1>
        <span className="sub">Nuzlocke second-screen companion</span>
      </div>
      {error && <p className="error-note">{error}</p>}
      <div className="home-grid">
        <div className="panel">
          <h2>New run</h2>
          <form className="new-run-form" onSubmit={createRun}>
            <input
              placeholder="Run name (e.g. Emerald Attempt #3)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select value={gameId} onChange={(e) => setGameId(e.target.value)}>
              {games.map((g) => (
                <option key={g.id} value={g.id}>{g.name} (Gen {g.gen})</option>
              ))}
            </select>
            <div className="rules">
              <label>
                <input
                  type="checkbox"
                  checked={rules.dupesClause}
                  onChange={(e) => setRules({ ...rules, dupesClause: e.target.checked })}
                />
                Dupes clause — skip species families you've already encountered
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={rules.shinyClause}
                  onChange={(e) => setRules({ ...rules, shinyClause: e.target.checked })}
                />
                Shiny clause — shinies are always catchable
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={rules.hardcore}
                  onChange={(e) => setRules({ ...rules, hardcore: e.target.checked })}
                />
                Hardcore — level caps, no battle items, set mode
              </label>
            </div>
            <button className="primary" type="submit">Start run</button>
          </form>
        </div>
        <div>
          {runs.length === 0 && (
            <div className="panel"><p className="empty-note">No runs yet — start one on the left.</p></div>
          )}
          {runs.map((r) => (
            <div className="run-card" key={r.id}>
              <div className="info">
                <Link to={`/run/${r.id}`}>{r.name}</Link>
                <div className="sub">
                  {r.gameName} · {r.badges} badge{r.badges === 1 ? '' : 's'} · started {new Date(r.createdAt).toLocaleDateString()}
                </div>
              </div>
              <span className="spacer" />
              <button className="small danger" onClick={() => deleteRun(r)}>Delete</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
