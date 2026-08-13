import express, { type Express, type Request, type Response, type NextFunction } from 'express'
import { loadServerEnv, isLoopbackEquivalent } from './config/env'
import { createTosRouter } from './routes/tos'
import { createTosVerifyRouter } from './routes/tosVerify'
import { createAssetRouter } from './routes/asset'
import { createAssetVerifyRouter } from './routes/assetVerify'
import { createLocalApiRouter } from './routes/localApi'
import { createArkProxy } from './routes/arkProxy'
import { createSpaFallbackRouter } from './routes/spaFallback'

export function createApp(): Express {
  const app = express()
  const env = loadServerEnv()
  app.use(express.json({ limit: '10mb' }))

  // Origin guard for credential-handling and proxy routes. If the request
  // carries an Origin header it must match PLATFORM_ORIGIN; requests with no
  // Origin (server-side scripts, tests) are allowed through. This blocks a
  // malicious page on another origin from coercing the local server into
  // signing requests or proxying downloads even if the user has the server
  // bound to a network-reachable interface.
  //
  // In development we additionally accept the loopback-equivalent of
  // PLATFORM_ORIGIN (`localhost` ↔ `127.0.0.1` on the same scheme+port) so
  // a user who opens the dev URL via either spelling doesn't hit 403s.
  // Production stays strict — only PLATFORM_ORIGIN is accepted.
  const originGuard = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin
    if (!origin) return next()
    if (origin === env.platformOrigin) return next()
    if (env.nodeEnv === 'development' && isLoopbackEquivalent(origin, env.platformOrigin)) {
      return next()
    }
    res.status(403).json({ error: 'Origin not allowed' })
  }
  app.use('/local-api', originGuard)
  app.use('/api', originGuard)

  // More-specific routes must be registered first so they win
  app.use('/local-api/tos/verify', createTosVerifyRouter())
  app.use('/local-api/tos', createTosRouter())
  app.use('/local-api/asset/verify', createAssetVerifyRouter())
  app.use('/local-api/asset', createAssetRouter())
  app.use('/local-api', createLocalApiRouter())
  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.use('/api', createArkProxy())
  // SPA fallback — must remain the last app.use() call so API routes win
  app.use(createSpaFallbackRouter())
  return app
}
