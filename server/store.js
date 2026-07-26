import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// NUZ_DATA_DIR relocates all persistent data (cloud volumes, installers);
// defaults to server/data for local development.
export const dataDir = process.env.NUZ_DATA_DIR
  ? path.resolve(process.env.NUZ_DATA_DIR)
  : path.join(__dirname, 'data')
export const uploadsDir = path.join(dataDir, 'uploads')

fs.mkdirSync(uploadsDir, { recursive: true })

// One JSON file per collection; tiny single-user data, so synchronous
// atomic writes (tmp + rename) on every mutation are plenty.
export class Store {
  constructor(name, fallback) {
    this.file = path.join(dataDir, `${name}.json`)
    this.data = fallback
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      /* first run or corrupt file: start from fallback */
    }
  }

  save() {
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    fs.renameSync(tmp, this.file)
  }
}
