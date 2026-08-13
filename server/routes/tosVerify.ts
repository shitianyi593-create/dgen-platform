import { Router, type Request, type Response } from 'express'
import { TosClient } from '@volcengine/tos-sdk'
import type { CORSRule } from '@volcengine/tos-sdk/dist/methods/bucket/cors'
import { randomUUID } from 'node:crypto'
import { loadServerEnv } from '../config/env'
import { mergeCorsRules } from '../signers/tosCors'
import { createTosHandlers, type TosClientLike, type TosPluginConfig } from '../signers/tos'
import { deriveEndpoint } from './tos'

const REQUIRED = ['accessKeyId', 'accessKeySecret', 'region', 'bucket'] as const

interface UserTosCreds {
  accessKeyId: string
  accessKeySecret: string
  region: string
  endpoint?: string
  bucket: string
}

/**
 * BytePlus TOS GetBucketCORS throws when the bucket has no CORS configured
 * yet (fresh bucket). Match both the canonical SDK error code and the raw
 * message so we can recover into "no rules — let's write a fresh set".
 */
function isNoCorsConfiguredError(message: string): boolean {
  return /cors configuration does not exist|nosuchcors/i.test(message)
}

function validate(input: unknown): UserTosCreds | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'creds object required' }
  const c = input as Record<string, unknown>
  for (const k of REQUIRED) {
    if (typeof c[k] !== 'string' || !c[k]) return { error: `creds.${k} required` }
  }
  if (c.endpoint !== undefined && typeof c.endpoint !== 'string') {
    return { error: 'creds.endpoint must be a string when provided' }
  }
  return c as unknown as UserTosCreds
}

export function createTosVerifyRouter(): Router {
  const router = Router()
  const env = loadServerEnv()

  router.post('/', async (req: Request, res: Response) => {
    const validated = validate((req.body as { creds?: unknown })?.creds)
    if ('error' in validated) {
      return res.status(400).json({ error: validated.error })
    }
    const creds = validated
    // Delegate endpoint derivation to the shared helper used by sign-put / sign-get.
    const effectiveEndpoint = deriveEndpoint(creds.region, creds.endpoint)
    const steps: Record<string, string> = {}

    const client = new TosClient({
      accessKeyId: creds.accessKeyId,
      accessKeySecret: creds.accessKeySecret,
      region: creds.region,
      endpoint: effectiveEndpoint,
    }) as unknown as {
      // headBucket takes a bare bucket name string (not an input object) per
      // @volcengine/tos-sdk v2; the other bucket-level methods take objects.
      headBucket(bucket: string): Promise<unknown>
      getBucketCORS(input: { bucket: string }): Promise<{ data?: { CORSRules: CORSRule[] } }>
      putBucketCORS(input: { bucket: string; CORSRules: CORSRule[] }): Promise<unknown>
      deleteObject(input: { bucket: string; key: string }): Promise<unknown>
      getPreSignedUrl(input: { method: 'GET' | 'PUT'; bucket: string; key: string; expires: number }): string
    }

    // Step 1: HeadBucket — verifies credentials and bucket existence
    try {
      await client.headBucket(creds.bucket)
      steps.headBucket = 'ok'
    } catch (e) {
      return res.json({
        ok: false,
        failingStep: 'headBucket',
        message: e instanceof Error ? e.message : 'HeadBucket failed',
      })
    }

    // Step 2: CORS merge — idempotently ensure our platform origin is present.
    // A fresh bucket throws 'The CORS configuration does not exist' from
    // getBucketCORS; treat that as "no rules yet" and proceed to PUT a fresh
    // set rather than surfacing it as a verify failure.
    let existing: CORSRule[] = []
    try {
      existing = (await client.getBucketCORS({ bucket: creds.bucket })).data?.CORSRules ?? []
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (!isNoCorsConfiguredError(msg)) {
        return res.json({
          ok: false,
          failingStep: 'cors',
          steps,
          message: msg || 'CORS step failed',
        })
      }
      // existing stays [] — proceed to compose + PUT a fresh set
    }
    try {
      const merge = mergeCorsRules(existing, env.platformOrigin)
      if (merge.didChange) {
        await client.putBucketCORS({ bucket: creds.bucket, CORSRules: merge.rules })
        steps.cors = 'written'
      } else {
        steps.cors = 'already-configured'
      }
    } catch (e) {
      return res.json({
        ok: false,
        failingStep: 'cors',
        steps,
        message: e instanceof Error ? e.message : 'CORS step failed',
      })
    }

    // Step 3: 1-byte round-trip — confirm pre-signed PUT + GET work end-to-end
    const probeFilename = `_probe/${randomUUID()}.txt`
    try {
      const tosCfg: TosPluginConfig = {
        accessKeyId: creds.accessKeyId,
        accessKeySecret: creds.accessKeySecret,
        region: creds.region,
        endpoint: effectiveEndpoint,
        bucket: creds.bucket,
        keyPrefix: '',
        defaultGetTtlSeconds: 60,
      }
      const handlers = createTosHandlers(null, null)
      // D1 fix: capture actualKey from putResult (buildObjectKey transforms the filename)
      const putResult = handlers.signPut(
        { filename: probeFilename },
        { config: tosCfg, client: client as unknown as TosClientLike },
      )
      const putUrl = putResult.url
      const actualKey = putResult.key

      const putRes = await fetch(putUrl, { method: 'PUT', body: 'x' })
      if (!putRes.ok) throw new Error(`PUT failed: ${putRes.status}`)

      const getResult = handlers.signGet(
        { key: actualKey },
        { config: tosCfg, client: client as unknown as TosClientLike },
      )
      const getUrl = getResult.url
      const getRes = await fetch(getUrl)
      if (!getRes.ok) throw new Error(`GET failed: ${getRes.status}`)

      // Best-effort cleanup — ignore failure
      await client.deleteObject({ bucket: creds.bucket, key: actualKey }).catch(() => {})
      steps.roundTrip = 'ok'
    } catch (e) {
      return res.json({
        ok: false,
        failingStep: 'roundTrip',
        steps,
        message: e instanceof Error ? e.message : 'Round-trip failed',
      })
    }

    return res.json({ ok: true, steps })
  })

  return router
}
