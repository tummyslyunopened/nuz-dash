import React from 'react'
import { Routes, Route, useParams } from 'react-router-dom'
import { setMemberToken } from './api.js'
import Landing from './pages/Landing.jsx'
import JoinPage from './pages/JoinPage.jsx'
import LobbyHome from './pages/LobbyHome.jsx'
import RunPage from './pages/RunPage.jsx'
import SpectatorPage from './pages/SpectatorPage.jsx'
import BugReportButton from './components/BugReportButton.jsx'

// Sets the member token (from the /m/<token> URL) before children render,
// so every API call in the subtree is authenticated.
function MemberScope({ children }) {
  const { token } = useParams()
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
      <Route path="/m/:token" element={<MemberScope><LobbyHome /></MemberScope>} />
      <Route path="/m/:token/run/:id" element={<MemberScope><RunPage /></MemberScope>} />
      <Route path="/m/:token/view/:memberId" element={<MemberScope><SpectatorPage /></MemberScope>} />
    </Routes>
  )
}
