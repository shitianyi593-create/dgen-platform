import { loadDotenv } from '../../scripts/loadDotenv'

loadDotenv()

export interface ServerEnv {
  port: number
  bindHost: string
  nodeEnv: 'development' | 'production' | 'test'
  platformOrigin: string
}

/**
 * True iff `a` and `b` are the same origin modulo `localhost` ↔ `127.0.0.1`
 * substitution. Used by the dev-mode origin guard so the user can open the
 * dev URL via either spelling without hitting 403s. Production stays strict.
 */
export function isLoopbackEquivalent(a: string, b: string): boolean {
  let ua: URL, ub: URL
  try {
    ua = new URL(a)
    ub = new URL(b)
  } catch {
    return false
  }
  if (ua.protocol !== ub.protocol || ua.port !== ub.port) return false
  const loopback = new Set(['localhost', '127.0.0.1'])
  return loopback.has(ua.hostname) && loopback.has(ub.hostname)
}

const ALLOWED_NODE_ENVS = ['development', 'production', 'test'] as const

export function loadServerEnv(): ServerEnv {
  const port = Number(process.env.PORT ?? 3000)
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT env: ${process.env.PORT}`)
  }
  const rawNodeEnv = process.env.NODE_ENV ?? 'development'
  if (!ALLOWED_NODE_ENVS.includes(rawNodeEnv as typeof ALLOWED_NODE_ENVS[number])) {
    throw new Error(`Invalid NODE_ENV env: ${rawNodeEnv}`)
  }
  const nodeEnv = rawNodeEnv as ServerEnv['nodeEnv']
  const platformOrigin = process.env.PLATFORM_ORIGIN ?? 'http://localhost:5173'
  if (!/^https?:\/\//.test(platformOrigin)) {
    throw new Error(`PLATFORM_ORIGIN must start with http:// or https://, got: ${platformOrigin}`)
  }
  // Default to loopback so the local-api (which signs requests with user-supplied
  // AKSK and proxies downloads) is not reachable from other machines on the LAN.
  // Override only when intentionally exposing the server (e.g. behind a reverse proxy).
  const bindHost = process.env.BIND_HOST ?? '127.0.0.1'
  return { port, bindHost, nodeEnv, platformOrigin }
}
