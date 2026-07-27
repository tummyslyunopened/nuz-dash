import React, { useEffect, useRef, useState } from 'react'
import { MessageCircle, Send } from 'lucide-react'
import { api } from '../api.js'

const timeShort = (iso) => {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString()
}

// Lobby group chat: simple 3s polling, capped server-side. The lobby is the
// hangout — this is where the trash talk lives.
export default function ChatPanel({ meId }) {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const scrollRef = useRef(null)
  const stickBottomRef = useRef(true)

  const load = () => api.get('/api/lobby/chat').then((msgs) => {
    setMessages((prev) => {
      if (prev.length === msgs.length && prev[prev.length - 1]?.id === msgs[msgs.length - 1]?.id) return prev
      return msgs
    })
  }).catch(() => {})

  useEffect(() => {
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])

  // Stay pinned to the newest message unless the reader scrolled up
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  const send = async (e) => {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setText('')
    try {
      const msg = await api.post('/api/lobby/chat', { text: body })
      stickBottomRef.current = true
      setMessages((m) => (m.some((x) => x.id === msg.id) ? m : [...m, msg]))
      setError('')
    } catch (err) {
      setError(err.message)
      setText(body) // don't eat the message on failure
    }
  }

  return (
    <div className="panel chat-panel">
      <h2><span className="h2-title"><MessageCircle size={14} /> Lobby chat</span></h2>
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <p className="empty-note">Nothing yet — say hi 👋</p>
        ) : messages.map((m) => (
          <div className={`chat-msg ${m.memberId === meId ? 'mine' : ''}`} key={m.id}>
            <span className="chat-who">{m.memberId === meId ? 'you' : m.name}</span>
            <span className="chat-text">{m.text}</span>
            <span className="chat-when">{timeShort(m.at)}</span>
          </div>
        ))}
      </div>
      {error && <p className="error-note">{error}</p>}
      <form className="chat-input" onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message the lobby…"
          maxLength={500}
        />
        <button className="primary" type="submit" disabled={!text.trim()}><Send size={14} /></button>
      </form>
    </div>
  )
}
