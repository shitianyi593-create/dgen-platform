import { Router } from 'express'
import {
  AssetUpstreamError,
  ROUTE_TO_ACTION,
  createAssetHandlers,
  type AssetHandlers,
  type AssetPluginConfig,
} from '../signers/asset'

export function createAssetRouter(): Router {
  const router = Router()
  const handlers: AssetHandlers = createAssetHandlers(null)

  // Express 5 rejects bare '*' as a path; use a regex to match every path
  // under the mount prefix.
  router.post(/.*/, async (req, res, next) => {
    // req.path is e.g. "/list" or "/group/list" — strip leading slash
    const route = req.path.replace(/^\//, '')
    if (!(route in ROUTE_TO_ACTION)) {
      return res.status(404).json({
        error: {
          message: `Unknown asset route: ${route}`,
          knownRoutes: Object.keys(ROUTE_TO_ACTION),
        },
      })
    }
    try {
      const rawBody = (req.body ?? {}) as Record<string, unknown>
      // Extract creds — nested under `creds` key, scrubbed from the body
      // forwarded as the action's payload.
      const { creds, ...payload } = rawBody as { creds?: AssetPluginConfig } & Record<string, unknown>
      if (!creds) {
        return res.status(400).json({ error: { message: 'creds required' } })
      }
      const out = await handlers.dispatch(route, payload, creds)
      return res.status(200).json(out)
    } catch (err) {
      if (err instanceof AssetUpstreamError) {
        return res.status(err.status).json({
          error: { code: err.code, message: err.message, requestId: err.requestId },
        })
      }
      return next(err)
    }
  })

  return router
}
