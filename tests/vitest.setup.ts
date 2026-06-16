import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'

// Load .env.local from the repo root before any test module runs.
loadEnv({ path: resolve(__dirname, '..', '.env.local') })
