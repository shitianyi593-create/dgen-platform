import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware'
import type { RequestHandler } from 'express'
import { ARK_INFERENCE_BASE_URL } from '../../src/api/arkConstants'

export function createArkProxy(): RequestHandler {
  return createProxyMiddleware({
    target: ARK_INFERENCE_BASE_URL,
    changeOrigin: true,
    secure: true,
    // Express's app.use('/api', ...) strips the '/api' mount prefix from
    // req.url before the middleware sees it. Without this rewrite the upstream
    // URL becomes https://ark.ap-southeast.bytepluses.com/v3/... (missing the
    // /api segment that ARK requires), which yields 404 from ARK on
    // authenticated requests. Restore the prefix.
    pathRewrite: { '^/': '/api/' },
    // express.json() upstream of this middleware has already consumed the
    // request body stream; without re-emitting the parsed body the proxied
    // request hangs (Content-Length set but no bytes follow). fixRequestBody
    // re-stringifies req.body and writes it onto proxyReq.
    on: {
      proxyReq: fixRequestBody,
    },
  }) as RequestHandler
}
