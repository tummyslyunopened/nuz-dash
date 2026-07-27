// Ring buffer of recent errors/warnings for bug reports. Installed once at boot.
import { memberToken } from './api.js'

const buffer = []
const push = (type, parts) => {
  buffer.push({
    type,
    at: new Date().toISOString(),
    msg: parts.map((p) => {
      try { return typeof p === 'string' ? p : JSON.stringify(p) } catch { return String(p) }
    }).join(' ').slice(0, 600)
  })
  if (buffer.length > 60) buffer.shift()
}

export function installDiagnostics() {
  const origError = console.error.bind(console)
  console.error = (...a) => { push('console.error', a); origError(...a) }
  const origWarn = console.warn.bind(console)
  console.warn = (...a) => { push('console.warn', a); origWarn(...a) }
  window.addEventListener('error', (e) => push('window.error', [`${e.message} @ ${e.filename}:${e.lineno}`]))
  window.addEventListener('unhandledrejection', (e) => push('unhandledrejection', [String(e.reason)]))
}

const redact = (s) => (memberToken ? s.split(memberToken).join('<member-token>') : s)

export function collectDiagnostics() {
  return {
    url: redact(window.location.pathname),
    // Which build the reporter is actually running — stale phone tabs on old
    // bundles are a real failure mode (see the Clefairy incident)
    bundle: document.querySelector('script[src*="assets/index-"]')?.getAttribute('src') || 'unknown',
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    clientTime: new Date().toISOString(),
    online: navigator.onLine,
    emulator: {
      running: !!window.EJS_emulator?.gameManager,
      core: window.EJS_core || null,
      gameName: window.EJS_gameName || null
    },
    // Watch-party pipeline counters, both directions (black-frame forensics)
    stream: {
      broadcast: window.__nuzStreamStats || null,
      viewing: window.__nuzViewStats || null
    },
    recentLogs: buffer.map((e) => ({ ...e, msg: redact(e.msg) }))
  }
}
