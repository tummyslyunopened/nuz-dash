import React from 'react'

// The Nuz-Dash mark: a purple pokeball. Used for brand links (nuzdash.dev)
// — matches the icon on the onboarding site.
export default function PokeballIcon({ size = 14, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" style={style} aria-hidden="true">
      <defs>
        <linearGradient id="nuzball-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14.5" fill="#0c0a12" />
      <path d="M2.5 16a13.5 13.5 0 0 1 27 0z" fill="url(#nuzball-top)" />
      <path d="M2.5 16a13.5 13.5 0 0 0 27 0z" fill="#ece7fb" />
      <rect x="2.5" y="14.6" width="27" height="2.8" fill="#0c0a12" />
      <circle cx="16" cy="16" r="5.2" fill="#0c0a12" />
      <circle cx="16" cy="16" r="3.4" fill="#ece7fb" />
      <circle cx="16" cy="16" r="1.7" fill="#8b5cf6" />
      <ellipse cx="11" cy="8.6" rx="3.4" ry="1.9" fill="#fff" opacity="0.35" transform="rotate(-24 11 8.6)" />
    </svg>
  )
}
