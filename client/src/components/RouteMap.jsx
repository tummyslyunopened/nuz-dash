import React, { useMemo, useRef, useState } from 'react'
import { spriteUrl, titleCase, STATUS_META, encounterState, locationState } from '../api.js'

// Built-in route map: an SVG node graph in a fixed-width coordinate space.
// Locations appear in the order they were first encountered, laid out on a
// snaking grid; dragged positions are saved per game in viewBox coords.
const VW = 1000
const COLS = 5
const SLOT_W = 180
const SLOT_H = 135
const MARGIN_X = 95
const MARGIN_Y = 75
const NODE_R = 22

function slotPos(i) {
  const row = Math.floor(i / COLS)
  const colRaw = i % COLS
  const col = row % 2 === 0 ? colRaw : COLS - 1 - colRaw // snake back and forth
  return { x: MARGIN_X + col * SLOT_W, y: MARGIN_Y + row * SLOT_H }
}

const shortLabel = (s) => (s.length > 18 ? s.slice(0, 17) + '…' : s)

export default function RouteMap({ encounters, locations, nodes, onSaveNodes }) {
  const [adding, setAdding] = useState('')
  const [drag, setDrag] = useState(null) // { loc, x, y, moved }
  const svgRef = useRef(null)

  const byLocation = useMemo(() => {
    const m = {}
    for (const e of encounters) (m[e.location] = m[e.location] || []).push(e)
    return m
  }, [encounters])

  // Encounter locations in first-visit order, then manually planned nodes
  const orderedLocs = useMemo(() => {
    const seen = []
    for (const e of encounters) if (!seen.includes(e.location)) seen.push(e.location)
    for (const loc of Object.keys(nodes)) if (!seen.includes(loc)) seen.push(loc)
    return seen
  }, [encounters, nodes])

  const rows = Math.max(1, Math.ceil(Math.max(orderedLocs.length, 1) / COLS))
  const vh = MARGIN_Y * 2 + (rows - 1) * SLOT_H + 40

  const positions = useMemo(() => {
    const pos = {}
    orderedLocs.forEach((loc, i) => {
      pos[loc] = nodes[loc] || slotPos(i)
    })
    return pos
  }, [orderedLocs, nodes])

  const livePos = (loc) => (drag && drag.loc === loc ? { x: drag.x, y: drag.y } : positions[loc])

  const routeLocs = orderedLocs.filter((loc) => byLocation[loc])
  const currentLoc = encounters.length ? encounters[encounters.length - 1].location : null

  const pinOptions = useMemo(() => {
    const set = new Set(locations)
    for (const loc of orderedLocs) set.delete(loc)
    return [...set].sort()
  }, [locations, orderedLocs])

  const toSvg = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    return {
      x: Math.min(VW - 40, Math.max(40, ((e.clientX - rect.left) / rect.width) * VW)),
      y: Math.min(vh - 30, Math.max(35, ((e.clientY - rect.top) / rect.height) * vh))
    }
  }

  const startDrag = (loc) => (e) => {
    e.preventDefault()
    const p = toSvg(e)
    setDrag({ loc, ...p, moved: false })
  }

  const onMove = (e) => {
    if (!drag) return
    const p = toSvg(e)
    setDrag({ ...drag, ...p, moved: true })
  }

  const endDrag = () => {
    if (!drag) return
    if (drag.moved) {
      onSaveNodes({ ...nodes, [drag.loc]: { x: Math.round(drag.x), y: Math.round(drag.y) } })
    }
    setDrag(null)
  }

  const addPlanned = (e) => {
    e.preventDefault()
    const loc = adding.trim()
    if (!loc || orderedLocs.includes(loc)) return
    onSaveNodes({ ...nodes, [loc]: slotPos(orderedLocs.length) })
    setAdding('')
  }

  const onNodeContextMenu = (loc) => (e) => {
    e.preventDefault()
    if (byLocation[loc]) {
      if (nodes[loc] && window.confirm(`Reset "${loc}" back to the automatic layout?`)) {
        const next = { ...nodes }
        delete next[loc]
        onSaveNodes(next)
      }
    } else if (window.confirm(`Remove planned location "${loc}" from the map?`)) {
      const next = { ...nodes }
      delete next[loc]
      onSaveNodes(next)
    }
  }

  const resetLayout = () => {
    if (window.confirm('Reset the whole layout? This also removes planned (no-encounter) locations.')) {
      onSaveNodes({})
    }
  }

  const legendStates = ['caught', 'dead', 'killed', 'fled', 'missed']

  return (
    <div>
      <div className="map-toolbar">
        <form onSubmit={addPlanned} style={{ display: 'flex', gap: 8, flex: 1, minWidth: 220 }}>
          <input
            list="planned-location-options"
            placeholder="Pre-place an upcoming location…"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            style={{ flex: 1 }}
          />
          <datalist id="planned-location-options">
            {pinOptions.map((l) => <option key={l} value={l} />)}
          </datalist>
          <button className="small" type="submit" disabled={!adding.trim()}>Add</button>
        </form>
        <button className="small" onClick={resetLayout} disabled={!Object.keys(nodes).length}>Reset layout</button>
      </div>
      {orderedLocs.length === 0 ? (
        <div className="map-upload">
          <p>The map draws itself as you play.</p>
          <p>Log an encounter (or pre-place a location above) and it appears here as a node on your route.</p>
        </div>
      ) : (
        <svg
          ref={svgRef}
          className="route-map"
          viewBox={`0 0 ${VW} ${vh}`}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
        >
          {routeLocs.map((loc, i) => {
            if (i === 0) return null
            const a = livePos(routeLocs[i - 1])
            const b = livePos(loc)
            return <line key={loc} className="edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          })}
          {orderedLocs.map((loc) => {
            const encs = byLocation[loc] || []
            const state = locationState(encs)
            const meta = state === 'none' ? null : STATUS_META[state]
            const p = livePos(loc)
            const lead = encs.find((e) => e.status === 'caught' && e.alive) || encs[encs.length - 1]
            const tip = meta
              ? `${loc}: ${encs.map((e) => `${e.nickname || titleCase(e.speciesName)} (${STATUS_META[encounterState(e)].label})`).join(', ')}`
              : `${loc}: planned — no encounter yet`
            return (
              <g
                key={loc}
                className={`rnode pin-${state}`}
                transform={`translate(${p.x}, ${p.y})`}
                onPointerDown={startDrag(loc)}
                onContextMenu={onNodeContextMenu(loc)}
              >
                <title>{tip}</title>
                {loc === currentLoc && <circle className="current-ring" r={NODE_R + 7} />}
                <circle className="body" r={NODE_R} />
                {lead && lead.speciesId ? (
                  <image
                    href={spriteUrl(lead.speciesId, lead.shiny)}
                    x={-19} y={-19} width={38} height={38}
                    style={{ pointerEvents: 'none' }}
                  />
                ) : (
                  <text className="qmark" y={5}>?</text>
                )}
                {meta && (
                  <g className="badge" transform={`translate(${NODE_R - 6}, ${NODE_R - 6})`}>
                    <circle r={8} />
                    <text y={3}>{meta.icon}</text>
                  </g>
                )}
                <text className="lbl" y={NODE_R + 16}>{shortLabel(loc)}</text>
                {loc === currentLoc && <text className="cur-lbl" y={-NODE_R - 10}>▶ current</text>}
              </g>
            )
          })}
        </svg>
      )}
      <div className="map-legend">
        {legendStates.map((s) => (
          <span key={s}>
            <i style={{ background: `var(--${s === 'caught' ? 'good' : s === 'dead' ? 'critical' : s === 'killed' ? 'serious' : s === 'fled' ? 'warning' : 'muted'})` }} />
            {STATUS_META[s].icon} {STATUS_META[s].label}
          </span>
        ))}
        <span><i style={{ background: 'var(--surface-2)' }} /> Planned</span>
      </div>
      <p className="map-tip">
        Drag nodes to match the region's shape — the layout is saved per game and reused across runs.
        Right-click a node to reset or remove it.
      </p>
    </div>
  )
}
