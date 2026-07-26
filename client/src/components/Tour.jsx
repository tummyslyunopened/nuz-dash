import React, { useEffect, useState } from 'react'
import { X } from 'lucide-react'

// Lightweight spotlight tour: dims the page, highlights the current step's
// target element (found by CSS selector), and shows a card beside it.
// Steps without a selector render as centered cards. Missing targets are
// skipped gracefully.
const CARD_W = 340
const CARD_H = 210 // estimate for placement decisions

export default function Tour({ steps, onClose }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const step = steps[i]

  useEffect(() => {
    if (!step.selector) { setRect(null); return }
    const el = document.querySelector(step.selector)
    if (!el) { setRect(null); return }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const update = () => {
      const e2 = document.querySelector(step.selector)
      setRect(e2 ? e2.getBoundingClientRect() : null)
    }
    update()
    const t = setTimeout(update, 420) // after smooth scroll settles
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [i, step.selector])

  const next = () => (i < steps.length - 1 ? setI(i + 1) : onClose())
  const back = () => i > 0 && setI(i - 1)

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      if (e.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }) // re-bind every render so next/back close over current index

  const cardStyle = {}
  if (rect) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const fitsBelow = rect.bottom + 12 + CARD_H < vh
    cardStyle.top = fitsBelow ? rect.bottom + 12 : Math.max(12, rect.top - CARD_H - 12)
    cardStyle.left = Math.max(12, Math.min(rect.left, vw - CARD_W - 12))
  }

  return (
    <div className="tour-overlay">
      {rect ? (
        <div
          className="tour-highlight"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div className={`tour-card ${rect ? '' : 'centered'}`} style={rect ? cardStyle : undefined}>
        <button className="tour-close" onClick={onClose} title="Skip tour"><X size={16} /></button>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-foot">
          <span className="tour-progress">{i + 1} / {steps.length}</span>
          {i > 0 && <button className="small" onClick={back}>Back</button>}
          <button className="small primary" onClick={next}>{i < steps.length - 1 ? 'Next' : 'Done'}</button>
        </div>
      </div>
    </div>
  )
}
