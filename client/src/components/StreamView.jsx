import React, { useEffect, useRef, useState } from 'react'
import { authHeaders } from '../api.js'

// Polls a runner's latest emulator frame. Frames are fetched with the member
// token header and shown via object URLs — no tokens in <img> URLs.
export default function StreamView({ memberId, interval = 600, compact = false }) {
  const [url, setUrl] = useState(null)
  const [live, setLive] = useState(false)
  const urlRef = useRef(null)

  useEffect(() => {
    let stopped = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/stream/${memberId}`, { headers: authHeaders() })
        if (stopped) return
        if (!res.ok) { setLive(false); return }
        const blob = await res.blob()
        if (stopped) return
        const next = URL.createObjectURL(blob)
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = next
        setUrl(next)
        setLive(true)
      } catch {
        if (!stopped) setLive(false)
      }
    }
    tick()
    const t = setInterval(tick, interval)
    return () => {
      stopped = true
      clearInterval(t)
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [memberId, interval])

  return (
    <div className={`stream-view ${compact ? 'compact' : ''}`}>
      {url && live
        ? <img src={url} alt="live game stream" />
        : <div className="stream-offline">{compact ? 'offline' : 'Stream offline — the runner isn’t playing right now.'}</div>}
      {live && <span className="live-chip">● LIVE</span>}
    </div>
  )
}
