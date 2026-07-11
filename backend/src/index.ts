import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import type { R2Bucket, ScheduledController, ExecutionContext } from '@cloudflare/workers-types'
import newsRouter from './modules/news/news.routes.js'
import ingestionRouter from './modules/ingestion/ingestion.routes.js'
import logosRouter from './modules/ingestion/logos.routes.js'
import { runIngestion } from './modules/ingestion/ingestion.service.js'
import type { IngestionContext } from './modules/ingestion/pipeline.js'

type Bindings = {
  DATABASE_URL: string
  GEMINI_API_KEY: string
  GROQ_API_KEY: string
  LOGO_BUCKET: R2Bucket
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())
app.route('/api/news', newsRouter)
app.route('/api/ingestion', ingestionRouter)
app.route('/logos/publishers', logosRouter)

function getPrisma(c: any) {
  const adapter = new PrismaNeon({ connectionString: c.env.DATABASE_URL })
  return new PrismaClient({ adapter })
}

app.get('/health', async (c) => {
  try {
    const prisma = getPrisma(c)
    await prisma.$queryRaw`SELECT 1`
    return c.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() })
  } catch (error) {
    console.error('Database connection failed:', error)
    return c.json({ status: 'error', db: 'disconnected', timestamp: new Date().toISOString() }, 500)
  }
})

export default {
  fetch: app.fetch,

  // Real Cron Trigger entry point (see wrangler.toml's [triggers] — every
  // 12 hours). Wrapped in ctx.waitUntil() so the invocation stays alive for
  // the full run, up to Cloudflare's confirmed 15-minute wall-clock ceiling
  // per invocation (see ingestion.service.ts / pipeline.ts for how the
  // pipeline stays within that).
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    const adapter = new PrismaNeon({ connectionString: env.DATABASE_URL })
    const prisma = new PrismaClient({ adapter })
    const ingestionCtx: IngestionContext = {
      prisma,
      llmKeys: { geminiKey: env.GEMINI_API_KEY, groqKey: env.GROQ_API_KEY },
      bucket: env.LOGO_BUCKET,
    }

    ctx.waitUntil(
      runIngestion(ingestionCtx)
        .then((summary) => {
          console.log(`[cron] ingestion complete: created=${summary.totalCreated} pruned=${summary.pruned}`)
        })
        .catch((err) => {
          console.error('[cron] ingestion failed:', err)
        })
    )
  },
}
