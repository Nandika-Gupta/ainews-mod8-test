import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

type Bindings = {
  DATABASE_URL: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())

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

// Throwaway sanity-check route: proves Wrangler -> Hono -> Prisma -> Neon adapter -> DB
// all work end-to-end. Safe to delete once the migration is ported over.
app.get('/sanity', async (c) => {
  try {
    const prisma = getPrisma(c)
    const publisherCount = await prisma.publisher.count()
    return c.json({ status: 'ok', publisherCount })
  } catch (error: any) {
    console.error('Sanity check failed:', error)
    return c.json({ status: 'error', message: error.message }, 500)
  }
})

export default app
