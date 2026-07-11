import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import newsRouter from './modules/news/news.routes.js'
import ingestionRouter from './modules/ingestion/ingestion.routes.js'

type Bindings = {
  DATABASE_URL: string
  GEMINI_API_KEY: string
  GROQ_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())
app.route('/api/news', newsRouter)
app.route('/api/ingestion', ingestionRouter)

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

export default app
