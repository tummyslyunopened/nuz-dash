import React, { useMemo, useRef, useState } from 'react'
import { api, STATUS_META, encounterState, locationState } from '../api.js'
import RouteMap from './RouteMap.jsx'

export default function MapPanel({ run, encounters, locations, map, setMap }) {
  const [mode, setMode] = useState('route') // route (built-in) | image (uploaded underlay)
  const [placing, setPlacing] = useState(false)
  const [selected, setSelected] = useState('')
  const fileRef = useRef(null)

  const byLocation = useMemo(() => {
    const m = {}
    for (const e of encounters) (m[e.location] = m[e.location] || []).push(e)
    return m
  }, [encounters])

  const pinOptions = useMemo(() => {
    const set = new Set([...Object.keys(map?.pins || {}), ...Object.keys(byLocation), ...locations])
    return [...set].sort()
  }, [map, byLocation, locations])

  const upload = (file) => {
    const reader = new FileReader()
    reader.onload = async () => {
      const updated = await api.post(`/api/maps/${run.gameId}/image`, { dataUrl: reader.result })
      setMap(updated)
      setMode('image')
    }
    reader.readAsDataURL(file)
  }

  const savePins = async (pins) => {
    setMap({ ...map, pins })
    await api.put(`/api/maps/${run.gameId}/pins`, { pins })
  }

  const saveNodes = async (nodes) => {
    setMap({ ...map, nodes })
    await api.put(`/api/maps/${run.gameId}/nodes`, { nodes })
  }

  const onMapClick = (e) => {
    if (!placing || !selected) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    savePins({ ...map.pins, [selected]: { x, y } })
  }

  const removePin = () => {
    if (!selected || !map.pins[selected]) return
    const pins = { ...map.pins }
    delete pins[selected]
    savePins(pins)
  }

  const legendStates = ['caught', 'dead', 'killed', 'fled', 'missed']

  return (
    <div className="panel">
      <h2>
        Route map
        <span className="h-actions">
          {map?.image && (
            <>
              <button className={`small ${mode === 'route' ? 'primary' : ''}`} onClick={() => setMode('route')}>Route</button>
              <button className={`small ${mode === 'image' ? 'primary' : ''}`} onClick={() => setMode('image')}>Image</button>
            </>
          )}
          {mode === 'image' && map?.image && (
            <>
              <button className="small" onClick={() => fileRef.current?.click()}>Replace image</button>
              <button className={`small ${placing ? 'primary' : ''}`} onClick={() => setPlacing((p) => !p)}>
                {placing ? 'Done placing' : 'Place pins'}
              </button>
            </>
          )}
          {mode === 'route' && !map?.image && (
            <button className="small" onClick={() => fileRef.current?.click()} title="Optional: use a real map image instead">
              Use image map…
            </button>
          )}
        </span>
      </h2>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => e.target.files[0] && upload(e.target.files[0])}
      />

      {mode === 'route' || !map?.image ? (
        <RouteMap
          encounters={encounters}
          locations={locations}
          nodes={map?.nodes || {}}
          onSaveNodes={saveNodes}
        />
      ) : (
        <>
          {placing && (
            <div className="map-toolbar">
              <input
                list="pin-location-options"
                placeholder="Location to place…"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                style={{ flex: 1, minWidth: 180 }}
              />
              <datalist id="pin-location-options">
                {pinOptions.map((l) => <option key={l} value={l} />)}
              </datalist>
              {selected && map.pins[selected] && (
                <button className="small danger" onClick={removePin}>Remove pin</button>
              )}
            </div>
          )}
          <div className={`map-wrap ${placing ? 'placing' : ''}`} onClick={onMapClick}>
            <img className="map-img" src={map.image} alt={`${run.gameName} region map`} draggable={false} />
            {Object.entries(map.pins).map(([loc, pos]) => {
              const state = locationState(byLocation[loc] || [])
              const meta = state === 'none' ? null : STATUS_META[state]
              const encs = byLocation[loc] || []
              const tip = meta
                ? `${loc}: ${encs.map((e) => `${e.nickname || e.speciesName} (${STATUS_META[encounterState(e)].label})`).join(', ')}`
                : `${loc}: no encounter yet`
              return (
                <div
                  key={loc}
                  className={`map-pin pin-${state} ${placing && selected === loc ? 'pin-selected' : ''}`}
                  style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
                  title={tip}
                  onClick={(e) => { if (placing) { e.stopPropagation(); setSelected(loc) } }}
                >
                  {meta ? meta.icon : ''}
                </div>
              )
            })}
          </div>
          {placing ? (
            <p className="map-tip">
              Pick a location above, then click the map to drop its pin. Pins are saved per game and reused across runs.
            </p>
          ) : (
            <div className="map-legend">
              {legendStates.map((s) => (
                <span key={s}>
                  <i style={{ background: `var(--${s === 'caught' ? 'good' : s === 'dead' ? 'critical' : s === 'killed' ? 'serious' : s === 'fled' ? 'warning' : 'muted'})` }} />
                  {STATUS_META[s].icon} {STATUS_META[s].label}
                </span>
              ))}
              <span><i style={{ background: 'var(--surface-2)' }} /> No encounter yet</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
