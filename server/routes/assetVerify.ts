import { Router } from 'express'
import {
  AssetUpstreamError,
  createAssetHandlers,
  type AssetPluginConfig,
} from '../signers/asset'

const REQUIRED: Array<keyof AssetPluginConfig> = [
  'accessKeyId', 'accessKeySecret', 'region', 'service', 'host', 'projectName',
]

function validateCreds(input: unknown): AssetPluginConfig | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'creds object required' }
  const c = input as Record<string, unknown>
  for (const key of REQUIRED) {
    if (typeof c[key] !== 'string' || !c[key]) return { error: `creds.${key} required` }
  }
  return c as unknown as AssetPluginConfig
}

export function createAssetVerifyRouter(): Router {
  const router = Router()
  // Module-level config not needed — every call carries its own.
  const handlers = createAssetHandlers(null)

  router.post('/', async (req, res, next) => {
    const validated = validateCreds((req.body as { creds?: unknown })?.creds)
    if ('error' in validated) {
      return res.status(400).json({ error: validated.error })
    }
    try {
      // ListAssetGroups with MaxResults=1 is the cheapest probe that exercises
      // signing + projectName scoping. The route table maps 'group/list' to
      // ListAssetGroups already.
      await handlers.dispatch('group/list', { MaxResults: 1 }, validated)
      return res.json({ ok: true, projectName: validated.projectName })
    } catch (err) {
      if (err instanceof AssetUpstreamError) {
        return res.json({
          ok: false,
          code: err.code,
          message: err.message,
          status: err.status,
          requestId: err.requestId,
        })
      }
      return next(err)
    }
  })

  return router
}
