import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Link2, KeyRound, Check, Upload, Play, RotateCcw, Eye, Trophy, Gamepad2, Users } from 'lucide-react'
import { api, authHeaders, rememberLink, forgetLink } from '../api.js'
import StreamView from '../components/StreamView.jsx'

const fmtSize = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`)
const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  return hours < 24 ? `${hours}h ago` : new Date(iso).toLocaleDateString()
}

export default function LobbyHome() {
  const { token } = useParams()
  const [me, setMe] = useState(null)
  const [summary, setSummary] = useState([])
  const [attempts, setAttempts] = useState([])
  const [games, setGames] = useState([])
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [gameId, setGameId] = useState('')
  const [rules, setRules] = useState({ dupesClause: true, shinyClause: true, hardcore: false })
  const [uploading, setUploading] = useState(false)
  const [regenLink, setRegenLink] = useState(null) // { name, url } after regenerating someone's link
  const fileRef = useRef(null)
  const navigate = useNavigate()

  const regenerate = async (member) => {
    const isSelf = member.id === (me?.member.id)
    const who = isSelf ? 'yourself' : member.name
    if (!window.confirm(
      `Generate a NEW secret link for ${who}? The old link stops working immediately. ` +
      (isSelf ? 'You will be moved to the new link — update your bookmark.' : `Share the new link privately with ${member.name} so they can get their progress back.`)
    )) return
    try {
      const r = await api.post(`/api/members/${member.id}/regenerate-link`, {})
      const url = `${me.publicUrl || window.location.origin}/m/${r.memberToken}`
      if (isSelf) {
        forgetLink(token)
        rememberLink(r.memberToken, `${me.member.name} @ ${me.lobby.name}`)
        navigate(`/m/${r.memberToken}`)
      } else {
        setRegenLink({ name: r.name, url })
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const refresh = () => {
    api.get('/api/lobby/summary').then(setSummary).catch(() => {})
    api.get('/api/runs?memberId=me').then(setAttempts).catch(() => {})
    // keep publicUrl fresh so copied links track the live tunnel
    api.get('/api/me').then((d) => setMe((prev) => (prev ? { ...prev, publicUrl: d.publicUrl } : d))).catch(() => {})
  }

  useEffect(() => {
    api.get('/api/me').then((d) => {
      setMe(d)
      rememberLink(token, `${d.member.name} @ ${d.lobby.name}`)
    }).catch((e) => setError(e.message))
    api.get('/api/games').then((g) => {
      setGames(g)
      if (g.length) setGameId(g.find((x) => x.id === 'emerald')?.id || g[0].id)
    }).catch(() => {})
    refresh()
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = attempts.find((a) => a.status === 'active')

  useEffect(() => {
    const last = attempts[0]
    if (last) {
      setRules(last.rules)
      setGameId((g) => last.gameId || g)
    }
  }, [attempts.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const copy = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(''), 2500)
    })
  }

  const uploadRom = async (file) => {
    setUploading(true)
    setError('')
    try {
      const res = await fetch(`/api/lobby/roms?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...authHeaders() },
        body: file
      })
      if (!res.ok) throw new Error((await res.json()).error || `${res.status}`)
      const entry = await res.json()
      setMe((m) => ({ ...m, lobby: { ...m.lobby, roms: [entry] } }))
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const startAttempt = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const run = await api.post('/api/runs', { gameId, rules })
      navigate(`/m/${token}/run/${run.id}`)
    } catch (err) {
      setError(err.message)
    }
  }

  if (!me) {
    return (
      <div className="app-shell">
        {error ? <p className="error-note">{error} — check that your personal link is complete.</p> : <p className="empty-note">Loading lobby…</p>}
      </div>
    )
  }

  // Copied links prefer the live tunnel URL so they work for people outside
  // this machine, no matter which origin YOU are browsing from.
  const shareOrigin = me.publicUrl || window.location.origin
  const inviteUrl = `${shareOrigin}/join/${me.lobby.inviteToken}`
  const myUrl = `${shareOrigin}/m/${token}`

  return (
    <div className="app-shell">
      <div className="run-header">
        <div className="run-title">
          <h1>{me.lobby.name}</h1>
          <div className="sub">You are <strong>{me.member.name}</strong> · {me.members.length} runner{me.members.length === 1 ? '' : 's'}</div>
        </div>
        <div className="stat-tiles">
          <button className="chip" onClick={() => copy(inviteUrl, 'invite')}>
            {copied === 'invite' ? <><Check size={13} /> Copied!</> : <><Link2 size={13} /> Copy invite link</>}
          </button>
          <button className="chip" onClick={() => copy(myUrl, 'personal')}>
            {copied === 'personal' ? <><Check size={13} /> Copied!</> : <><KeyRound size={13} /> Copy my secret link</>}
          </button>
          <span className="chip" title={me.publicUrl ? `Links copy with the public tunnel address: ${me.publicUrl}` : 'No tunnel running — links copy with this browser\'s address and may not work for others. Start the tunnel from the admin dashboard.'}>
            {me.publicUrl ? '🌐 public links' : '⚠ local links'}
          </span>
        </div>
      </div>
      {error && <p className="error-note">{error}</p>}

      <div className="home-grid">
        <div className="dash-col">
          <div className="panel">
            <h2><span className="h2-title"><Trophy size={14} /> Your attempts</span></h2>
            {active ? (
              <div className="run-card">
                <div className="info">
                  <Link to={`/m/${token}/run/${active.id}`}>Attempt #{active.attemptNumber} — {active.name}</Link>
                  <div className="sub">
                    {active.gameName} · 🏅{active.badges} · ●{active.alive} alive · ☠{active.deaths} deaths
                  </div>
                </div>
                <span className="spacer" />
                <Link to={`/m/${token}/run/${active.id}`}><button className="small primary"><Play size={12} /> Continue</button></Link>
              </div>
            ) : (
              <p className="empty-note">No active attempt.</p>
            )}
            <button className="primary" onClick={() => setShowNew((s) => !s)} style={{ width: '100%' }}>
              {showNew ? 'Cancel' : active
                ? <><RotateCcw size={14} /> Restart — new attempt (archives current)</>
                : <><Play size={14} /> Start your first attempt</>}
            </button>
            {showNew && (
              <form className="new-run-form" style={{ marginTop: 10 }} onSubmit={startAttempt}>
                <select value={gameId} onChange={(e) => setGameId(e.target.value)}>
                  {games.map((g) => <option key={g.id} value={g.id}>{g.name} (Gen {g.gen})</option>)}
                </select>
                <p className="map-tip" style={{ margin: 0 }}>
                  {me.lobby.roms[0]
                    ? `Uses the lobby ROM: ${me.lobby.roms[0].name}`
                    : 'No lobby ROM uploaded yet — the attempt starts tracker-only.'}
                </p>
                <div className="rules">
                  <label><input type="checkbox" checked={rules.dupesClause} onChange={(e) => setRules({ ...rules, dupesClause: e.target.checked })} /> Dupes clause</label>
                  <label><input type="checkbox" checked={rules.shinyClause} onChange={(e) => setRules({ ...rules, shinyClause: e.target.checked })} /> Shiny clause</label>
                  <label><input type="checkbox" checked={rules.hardcore} onChange={(e) => setRules({ ...rules, hardcore: e.target.checked })} /> Hardcore (level caps · no items · set mode)</label>
                </div>
                <button className="primary" type="submit">Start attempt #{(attempts[0]?.attemptNumber || 0) + 1}</button>
              </form>
            )}
            {attempts.filter((a) => a.status !== 'active').length > 0 && (
              <>
                <h2 style={{ marginTop: 14 }}>History</h2>
                {attempts.filter((a) => a.status !== 'active').map((a) => (
                  <div className="run-card" key={a.id}>
                    <div className="info">
                      <Link to={`/m/${token}/run/${a.id}`}>Attempt #{a.attemptNumber} — {a.name}</Link>
                      <div className="sub">
                        {a.gameName} · 🏅{a.badges} · {a.caught} caught · ☠{a.deaths} deaths
                        {a.endedAt && ` · ended ${new Date(a.endedAt).toLocaleDateString()}`}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="panel">
            <h2>
              <span className="h2-title"><Gamepad2 size={14} /> Lobby ROM</span>
              <span className="h-actions">
                <button className="small" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  <Upload size={12} /> {uploading ? 'Uploading…' : me.lobby.roms.length ? 'Replace ROM' : 'Upload ROM'}
                </button>
              </span>
            </h2>
            <input ref={fileRef} type="file" accept=".gb,.gbc,.sgb,.gba,.nds" style={{ display: 'none' }}
              onChange={(e) => e.target.files[0] && uploadRom(e.target.files[0])} />
            {me.lobby.roms.length === 0 ? (
              <p className="empty-note">No ROM yet — upload the patched ROM this lobby will race. One ROM per lobby; it's served to every runner here, so make sure everyone in the lobby owns their own legal copy of the game.</p>
            ) : (
              <div className="run-card">
                <div className="info">
                  <strong>{me.lobby.roms[0].name}</strong>
                  <div className="sub">{me.lobby.roms[0].core.toUpperCase()} · {fmtSize(me.lobby.roms[0].size)} · used by every attempt in this lobby</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <h2><span className="h2-title"><Users size={14} /> Runners</span></h2>
          {regenLink && (
            <div className="warn-note ok" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <span>New secret link for <strong>{regenLink.name}</strong> — share it privately, their old one is dead:</span>
              <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{regenLink.url}</code>
              <button className="small" onClick={() => copy(regenLink.url, 'regen')}>{copied === 'regen' ? '✓ Copied' : 'Copy'}</button>
              <button className="small" onClick={() => setRegenLink(null)}>Dismiss</button>
            </div>
          )}
          {summary.map((s) => (
            <div className="run-card runner-card" key={s.member.id}>
              {s.live && s.member.id !== me.member.id && (
                <Link to={`/m/${token}/view/${s.member.id}`} className="runner-stream">
                  <StreamView memberId={s.member.id} interval={1000} compact />
                </Link>
              )}
              <div className="info">
                {s.member.id === me.member.id
                  ? <strong>{s.member.name} (you)</strong>
                  : <Link to={`/m/${token}/view/${s.member.id}`}>{s.member.name}</Link>}
                {s.active ? (
                  <div className="sub">
                    Attempt #{s.active.attemptNumber} · {s.active.gameName} · 🏅{s.active.badges} · ●{s.active.alive} alive · ☠{s.active.deaths} deaths
                    <span> · active {timeAgo(s.active.updatedAt)}</span>
                  </div>
                ) : (
                  <div className="sub">{s.attempts === 0 ? 'No attempts yet' : `${s.attempts} past attempt${s.attempts === 1 ? '' : 's'} — none active`}</div>
                )}
              </div>
              <span className="spacer" />
              <button
                className="small"
                title={s.member.id === me.member.id ? 'Regenerate your secret link (old one stops working)' : `Regenerate ${s.member.name}'s secret link — for when they've lost theirs`}
                onClick={() => regenerate(s.member)}
              ><KeyRound size={12} /></button>
              {s.member.id !== me.member.id && (
                <Link to={`/m/${token}/view/${s.member.id}`}>
                  <button className={`small ${s.live ? 'primary' : ''}`}><Eye size={12} /> {s.live ? 'Watch live' : 'Watch'}</button>
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
