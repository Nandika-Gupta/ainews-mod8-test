// Throwaway seed script — just enough varied data (multiple publishers,
// categories, company vs. theme topics, articles inside/outside the 48h
// filter-chip window, differing vote counts) to exercise every branch of the
// ported news.services.ts logic. Not the real content pipeline — that's the
// RSS ingestion module (ported separately). Safe to delete once ingestion is
// wired up and producing real rows.
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

function hoursAgo(h) {
  return new Date(Date.now() - h * 60 * 60 * 1000)
}

async function main() {
  const techcrunch = await prisma.publisher.upsert({
    where: { domain: 'techcrunch.com' },
    update: {},
    create: { name: 'TechCrunch', domain: 'techcrunch.com', website: 'https://techcrunch.com', colorHex: '#0ABF53', followersLabel: '2.1M' },
  })
  const theVerge = await prisma.publisher.upsert({
    where: { domain: 'theverge.com' },
    update: {},
    create: { name: 'The Verge', domain: 'theverge.com', website: 'https://theverge.com', colorHex: '#5200FF', followersLabel: '1.4M' },
  })
  const wired = await prisma.publisher.upsert({
    where: { domain: 'wired.com' },
    update: {},
    create: { name: 'Wired', domain: 'wired.com', website: 'https://wired.com', colorHex: '#000000', followersLabel: '890K' },
  })

  const articles = [
    {
      slug: 'openai-gpt6-launch', title: 'OpenAI launches GPT-6', dek: 'A new flagship model.',
      aiSummary: 'OpenAI announced GPT-6 with major reasoning improvements.',
      articleUrl: 'https://techcrunch.com/openai-gpt6-launch', publisherId: techcrunch.id,
      category: 'openai', filterTags: ['research'], topics: ['OpenAI', 'Model Release'],
      publishedAt: hoursAgo(2), upvotes: 48, downvotes: 0,
    },
    {
      slug: 'humanoid-robot-demo', title: 'Startup demos humanoid robot', dek: 'Walks and folds laundry.',
      aiSummary: 'A robotics startup showed off a new humanoid robot prototype.',
      articleUrl: 'https://theverge.com/humanoid-robot-demo', publisherId: theVerge.id,
      category: 'robotics', filterTags: [], topics: ['Robotics'],
      publishedAt: hoursAgo(10), upvotes: 90, downvotes: 1,
    },
    {
      slug: 'ai-startup-raises-100m', title: 'AI startup raises $100M Series C', dek: 'Valuation triples.',
      aiSummary: 'An AI infrastructure startup closed a $100M round.',
      articleUrl: 'https://wired.com/ai-startup-raises-100m', publisherId: wired.id,
      category: 'funding', filterTags: ['funding'], topics: ['Funding'],
      publishedAt: hoursAgo(30), upvotes: 20, downvotes: 1,
    },
    {
      slug: 'anthropic-claude-update', title: 'Anthropic ships Claude update', dek: 'Faster, cheaper inference.',
      aiSummary: 'Anthropic released an update to Claude focused on latency.',
      articleUrl: 'https://techcrunch.com/anthropic-claude-update', publisherId: techcrunch.id,
      category: 'anthropic', filterTags: [], topics: ['Anthropic', 'Model Release'],
      publishedAt: hoursAgo(40), upvotes: 15, downvotes: 0,
    },
    {
      slug: 'research-paper-breakthrough', title: 'New paper on transformer efficiency', dek: 'Fewer FLOPs, same accuracy.',
      aiSummary: 'Researchers published a paper on more efficient transformer training.',
      articleUrl: 'https://wired.com/research-paper-breakthrough', publisherId: wired.id,
      category: 'research', filterTags: ['research'], topics: ['AI'],
      publishedAt: hoursAgo(72), upvotes: 5, downvotes: 3,
    },
    {
      slug: 'old-news-item', title: 'An older AI story', dek: 'From a while back.',
      aiSummary: 'Just an older story used to test date ordering.',
      articleUrl: 'https://theverge.com/old-news-item', publisherId: theVerge.id,
      category: 'research', filterTags: [], topics: ['AI'],
      publishedAt: hoursAgo(200), upvotes: 1, downvotes: 0,
    },
  ]

  for (const a of articles) {
    const { topics, ...rest } = a
    await prisma.news.upsert({
      where: { slug: a.slug },
      update: {},
      create: {
        ...rest,
        topics: { connectOrCreate: topics.map((name) => ({ where: { name }, create: { name } })) },
      },
    })
  }

  console.log(`Seeded 3 publishers and ${articles.length} articles.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
