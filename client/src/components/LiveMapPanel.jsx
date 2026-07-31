import React, { useEffect, useRef, useState } from 'react'
import { Map as MapIcon } from 'lucide-react'
import { api, spriteUrl } from '../api.js'
import { overworldMaps, WORLD_SIZE } from '../gen3maps.js'

// The lobby's live region map: a schematic Hoenn drawn from the same stitched
// map-connection data that powers global positions (no game artwork — the
// route/town rectangles themselves form the region), with every runner's lead
// Pokemon walking across it. Positions arrive at ~1s cadence via the stream
// meta; a 60fps render loop eases sprites toward their latest tile.
export default function LiveMapPanel({ meId }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const [runners, setRunners] = useState([])
  const runnersRef = useRef([])
  const displayRef = useRef(new Map()) // memberId -> smoothed tile pos {x,y}
  const spritesRef = useRef(new Map()) // speciesId-shiny -> Image

  useEffect(() => {
    let stop = false
    const poll = () =>
      api.get('/api/lobby/positions')
        .then((r) => { if (!stop) { runnersRef.current = r; setRunners(r) } })
        .catch(() => {})
    poll()
    const t = setInterval(poll, 1000)
    return () => { stop = true; clearInterval(t) }
  }, [])

  const getSprite = (lead) => {
    if (!lead?.speciesId) return null
    const key = `${lead.speciesId}-${lead.shiny ? 1 : 0}`
    let img = spritesRef.current.get(key)
    if (!img) {
      img = new Image()
      img.src = spriteUrl(lead.speciesId, lead.shiny)
      spritesRef.current.set(key, img)
    }
    return img
  }

  useEffect(() => {
    const maps = overworldMaps()
    let raf
    let last = performance.now()
    const draw = (ts) => {
      raf = requestAnimationFrame(draw)
      if (document.hidden) return
      const canvas = canvasRef.current
      const wrap = wrapRef.current
      if (!canvas || !wrap || !wrap.clientWidth) return
      const cssW = wrap.clientWidth
      const scale = cssW / WORLD_SIZE.w
      const cssH = Math.ceil(WORLD_SIZE.h * scale) + 10 // room for name labels
      const dpr = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
        canvas.style.height = `${cssH}px`
      }
      const dt = Math.min(0.1, (ts - last) / 1000)
      last = ts
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, cssW, cssH)

      // Region: routes faint, towns brighter — the rectangles ARE Hoenn
      for (const m of maps) {
        ctx.fillStyle = m.town ? 'rgba(139, 92, 246, 0.30)' : 'rgba(139, 92, 246, 0.10)'
        ctx.fillRect(m.x * scale, m.y * scale, m.w * scale, m.h * scale)
        ctx.strokeStyle = 'rgba(196, 181, 253, 0.15)'
        ctx.strokeRect(m.x * scale + 0.5, m.y * scale + 0.5, m.w * scale - 1, m.h * scale - 1)
      }
      // Town names, when there's room for them
      if (scale >= 0.85) {
        ctx.font = `${Math.round(Math.max(9, 10 * scale))}px system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.fillStyle = 'rgba(201, 195, 220, 0.75)'
        for (const m of maps) {
          if (!m.town || !m.name) continue
          ctx.fillText(m.name.replace(/ (City|Town)$/, ''), (m.x + m.w / 2) * scale, (m.y + m.h / 2) * scale + 3)
        }
      }

      // Runners: ease toward the latest tile; snap on warps (fly/teleport)
      for (const r of runnersRef.current) {
        const target = r.pos?.gx != null ? { x: r.pos.gx, y: r.pos.gy } : null
        let cur = displayRef.current.get(r.memberId)
        if (target) {
          if (!cur || Math.hypot(target.x - cur.x, target.y - cur.y) > 50) cur = { ...target }
          const k = 1 - Math.exp(-dt * 4)
          cur = { x: cur.x + (target.x - cur.x) * k, y: cur.y + (target.y - cur.y) * k }
          displayRef.current.set(r.memberId, cur)
        }
        if (!cur) continue // indoors and never seen on the overworld
        const px = cur.x * scale
        const py = cur.y * scale
        const dim = !r.live || !target // offline, or indoors right now
        ctx.globalAlpha = dim ? 0.45 : 1
        const img = getSprite(r.lead)
        const S = 28
        if (r.memberId === meId) {
          ctx.beginPath()
          ctx.arc(px, py - 6, S / 2 + 2, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(139, 92, 246, 0.9)'
          ctx.lineWidth = 2
          ctx.stroke()
          ctx.lineWidth = 1
        }
        if (img?.complete && img.naturalWidth) {
          ctx.drawImage(img, px - S / 2, py - S + 8, S, S)
        } else {
          ctx.beginPath()
          ctx.arc(px, py, 5, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(139, 92, 246, 0.95)'
          ctx.fill()
        }
        const label = target ? r.name : `${r.name} · ${r.area || 'indoors'}`
        ctx.font = '600 11px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.strokeStyle = 'rgba(12, 10, 18, 0.85)'
        ctx.lineWidth = 3
        ctx.strokeText(label, px, py + 16)
        ctx.fillStyle = 'rgba(244, 241, 251, 0.95)'
        ctx.fillText(label, px, py + 16)
        ctx.lineWidth = 1
        ctx.globalAlpha = 1
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [meId]) // eslint-disable-line react-hooks/exhaustive-deps

  const unseen = runners.filter((r) => r.pos?.gx == null && !displayRef.current.has(r.memberId))

  return (
    <div className="panel">
      <h2><span className="h2-title"><MapIcon size={14} /> Live map</span></h2>
      <div ref={wrapRef} className="livemap-wrap">
        <canvas ref={canvasRef} className="livemap-canvas" />
      </div>
      {runners.length === 0 ? (
        <p className="map-tip">Runners appear here the moment their game hits the overworld — live position streams with their gameplay.</p>
      ) : unseen.length > 0 ? (
        <p className="map-tip">Elsewhere: {unseen.map((r) => `${r.name} (${r.area || 'indoors'})`).join(', ')}</p>
      ) : null}
    </div>
  )
}
