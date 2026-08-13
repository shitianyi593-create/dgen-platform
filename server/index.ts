import { createApp } from './app'
import { loadServerEnv } from './config/env'

const env = loadServerEnv()
const app = createApp()
app.listen(env.port, env.bindHost, () => {
  console.log(`[server] listening on http://${env.bindHost}:${env.port} (${env.nodeEnv})`)
})
