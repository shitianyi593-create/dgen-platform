import { Router } from 'express'
import { TosClient } from '@volcengine/tos-sdk'
import {
  createTosHandlers,
  type TosClientLike,
  type TosPluginConfig,
  type SignPutInput,
  type SignGetInput,
} from '../signers/tos'

/**
 * Compute the TOS endpoint for a given region and optional caller-supplied value.
 * BytePlus pattern: `tos-{region}.bytepluses.com`.
 *
 * Exported so other route modules (e.g. tosVerify) can reuse the same formula
 * without duplicating the pattern string.
 */
export function deriveEndpoint(region: string, supplied?: string): string {
  if (supplied && supplied.trim()) return supplied
  const cleaned = (region ?? '').trim().toLowerCase()
  return cleaned ? `tos-${cleaned}.bytepluses.com` : ''
}

/**
 * Return a copy of `creds` with `endpoint` filled in when missing.
 * Delegates to `deriveEndpoint` so the BytePlus host pattern lives in one place.
 *
 * Defensive forward-compat: callers can keep sending an explicit `endpoint`
 * (e.g. for self-hosted gateways) and we'll honor it. Otherwise we fall back
 * to the region-derived host so the client doesn't need to spell it out.
 */
export function withDerivedEndpoint(creds: TosPluginConfig): TosPluginConfig {
  if (creds.endpoint && creds.endpoint.trim()) return creds
  const endpoint = deriveEndpoint(creds.region, creds.endpoint)
  if (!endpoint) return creds // let downstream throw — region is required
  return { ...creds, endpoint }
}

export function createTosRouter(): Router {
  const router = Router()
  const handlers = createTosHandlers(null, null)

  router.post('/sign-put', async (req, res, next) => {
    try {
      const { creds, ...payload } = (req.body ?? {}) as Record<string, unknown> & { creds?: TosPluginConfig }
      if (!creds) {
        return res.status(400).json({ error: 'creds required' })
      }
      const effectiveCreds = withDerivedEndpoint(creds)
      const userClient = new TosClient({
        accessKeyId: effectiveCreds.accessKeyId,
        accessKeySecret: effectiveCreds.accessKeySecret,
        region: effectiveCreds.region,
        endpoint: effectiveCreds.endpoint,
      }) as unknown as TosClientLike
      const override = { config: effectiveCreds, client: userClient }
      const out = await handlers.signPut(payload as unknown as SignPutInput, override)
      res.json(out)
    } catch (e) {
      next(e)
    }
  })

  router.post('/sign-get', async (req, res, next) => {
    try {
      const { creds, ...payload } = (req.body ?? {}) as Record<string, unknown> & { creds?: TosPluginConfig }
      if (!creds) {
        return res.status(400).json({ error: 'creds required' })
      }
      const effectiveCreds = withDerivedEndpoint(creds)
      const userClient = new TosClient({
        accessKeyId: effectiveCreds.accessKeyId,
        accessKeySecret: effectiveCreds.accessKeySecret,
        region: effectiveCreds.region,
        endpoint: effectiveCreds.endpoint,
      }) as unknown as TosClientLike
      const override = { config: effectiveCreds, client: userClient }
      const out = await handlers.signGet(payload as unknown as SignGetInput, override)
      res.json(out)
    } catch (e) {
      next(e)
    }
  })

  return router
}
