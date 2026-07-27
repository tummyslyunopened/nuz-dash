import React, { useState } from 'react'
import { QrCode, X, Smartphone } from 'lucide-react'
import QRCode from 'qrcode'
import { api, memberToken } from '../api.js'

// "Play on phone": QR encoding this run's URL (via the public tunnel/host when
// available). The QR contains the member's SECRET link by design — that's what
// makes the phone land signed-in — so the modal says exactly that. (The URL
// bar shows a decoy /s/ path, so the real token comes from api state.)
export default function QrLaunchButton({ runId }) {
  const [open, setOpen] = useState(false)
  const [img, setImg] = useState(null)
  const [urlText, setUrlText] = useState('')
  const [reachable, setReachable] = useState(true)
  const [error, setError] = useState('')

  const show = async () => {
    setOpen(true)
    setError('')
    setImg(null)
    try {
      let origin = window.location.origin
      try {
        const me = await api.get('/api/me')
        if (me.publicUrl) origin = me.publicUrl
      } catch { /* fall back to current origin */ }
      setReachable(!/^https?:\/\/(localhost|127\.0\.0\.1)/.test(origin))
      const url = `${origin}/m/${memberToken}/run/${runId}`
      setUrlText(url)
      setImg(await QRCode.toDataURL(url, { width: 260, margin: 1 }))
    } catch (err) {
      setError(`QR generation failed: ${err.message}`)
    }
  }

  return (
    <>
      <button className="chip" onClick={show} title="Scan with your phone to play there">
        <QrCode size={13} /> Play on phone
      </button>
      {open && (
        <div className="qr-overlay" onClick={() => setOpen(false)}>
          <div className="qr-modal panel" onClick={(e) => e.stopPropagation()}>
            <button className="tour-close" onClick={() => setOpen(false)}><X size={16} /></button>
            <h2><span className="h2-title"><Smartphone size={14} /> Play on your phone</span></h2>
            {error && <p className="error-note">{error}</p>}
            {img && (
              <div className="qr-body">
                <img src={img} alt="QR code for this run" />
                <p className="map-tip" style={{ wordBreak: 'break-all' }}>{urlText}</p>
                {!reachable && (
                  <p className="warn-note">
                    No public address — this QR points at localhost, which your phone can't reach.
                    Start the tunnel from the admin dashboard first.
                  </p>
                )}
                <p className="map-tip">
                  Scan with your phone camera and you're in — signed in, same run, emulator fullscreen.
                  ⚠ The QR contains your secret link: only scan it yourself, and don't show it on stream.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
