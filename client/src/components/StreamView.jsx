import React, { useEffect, useRef, useState } from 'react'
import { authHeaders, spriteUrl } from '../api.js'

// Polls a runner's latest emulator frame (fetched with the member token
// header — no tokens in URLs). Each JPEG is decoded OFF-SCREEN and painted
// onto a persistent canvas: swapping <img src> at fast poll rates flashes
// black while the next frame decodes, a canvas never blanks between draws.
// With showMeta, a light overlay shows the runner's LIVE state (current area
// + party with HP, pushed alongside the frames) and who's watching.
export default function StreamView({ memberId, interval = 300, compact = false, showMeta = false }) {
  const [live, setLive] = useState(false)
  const [meta, setMeta] = useState(null)
  const canvasRef = useRef(null)
  const missesRef = useRef(0)

  useEffect(() => {
    let stopped = false
    // Viewer diagnostics per streamer — surfaced on the spectator page and
    // attached to bug reports (black-frame hunting on the receive side)
    const all = (window.__nuzViewStats = window.__nuzViewStats || {})
    const vs = (all[memberId] = all[memberId] || {
      frames: 0, misses: 0, decodeFail: 0, blackReceived: 0,
      lums: [], sizes: [], gaps: [], blackAt: [], lastAt: 0, frameSize: null
    })
    const probe = document.createElement('canvas')
    probe.width = 16
    probe.height = 12
    const receivedLum = (bmp) => {
      try {
        const ctx = probe.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(bmp, 0, 0, 16, 12)
        const px = ctx.getImageData(0, 0, 16, 12).data
        let max = 0
        for (let i = 0; i < px.length; i += 4) {
          const v = px[i] + px[i + 1] + px[i + 2]
          if (v > max) max = v
        }
        return max
      } catch { return -1 }
    }
    // Draw pipeline with backpressure: frames decode/draw as they arrive;
    // if one is still decoding when the next lands, only the LATEST waits.
    let drawing = false
    let pending = null
    const drawJpeg = async (bytes) => {
      if (drawing) { pending = bytes; return }
      drawing = true
      try {
        let bmp
        try {
          bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }))
        } catch { vs.decodeFail += 1; return }
        if (stopped) { bmp.close?.(); return }
        const now = Date.now()
        vs.frames += 1
        vs.frameSize = `${bmp.width}x${bmp.height}`
        if (vs.lastAt) { vs.gaps.push(now - vs.lastAt); if (vs.gaps.length > 80) vs.gaps.shift() }
        vs.lastAt = now
        vs.sizes.push(bytes.length)
        if (vs.sizes.length > 80) vs.sizes.shift()
        const lum = receivedLum(bmp)
        vs.lums.push(lum)
        if (vs.lums.length > 80) vs.lums.shift()
        if (lum >= 0 && lum <= 45) {
          vs.blackReceived += 1
          vs.blackAt.push(new Date().toISOString().slice(11, 23))
          if (vs.blackAt.length > 20) vs.blackAt.shift()
        }
        const c = canvasRef.current
        if (c) {
          // resize only when the frame size actually changes (resizing clears)
          if (c.width !== bmp.width || c.height !== bmp.height) {
            c.width = bmp.width
            c.height = bmp.height
          }
          c.getContext('2d').drawImage(bmp, 0, 0)
        }
        bmp.close?.()
        setLive(true)
      } finally {
        drawing = false
        if (pending && !stopped) {
          const next = pending
          pending = null
          drawJpeg(next)
        }
      }
    }

    // Primary transport: the push stream — every broadcast frame arrives on
    // one held-open response (4-byte LE length + JPEG). Reconnects forever;
    // marked offline only when no frame lands for a while.
    let reader = null
    const concat = (a, b) => {
      const out = new Uint8Array(a.length + b.length)
      out.set(a, 0)
      out.set(b, a.length)
      return out
    }
    const streamLoop = async () => {
      while (!stopped) {
        try {
          const res = await fetch(`/api/stream/${memberId}/live`, { headers: authHeaders() })
          if (!res.ok || !res.body) throw new Error('no stream')
          reader = res.body.getReader()
          let buf = new Uint8Array(0)
          for (;;) {
            const { value, done } = await reader.read()
            if (done || stopped) break
            buf = buf.length ? concat(buf, value) : value
            for (;;) {
              if (buf.length < 4) break
              const len = new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0, true)
              if (len === 0 || len > 4_000_000) throw new Error('stream desync')
              if (buf.length < 4 + len) break
              drawJpeg(buf.slice(4, 4 + len))
              buf = buf.subarray(4 + len)
            }
          }
        } catch { /* server restart / network blip — reconnect below */ }
        if (stopped) return
        vs.misses += 1
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    streamLoop()
    // Freshness watchdog: no frame for 6s = the runner stopped streaming
    const watchdog = setInterval(() => {
      if (vs.lastAt && Date.now() - vs.lastAt > 6000) setLive(false)
      else if (!vs.lastAt) {
        missesRef.current += 1
        if (missesRef.current >= 4) setLive(false)
      }
    }, 2000)
    return () => {
      stopped = true
      clearInterval(watchdog)
      reader?.cancel().catch(() => {})
    }
  }, [memberId, interval])

  useEffect(() => {
    if (!showMeta) return
    let stopped = false
    const tick = async () => {
      try {
        const res = await fetch(`/api/stream/${memberId}/meta`, { headers: authHeaders() })
        if (!stopped && res.ok) setMeta(await res.json())
      } catch { /* keep last */ }
    }
    tick()
    const t = setInterval(tick, 2500)
    return () => { stopped = true; clearInterval(t) }
  }, [memberId, showMeta])

  const watchers = meta?.watchers || []

  return (
    <div className={`stream-view ${compact ? 'compact' : ''}`}>
      <canvas ref={canvasRef} aria-label="live game stream" style={{ display: live ? 'block' : 'none' }} />
      {!live && <div className="stream-offline">{compact ? 'offline' : 'Stream offline — the runner isn’t playing right now.'}</div>}
      {live && <span className="live-chip">● LIVE</span>}
      {live && showMeta && watchers.length > 0 && (
        <span className="watchers-chip" title={`Watching: ${watchers.join(', ')}`}>👁 {watchers.length}</span>
      )}
      {live && showMeta && meta && (meta.area || meta.party?.length > 0) && (
        <div className="stream-meta">
          {meta.area && <span className="sm-area">📍 {meta.area}</span>}
          {meta.party?.length > 0 && (
            <span className="sm-party">
              {meta.party.slice(0, 6).map((p, i) => (
                <span key={i} className={`sm-mon ${p.hp === 0 ? 'sm-fnt' : ''}`} title={`Lv. ${p.level} · ${p.hp}/${p.maxHp} HP`}>
                  {p.speciesId ? <img src={spriteUrl(p.speciesId, p.shiny)} alt="" /> : <span className="rr-noimg">?</span>}
                  <span className="sm-hp"><span
                    className={p.maxHp && p.hp / p.maxHp > 0.5 ? 'hp-good' : p.maxHp && p.hp / p.maxHp > 0.2 ? 'hp-warn' : 'hp-crit'}
                    style={{ width: `${p.maxHp ? Math.max(4, (p.hp / p.maxHp) * 100) : 0}%` }}
                  /></span>
                </span>
              ))}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
