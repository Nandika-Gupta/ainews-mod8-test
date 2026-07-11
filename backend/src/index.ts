import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import newsRouter from './modules/news/news.routes.js'
import { generateAiSummary } from './modules/ingestion/llmSummarizer.js'

type Bindings = {
  DATABASE_URL: string
  GEMINI_API_KEY: string
  GROQ_API_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())
app.route('/api/news', newsRouter)

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

// Throwaway route to verify the ported LLM summarizer waterfall actually
// works end-to-end inside the Workers runtime (real fetch() calls to
// Gemini/Groq/Pollinations from within `wrangler dev`), before the real RSS
// ingestion pipeline exists to call it for real. Delete once that pipeline
// is wired up and calling generateAiSummary() itself.
const SUMMARIZER_TEST_SAMPLES = [
  {
    title: 'Anthropic releases Claude Opus 4.5 with major coding improvements',
    description:
      'Anthropic today announced Claude Opus 4.5, the latest addition to its Claude model family, with the company saying it delivers substantial gains on software engineering benchmarks compared to its predecessor. The model was trained with an emphasis on multi-step reasoning and long-context code editing, and Anthropic says early testers report meaningfully fewer errors on large refactoring tasks. The company is rolling out access gradually through its API and enterprise plans, with consumer access via Claude.ai following in the coming weeks. Pricing remains unchanged from the previous Opus tier. Anthropic also published a technical report detailing the model\'s safety evaluations, noting no significant new risk categories were identified during red-teaming.',
  },
  {
    title: 'AI infrastructure startup Modular raises $250M Series C',
    description:
      'Modular, the startup building a unified compute platform for AI workloads, announced a $250 million Series C funding round led by a group of institutional investors, valuing the company at over $2 billion. The company said the new capital will go toward expanding its engineering team and accelerating development of its Mojo programming language, which aims to combine Python\'s usability with the performance of lower-level languages for GPU and CPU workloads. Modular\'s founders previously worked on machine learning infrastructure at large tech companies before starting the company. The round brings Modular\'s total funding to date past $380 million.',
  },
]

app.get('/dev/test-summarizer', async (c) => {
  // ?tier=groq or ?tier=pollinations lets verification force a lower tier by
  // withholding the higher tiers' keys, instead of only ever exercising
  // whichever tier happens to succeed first.
  const forceTier = c.req.query('tier')
  const keys = {
    geminiKey: forceTier === 'groq' || forceTier === 'pollinations' ? undefined : c.env.GEMINI_API_KEY,
    groqKey: forceTier === 'pollinations' ? undefined : c.env.GROQ_API_KEY,
    debug: true,
  }
  try {
    const results = await Promise.all(
      SUMMARIZER_TEST_SAMPLES.map(async (sample) => ({
        title: sample.title,
        summary: await generateAiSummary(sample.title, sample.description, keys),
      }))
    )
    return c.json({ results })
  } catch (error: any) {
    console.error('Summarizer test failed:', error)
    return c.json({ error: error.message }, 500)
  }
})

export default app
