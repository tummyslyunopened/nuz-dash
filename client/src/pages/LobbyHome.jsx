import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Link2, KeyRound, Check, Upload, Play, RotateCcw, Eye, Trophy, Gamepad2, Users, History, Download, RefreshCw, HelpCircle, ShieldCheck, ShieldOff, Crown } from 'lucide-react'
import { api, authHeaders, rememberLink, forgetLink, memberToken, pathForToken } from '../api.js'
import { sha256Hex } from '../romcache.js'
import StreamView from '../components/StreamView.jsx'
import Tour from '../components/Tour.jsx'

const TOUR_STEPS = (byoRom) => [
  {
    title: 'Welcome to Nuz-Dash! 👋',
    body: 'This lobby is home base for you and your friends: race Nuzlocke attempts side by side, watch each other play live, and let the app track everything automatically. Quick tour?'
  },
  {
    selector: '[data-tour="secret-link"]',
    title: 'Your secret link IS your account',
    body: 'No passwords here — this link is how you get back in, on any device. Copy it and bookmark it somewhere safe. If you ever lose it, a link manager (the lobby creator, or the host) can generate you a new one. While you play, the address bar shows a random session URL instead of the secret — safe to have on stream.'
  },
  {
    selector: '[data-tour="invite-link"]',
    title: 'Bring your friends',
    body: 'Share the invite link privately (treat links like passwords). Everyone who joins gets their own secret link and races in this same lobby.'
  },
  {
    selector: '[data-tour="rom"]',
    title: 'One game, one race',
    body: byoRom
      ? 'BYO ROM: the creator (or a deputized ROM manager) registers WHICH game the lobby races — then every runner picks their own legally-dumped copy (patched hacks welcome) right in their browser. Your ROM loads locally and never touches the server.'
      : 'The lobby has a single game everyone runs — the creator (or a deputized ROM manager) uploads a legally-dumped ROM (patched hacks welcome). Every runner should own their own copy of the game.'
  },
  {
    selector: '[data-tour="attempts"]',
    title: 'Attempts',
    body: 'Start an attempt to begin your run — pick rules like dupes clause and hardcore level caps. When a run dies, restart into attempt #2: the old one and its graveyard stay in your history forever.'
  },
  {
    selector: '[data-tour="runners"]',
    title: 'The watch party',
    body: 'Everyone playing streams their game here live. Tap a runner to spectate their full run — encounters, deaths, diary and all.'
  },
  {
    selector: '[data-tour="history"]',
    title: 'Backups happen by themselves',
    body: 'Every time you save in-game, a timestamped backup lands here (and your progress auto-resumes next launch). Download any historical save whenever you need one.'
  },
  {
    selector: '.bug-fab',
    title: 'Something broke?',
    body: 'This button files a bug report with diagnostics attached. The lobby host sees it in their admin dashboard.'
  },
  {
    title: 'Inside a run 🎮',
    body: 'Open your attempt and you land in the Play view: the emulator (fullscreen on phones), an encounter radar that logs every wild battle automatically, and your live party synced from the game. Catches even mark themselves. Now go start attempt #1!'
  }
]

const fmtSize = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`)
const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  return hours < 24 ? `${hours}h ago` : new Date(iso).toLocaleDateString()
}

export default function LobbyHome() {
  const { sid } = useParams()
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
  const [history, setHistory] = useState(null) // rolling sav/state backup archive
  const [histShown, setHistShown] = useState(15)
  const [tourOpen, setTourOpen] = useState(false)

  // First arrival: run the tour once PER MEMBER (not per browser — a fresh
  // join in the same browser is a new person). Triggers on the join/create
  // handoff flag OR simply on being a brand-new member, so it can't be lost.
  useEffect(() => {
    if (!me) return
    if (localStorage.getItem(`nuz-tour-done:${memberToken}`)) return
    const isNewMember = Date.now() - new Date(me.member.createdAt).getTime() < 10 * 60 * 1000
    if (localStorage.getItem('nuz-tour-pending') || isNewMember) {
      localStorage.removeItem('nuz-tour-pending')
      const t = setTimeout(() => setTourOpen(true), 700)
      return () => clearTimeout(t)
    }
  }, [me?.member?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const closeTour = () => {
    setTourOpen(false)
    localStorage.setItem(`nuz-tour-done:${memberToken}`, '1')
  }

  const loadHistory = () => api.get('/api/me/save-history').then(setHistory).catch(() => {})

  const downloadHistoryFile = async (f) => {
    try {
      const res = await fetch(`/api/me/save-history/${encodeURIComponent(f.file)}`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`${res.status}`)
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `attempt${f.attemptNumber ?? 'x'}-${f.savedAt.replace(/[:.]/g, '-').slice(0, 19)}.${f.type === 'mstate' ? 'state' : f.type}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (err) {
      setError(`Download failed: ${err.message}`)
    }
  }
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
        forgetLink(memberToken)
        rememberLink(r.memberToken, `${me.member.name} @ ${me.lobby.name}`)
        // straight to the new decoy path — never paint the new secret on screen
        navigate(pathForToken(r.memberToken))
      } else {
        setRegenLink({ name: r.name, url })
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const toggleLinkManager = async (member) => {
    const makeMgr = !member.linkManager
    if (!window.confirm(makeMgr
      ? `Make ${member.name} a link manager? They'll be able to mint new secret links for any runner here (and see the new link).`
      : `Remove ${member.name}'s link-manager permission? They'll still be able to rotate their own link.`)) return
    try {
      await api.post(`/api/members/${member.id}/link-manager`, { enabled: makeMgr })
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const toggleRomManager = async (member) => {
    const makeMgr = !member.romManager
    if (!window.confirm(makeMgr
      ? `Make ${member.name} a ROM manager? They'll be able to replace the lobby ROM everyone plays.`
      : `Remove ${member.name}'s ROM-manager permission?`)) return
    try {
      await api.post(`/api/members/${member.id}/rom-manager`, { enabled: makeMgr })
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  const refresh = () => {
    api.get('/api/lobby/summary').then(setSummary).catch(() => {})
    api.get('/api/runs?memberId=me').then(setAttempts).catch(() => {})
    // keep publicUrl fresh so copied links track the live tunnel, and the
    // member payload fresh so permission changes (link manager) show up
    api.get('/api/me').then((d) => setMe((prev) => (prev ? { ...prev, publicUrl: d.publicUrl, member: d.member } : d))).catch(() => {})
  }

  useEffect(() => {
    api.get('/api/me').then((d) => {
      setMe(d)
      rememberLink(memberToken, `${d.member.name} @ ${d.lobby.name}`)
    }).catch((e) => setError(e.message))
    api.get('/api/games').then((g) => {
      setGames(g)
      if (g.length) setGameId(g.find((x) => x.id === 'emerald')?.id || g[0].id)
    }).catch(() => {})
    refresh()
    loadHistory()
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [sid]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ROM-clean mode: the file is hashed HERE in the browser — only the
  // fingerprint (name, size, SHA-256) is sent to the server.
  const registerRomMeta = async (file) => {
    setUploading(true)
    setError('')
    try {
      const sha256 = await sha256Hex(await file.arrayBuffer())
      const entry = await api.post('/api/lobby/rom-meta', { name: file.name, size: file.size, sha256 })
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
      navigate(`/s/${sid}/run/${run.id}`)
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
  // the copy chip shares the REAL secret link — the URL bar's /s/<sid> decoy
  // is device-local and would be useless to the recipient
  const myUrl = `${shareOrigin}/m/${memberToken}`

  return (
    <div className="app-shell">
      {tourOpen && <Tour steps={TOUR_STEPS(!!me.romCleanMode)} onClose={closeTour} />}
      <div className="run-header">
        <div className="run-title">
          <h1>{me.lobby.name}</h1>
          <div className="sub">You are <strong>{me.member.name}</strong> · {me.members.length} runner{me.members.length === 1 ? '' : 's'}</div>
        </div>
        <div className="stat-tiles">
          <button className="chip" data-tour="invite-link" onClick={() => copy(inviteUrl, 'invite')}>
            {copied === 'invite' ? <><Check size={13} /> Copied!</> : <><Link2 size={13} /> Copy invite link</>}
          </button>
          <button className="chip" data-tour="secret-link" onClick={() => copy(myUrl, 'personal')}>
            {copied === 'personal' ? <><Check size={13} /> Copied!</> : <><KeyRound size={13} /> Copy my secret link</>}
          </button>
          <button className="chip" onClick={() => setTourOpen(true)} title="Replay the walkthrough">
            <HelpCircle size={13} /> Tour
          </button>
          <span className="chip" title={me.publicUrl ? `Links copy with the public tunnel address: ${me.publicUrl}` : 'No tunnel running — links copy with this browser\'s address and may not work for others. Start the tunnel from the admin dashboard.'}>
            {me.publicUrl ? '🌐 public links' : '⚠ local links'}
          </span>
        </div>
      </div>
      {error && <p className="error-note">{error}</p>}

      <div className="home-grid">
        <div className="dash-col">
          <div className="panel" data-tour="attempts">
            <h2><span className="h2-title"><Trophy size={14} /> Your attempts</span></h2>
            {active ? (
              <div className="run-card">
                <div className="info">
                  <Link to={`/s/${sid}/run/${active.id}`}>Attempt #{active.attemptNumber} — {active.name}</Link>
                  <div className="sub">
                    {active.gameName} · 🏅{active.badges} · ●{active.alive} alive · ☠{active.deaths} deaths
                  </div>
                </div>
                <span className="spacer" />
                <Link to={`/s/${sid}/run/${active.id}`}><button className="small primary"><Play size={12} /> Continue</button></Link>
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
                      <Link to={`/s/${sid}/run/${a.id}`}>Attempt #{a.attemptNumber} — {a.name}</Link>
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

          <div className="panel" data-tour="rom">
            <h2>
              <span className="h2-title"><Gamepad2 size={14} /> Lobby ROM</span>
              {me.member.romManager && (
                <span className="h-actions">
                  <button className="small" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <Upload size={12} /> {uploading
                      ? (me.romCleanMode ? 'Registering…' : 'Uploading…')
                      : me.romCleanMode
                        ? (me.lobby.roms.length ? 'Re-register ROM' : 'Register ROM')
                        : (me.lobby.roms.length ? 'Replace ROM' : 'Upload ROM')}
                  </button>
                </span>
              )}
            </h2>
            <input ref={fileRef} type="file" accept=".gb,.gbc,.sgb,.gba,.nds" style={{ display: 'none' }}
              onChange={(e) => e.target.files[0] && (me.romCleanMode ? registerRomMeta(e.target.files[0]) : uploadRom(e.target.files[0]))} />
            {me.lobby.roms.length === 0 ? (
              <p className="empty-note">
                {me.romCleanMode
                  ? (me.member.romManager
                    ? 'BYO ROM: pick your ROM file to register WHICH game this lobby races — only its fingerprint (name, size, SHA-256) is stored here. Every runner supplies their own copy in their browser.'
                    : 'BYO ROM: a ROM manager registers the game (fingerprint only); each runner then supplies their own copy in their browser.')
                  : me.member.romManager
                    ? 'No ROM yet — upload the patched ROM this lobby will race. One ROM per lobby; it\'s served to every runner here, so make sure everyone in the lobby owns their own legal copy of the game.'
                    : 'No ROM yet — a ROM manager (the lobby creator, by default) uploads the game this lobby will race.'}
              </p>
            ) : (
              <div className="run-card">
                <div className="info">
                  <strong>{me.lobby.roms[0].name}</strong>
                  <div className="sub">
                    {me.lobby.roms[0].core.toUpperCase()} · {fmtSize(me.lobby.roms[0].size)} ·{' '}
                    {me.lobby.roms[0].hosted === false
                      ? <>BYO ROM — each runner supplies their own copy locally, fingerprint <code style={{ fontSize: 10 }}>{(me.lobby.roms[0].sha256 || '').slice(0, 12)}…</code></>
                      : 'used by every attempt in this lobby'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="dash-col">
        <div className="panel" data-tour="runners">
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
                <Link to={`/s/${sid}/view/${s.member.id}`} className="runner-stream">
                  <StreamView memberId={s.member.id} interval={1000} compact />
                </Link>
              )}
              <div className="info">
                {s.member.id === me.member.id
                  ? <strong>{s.member.name} (you)</strong>
                  : <Link to={`/s/${sid}/view/${s.member.id}`}>{s.member.name}</Link>}
                {s.member.id === me.lobby.creatorId && (
                  <span title="Lobby creator — their link and permissions are protected (host admin only)" style={{ marginLeft: 6, color: 'var(--accent)', verticalAlign: 'middle' }}>
                    <Crown size={12} style={{ verticalAlign: -2 }} />
                  </span>
                )}
                {s.member.linkManager && (
                  <span title="Link manager — can regenerate other runners' secret links" style={{ marginLeft: 6, color: 'var(--accent)', verticalAlign: 'middle' }}>
                    <ShieldCheck size={12} style={{ verticalAlign: -2 }} />
                  </span>
                )}
                {s.member.romManager && (
                  <span title="ROM manager — can replace the shared lobby ROM" style={{ marginLeft: 4, color: 'var(--accent)', verticalAlign: 'middle' }}>
                    <Gamepad2 size={12} style={{ verticalAlign: -2 }} />
                  </span>
                )}
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
              {(s.member.id === me.member.id || (me.member.linkManager && s.member.id !== me.lobby.creatorId)) && (
                <button
                  className="small"
                  title={s.member.id === me.member.id ? 'Regenerate your secret link (old one stops working)' : `Regenerate ${s.member.name}'s secret link — for when they've lost theirs`}
                  onClick={() => regenerate(s.member)}
                ><KeyRound size={12} /></button>
              )}
              {me.member.linkManager && s.member.id !== me.member.id && s.member.id !== me.lobby.creatorId && (
                <button
                  className="small"
                  title={s.member.linkManager ? `Remove ${s.member.name}'s link-manager permission` : `Make ${s.member.name} a link manager (can regenerate anyone's secret link)`}
                  onClick={() => toggleLinkManager(s.member)}
                >{s.member.linkManager ? <ShieldOff size={12} /> : <ShieldCheck size={12} />}</button>
              )}
              {me.member.romManager && s.member.id !== me.member.id && s.member.id !== me.lobby.creatorId && (
                <button
                  className={`small ${s.member.romManager ? 'primary' : ''}`}
                  title={s.member.romManager ? `Remove ${s.member.name}'s ROM-manager permission` : `Make ${s.member.name} a ROM manager (can replace the lobby ROM)`}
                  onClick={() => toggleRomManager(s.member)}
                ><Gamepad2 size={12} /></button>
              )}
              {s.member.id !== me.member.id && (
                <Link to={`/s/${sid}/view/${s.member.id}`}>
                  <button className={`small ${s.live ? 'primary' : ''}`}><Eye size={12} /> {s.live ? 'Watch live' : 'Watch'}</button>
                </Link>
              )}
            </div>
          ))}
        </div>

        <div className="panel" data-tour="history">
          <h2>
            <span className="h2-title"><History size={14} /> Backup history</span>
            <span className="h-actions">
              <button className="small" onClick={loadHistory}><RefreshCw size={12} /> Refresh</button>
            </span>
          </h2>
          {!history || history.files.length === 0 ? (
            <p className="empty-note">No backups yet — they appear automatically every time you save in-game.</p>
          ) : (
            <>
              <p className="map-tip" style={{ marginTop: 0 }}>
                {history.files.length} file{history.files.length === 1 ? '' : 's'} ·
                {' '}{(history.totalSize / 1048576).toFixed(1)} MB of {(history.cap / 1073741824).toFixed(0)} GB —
                oldest are pruned automatically. The newest pair is what the game auto-resumes from.
              </p>
              <div className="hist-list">
                {history.files.slice(0, histShown).map((f) => (
                  <div className="hist-row" key={f.file}>
                    <span className="hist-main">
                      Attempt #{f.attemptNumber ?? '?'} · <code>{f.type === 'mstate' ? '.state (manual)' : `.${f.type}`}</code>
                    </span>
                    <span className="hist-meta">{new Date(f.savedAt).toLocaleString()} · {(f.size / 1024).toFixed(0)} KB</span>
                    <button className="small" title="Download" onClick={() => downloadHistoryFile(f)}><Download size={12} /></button>
                  </div>
                ))}
              </div>
              {history.files.length > histShown && (
                <button className="small" style={{ marginTop: 6 }} onClick={() => setHistShown((n) => n + 25)}>
                  Show more ({history.files.length - histShown} hidden)
                </button>
              )}
            </>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}
