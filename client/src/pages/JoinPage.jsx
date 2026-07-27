import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Eye, EyeOff, Copy, Check, Download, ShieldAlert } from 'lucide-react'
import { api, rememberLink, pathForToken } from '../api.js'

export default function JoinPage() {
  const { invite } = useParams()
  const [lobbyName, setLobbyName] = useState(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  // Post-join interstitial: the one moment the secret link exists on screen.
  // Browsers have NO API to create or verify bookmarks, so the best we can
  // do is make saving effortless and gate continuing on explicit confirmation.
  const [joined, setJoined] = useState(null) // { memberToken, url }
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmedSaved, setConfirmedSaved] = useState(false)
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
      setJoined({ memberToken, url: `${window.location.origin}/m/${memberToken}` })
    } catch (err) {
      setError(err.message)
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(joined.url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  // A tiny self-opening HTML file: double-click it later and you're signed in.
  // Works as a "bookmark" that survives cleared browser data and new devices.
  const downloadLinkFile = () => {
    const html = `<!doctype html><title>Nuz-Dash — ${name.trim()}</title><meta http-equiv="refresh" content="0;url=${joined.url}"><p>Opening your Nuz-Dash lobby… <a href="${joined.url}">click here</a> if nothing happens.</p>`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    a.download = 'nuzdash-secret-link.html'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 30000)
  }

  const enterLobby = () => {
    rememberLink(joined.memberToken, `${name.trim()} @ ${lobbyName}`)
    try { localStorage.setItem('nuz-tour-pending', '1') } catch { /* private mode */ }
    // straight to the decoy path — the secret never hits the URL bar
    navigate(pathForToken(joined.memberToken))
  }

  return (
    <div className="app-shell" style={{ maxWidth: 520 }}>
      <div className="home-title">
        <h1>Nuz-Dash</h1>
      </div>
      {!joined ? (
        <div className="panel">
          <h2>Join lobby</h2>
          {error && <p className="error-note">{error}</p>}
          {lobbyName && (
            <form className="new-run-form" onSubmit={join}>
              <p>You've been invited to <strong>{lobbyName}</strong>.</p>
              <input placeholder="Your runner name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              <button className="primary" type="submit" disabled={!name.trim()}>Join as {name.trim() || '…'}</button>
              <p className="map-tip">You'll get a personal secret link — the next step helps you save it before you play.</p>
            </form>
          )}
        </div>
      ) : (
        <div className="panel">
          <h2>Save your secret link first</h2>
          <p className="warn-note" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <ShieldAlert size={28} style={{ flexShrink: 0 }} />
            <span><strong>Streaming or recording?</strong> Hide your screen capture NOW, before revealing,
            copying or saving anything here — and never show your bookmarks bar or password manager on
            stream. This link <em>is</em> your login.</span>
          </p>
          <p>This secret link is your only way back into <strong>{lobbyName}</strong> — there's no username,
          no password, no email reset. While you play, the address bar shows a harmless random session URL,
          so the link below is the ONLY copy you'll see. Save it somewhere durable:</p>
          <div className="run-card" style={{ alignItems: 'center', gap: 8 }}>
            <code style={{ fontSize: 12, wordBreak: 'break-all', flex: 1 }}>
              {revealed ? joined.url : `${window.location.origin}/m/${'•'.repeat(20)}`}
            </code>
            <button className="small" title={revealed ? 'Hide the link' : 'Reveal the link (make sure no capture is running)'} onClick={() => setRevealed((r) => !r)}>
              {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
          <div className="row" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button className="primary" onClick={copyLink}>
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}
            </button>
            <button onClick={downloadLinkFile}>
              <Download size={14} /> Download link file
            </button>
          </div>
          <p className="map-tip" style={{ marginTop: 10 }}>
            Best homes for it: your password manager, or a bookmark you create by <em>pasting the copied
            link</em> into your bookmark manager. (Browsers don't let sites bookmark for you — and pressing
            Ctrl+D inside the app would only save this device's decoy address, not your real link.)
            The downloaded file works too: double-click it any time to get back in.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <input type="checkbox" checked={confirmedSaved} onChange={(e) => setConfirmedSaved(e.target.checked)} />
            I've saved my secret link somewhere safe (and off-stream)
          </label>
          <button className="primary" style={{ width: '100%', marginTop: 10 }} disabled={!confirmedSaved} onClick={enterLobby}>
            Enter {lobbyName}
          </button>
        </div>
      )}
    </div>
  )
}
