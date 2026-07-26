// Deploys site/ to Cloudflare Pages (project: nuzdash).
//   node scripts/deploy-site.mjs            -> production (nuzdash.dev)
//   node scripts/deploy-site.mjs --preview  -> preview deployment (safe to test)
//
// Requires wrangler on PATH, logged in (`wrangler login`). On Windows ARM64
// use wrangler v2 installed with --ignore-scripts (see README).
import { spawnSync } from 'child_process'

const preview = process.argv.includes('--preview')
const args = ['pages', 'publish', 'site', '--project-name', 'nuzdash', '--commit-dirty=true']
if (preview) args.push('--branch', 'preview')

const res = spawnSync(process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler', args, {
  stdio: 'inherit',
  env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || 'b1c66c197dba7d75232fd69f3632a2e1' },
  shell: process.platform === 'win32'
})
process.exit(res.status ?? 1)
