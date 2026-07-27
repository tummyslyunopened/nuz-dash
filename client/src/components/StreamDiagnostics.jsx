import React, { useEffect, useState } from 'react'

// Live counters for the watch-party pipeline, both directions. The same data
// attaches to bug reports (diagnostics.js), so "reproduce, then hit the bug
// button" captures everything.

const fmtLums = (lums) => {
  if (!lums?.length) return '—'
  const nums = lums.filter((v) => v >= 0)
  if (!nums.length) return 'probe unavailable'
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const black = nums.filter((v) => v <= 45).length
  return `min ${min} · max ${max} · ${black}/${nums.length} near-black`
}

export default function StreamDiagnostics({ source, memberId }) {
  const [s, setS] = useState(null)
  useEffect(() => {
    const read = () => {
      const raw = source === 'broadcast' ? window.__nuzStreamStats : window.__nuzViewStats?.[memberId]
      try { setS(raw ? JSON.parse(JSON.stringify(raw)) : null) } catch { setS(null) }
    }
    read()
    const t = setInterval(read, 1000)
    return () => clearInterval(t)
  }, [source, memberId])
  if (!s) return null
  return (
    <details className="map-tip">
      <summary style={{ cursor: 'pointer' }}>Stream diagnostics ({source === 'broadcast' ? 'sending' : 'receiving'})</summary>
      {source === 'broadcast' ? (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          <li>captured {s.captured} · sent {s.sent} · send failures {s.sendFail}</li>
          <li>dropped near-black {s.droppedBlack} · empty blobs {s.blobNull} · canvas missing {s.noSrc}</li>
          <li>source {s.srcSize || '?'} · crop {s.bbox || 'full frame'} · crop changes {s.bboxChanges}</li>
          <li>captured-frame luminance: {fmtLums(s.lums)}</li>
          {s.detectLog?.length > 0 && (
            <li>recent crop changes: {s.detectLog.slice(-5).map((d) => `${d.t} → ${d.box}`).join(' · ')}</li>
          )}
        </ul>
      ) : (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          <li>frames {s.frames} ({s.frameSize || '?'}) · missed polls {s.misses} · decode failures {s.decodeFail}</li>
          <li><strong>near-black frames received: {s.blackReceived}</strong>{s.blackAt?.length ? ` (latest at ${s.blackAt.slice(-5).join(', ')})` : ''}</li>
          <li>received-frame luminance: {fmtLums(s.lums)}</li>
          <li>
            avg frame {s.sizes?.length ? `${Math.round(s.sizes.reduce((a, b) => a + b, 0) / s.sizes.length / 1024)} KB` : '—'}
            {' '}· avg gap {s.gaps?.length ? `${Math.round(s.gaps.reduce((a, b) => a + b, 0) / s.gaps.length)} ms` : '—'}
            {' '}· max gap {s.gaps?.length ? `${Math.max(...s.gaps)} ms` : '—'}
          </li>
        </ul>
      )}
      <p style={{ margin: '4px 0 0' }}>Reproduce the glitch, then file a bug report — these counters ride along automatically.</p>
    </details>
  )
}
