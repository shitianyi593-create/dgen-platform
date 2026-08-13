/**
 * Shared env loader used by the bootstrap script and the TOS Vite plugin.
 *
 * Loads in this order (later wins): `.env`, `.env.local`.
 * Files that don't exist are silently skipped.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import dotenv from 'dotenv'

const ENV_FILES = ['.env', '.env.local'] as const

export function loadDotenv(cwd: string = process.cwd()): string[] {
  const loaded: string[] = []
  for (const name of ENV_FILES) {
    const path = resolve(cwd, name)
    if (existsSync(path)) {
      dotenv.config({ path, override: true })
      loaded.push(name)
    }
  }
  return loaded
}
