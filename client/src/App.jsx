import React from 'react'
import { Routes, Route, useParams, useLocation, Navigate } from 'react-router-dom'
import { setMemberToken, tokenForSid, sidForToken } from './api.js'
import Landing from './pages/Landing.jsx'
import JoinPage from './pages/JoinPage.jsx'
import LobbyHome from './pages/LobbyHome.jsx'
import RunPage from './pages/RunPage.jsx'
import SpectatorPage from './pages/SpectatorPage.jsx'
import BugReportButton from './components/BugReportButton.jsx'

// Entry point: the real secret arrives at /m/<token> (bookmark, invite flow,
// QR scan). It is immediately swapped for a decoy /s/<sid> URL so streams and
// screenshots never show the credential. Deep links keep their sub-path.
function TokenEntry() {
  const { token } = useParams()
  const location = useLocation()
  const rest = location.pathname.replace(/^\/m\/[^/]+/, '')
  return <Navigate to={`/s/${sidForToken(token)}${rest}`} replace />
}

// Resolves the decoy sid back to the member token (this browser only) and
// sets it before children render, so every API call is authenticated. A sid
// from another device resolves to nothing → back to the landing page.
function MemberScope({ children }) {
  const { sid } = useParams()
  const token = tokenForSid(sid)
  if (!token) return <Navigate to="/" replace />
  setMemberToken(token)
  return (
    <>
      {children}
      <BugReportButton />
    </>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/join/:invite" element={<JoinPage />} />
      <Route path="/m/:token" element={<TokenEntry />} />
      <Route path="/m/:token/run/:id" element={<TokenEntry />} />
      <Route path="/m/:token/view/:memberId" element={<TokenEntry />} />
      <Route path="/s/:sid" element={<MemberScope><LobbyHome /></MemberScope>} />
      <Route path="/s/:sid/run/:id" element={<MemberScope><RunPage /></MemberScope>} />
      <Route path="/s/:sid/view/:memberId" element={<MemberScope><SpectatorPage /></MemberScope>} />
    </Routes>
  )
}
