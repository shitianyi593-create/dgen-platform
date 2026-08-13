import express, { Router } from 'express'
import path from 'node:path'
import fs from 'node:fs'

export function createSpaFallbackRouter(): Router {
  const router = Router()
  const distDir = process.env.DIST_DIR
    ? path.resolve(process.env.DIST_DIR)
    : path.resolve(process.cwd(), 'dist')

  if (!fs.existsSync(distDir)) {
    router.use((_req, res, next) => {
      if (process.env.NODE_ENV === 'production') {
        res.status(500).send('dist/ missing — run npm run build first')
      } else {
        next()
      }
    })
    return router
  }

  router.use(express.static(distDir, { index: false, dotfiles: 'allow' }))
  // Express 5 rejects bare '*' as a path; use a regex to match every GET that
  // didn't match a static asset above, so the SPA renders client-side routes.
  router.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'), { dotfiles: 'allow' })
  })
  return router
}
