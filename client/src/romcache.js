// BYO-ROM (ROM-clean mode) helpers. ROM bytes only ever exist in THIS
// browser — hashed locally to verify everyone plays the same game, and
// optionally cached in IndexedDB so runners pick the file once per device.
// Nothing here ever sends ROM content to the server.

export async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const DB_NAME = 'nuz-rom-cache'
const openDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1)
  req.onupgradeneeded = () => req.result.createObjectStore('roms')
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

// Keyed by the ROM's OWN sha256 — a mismatching file never poisons the
// lookup for the lobby's expected hash.
export async function cacheRom(sha256, name, bytes) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction('roms', 'readwrite')
      tx.objectStore('roms').put({ name, bytes, at: Date.now() }, sha256)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch { /* private mode / quota — play still works from memory this session */ }
}

export async function cachedRom(sha256) {
  if (!sha256) return null
  try {
    const db = await openDb()
    const entry = await new Promise((resolve, reject) => {
      const tx = db.transaction('roms', 'readonly')
      const q = tx.objectStore('roms').get(sha256)
      q.onsuccess = () => resolve(q.result || null)
      q.onerror = () => reject(q.error)
    })
    db.close()
    return entry
  } catch {
    return null
  }
}

export async function forgetCachedRom(sha256) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction('roms', 'readwrite')
      tx.objectStore('roms').delete(sha256)
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch { /* nothing cached */ }
}
