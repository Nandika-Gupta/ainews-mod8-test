import { PrismaClient } from "@prisma/client";
import type { News, Publisher, Topic } from "@prisma/client";
import { GENERIC_TOPIC_FALLBACK, COMPANY_TOPIC_LABELS } from "./news.constants.js";
import type { NewsArticleDTO, NewsCategory, NewsFilterChip, NewsSource } from "./news.types.js";

type ArticleRow = News & { publisher: Publisher; topics: Topic[] };

const ARTICLE_INCLUDE = { publisher: true, topics: true } as const;

const DYNAMIC_CHIP_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_DYNAMIC_CHIPS = 5;

/** Logs how long each query takes — shows up in `wrangler tail`, same reason the old app logged it in Vercel's function logs (see /news's multi-second loads). */
async function withTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    console.log(`[timing] ${label}: ${Date.now() - start}ms`);
  }
}

function labelizeCategory(key: string): string {
  const known: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    meta: "Meta",
    microsoft: "Microsoft",
    research: "Research",
    robotics: "Robotics",
    agents: "Agents",
    funding: "Funding",
    opensource: "Open Source",
  };
  return known[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

export class NewsService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /** Ranks by net votes (desc) and assigns a stable 0-100 trending score, same formula as the old app. */
  private withTrendingScores(rows: ArticleRow[]): NewsArticleDTO[] {
    const ranked = [...rows].sort((x, y) => y.upvotes - y.downvotes - (x.upvotes - x.downvotes));
    const scoreById = new Map<string, number>();
    const n = ranked.length;
    ranked.forEach((a, i) => {
      scoreById.set(a.id, n > 1 ? Math.round(97 - (i * (97 - 68)) / (n - 1)) : 97);
    });

    return rows.map((a) => ({
      id: a.slug,
      headline: a.title,
      dek: a.dek,
      aiSummary: a.aiSummary,
      articleUrl: a.articleUrl,
      category: a.category,
      topics: a.topics.map((t) => t.name),
      source: a.publisherId,
      hours: Math.max(0, Math.floor((Date.now() - a.publishedAt.getTime()) / 3_600_000)),
      up: a.upvotes,
      down: a.downvotes,
      filters: a.filterTags,
      score: scoreById.get(a.id) ?? 0,
    }));
  }

  /** Full unfiltered/unpaginated list, newest first — the listing page filters/sorts/paginates client-side, same as the old app. */
  async getArticles(): Promise<NewsArticleDTO[]> {
    const rows = await withTiming("getArticles db query", () =>
      this.prisma.news.findMany({
        include: ARTICLE_INCLUDE,
        orderBy: { publishedAt: "desc" },
      })
    );
    return this.withTrendingScores(rows);
  }

  async getArticleBySlug(slug: string): Promise<NewsArticleDTO | null> {
    const row = await withTiming(`getArticleBySlug(${slug}) db query`, () =>
      this.prisma.news.findUnique({ where: { slug }, include: ARTICLE_INCLUDE })
    );
    if (!row) return null;
    return this.withTrendingScores([row])[0];
  }

  async getRelatedArticles(article: NewsArticleDTO, limit = 4): Promise<NewsArticleDTO[]> {
    const rows = await this.prisma.news.findMany({
      where: {
        slug: { not: article.id },
        OR: [{ category: article.category }, { topics: { some: { name: { in: article.topics } } } }],
      },
      include: ARTICLE_INCLUDE,
      orderBy: { publishedAt: "desc" },
      take: limit,
    });

    if (rows.length > 0) return this.withTrendingScores(rows);

    // Fallback: no category/topic overlap found — just show recent stories.
    const fallbackRows = await this.prisma.news.findMany({
      where: { slug: { not: article.id } },
      include: ARTICLE_INCLUDE,
      orderBy: { publishedAt: "desc" },
      take: limit,
    });
    return this.withTrendingScores(fallbackRows);
  }

  /** Sources map keyed by Publisher id, matching NewsArticleDTO.source — the shape every component already expects. */
  async getSourcesMap(): Promise<Record<string, NewsSource>> {
    const publishers = await withTiming("getSourcesMap db query", () => this.prisma.publisher.findMany());
    return Object.fromEntries(
      publishers.map((p) => [
        p.id,
        { name: p.name, domain: p.domain, color: p.colorHex ?? "#8B8FA3", followers: p.followersLabel ?? "", logoUrl: p.logoUrl },
      ])
    );
  }

  async getCategories(): Promise<NewsCategory[]> {
    const grouped = await withTiming("getCategories db query", () =>
      this.prisma.news.groupBy({ by: ["category"], _count: { category: true } })
    );
    return grouped
      .sort((a, b) => b._count.category - a._count.category)
      .map((g) => ({ key: g.category, label: labelizeCategory(g.category), count: g._count.category }));
  }

  /**
   * "All News" and "Trending" are fixed positions; everything after is derived
   * from real topic volume in the last 48h. Excludes the generic "AI"
   * catch-all and single-company topics (OpenAI/Anthropic/...) — naming one
   * company in a filter chip on a general AI aggregator reads as favoritism.
   */
  async getFilterChips(): Promise<NewsFilterChip[]> {
    const since = new Date(Date.now() - DYNAMIC_CHIP_WINDOW_MS);
    const rows = await withTiming(
      "getFilterChips db query",
      () => this.prisma.$queryRaw<{ name: string; count: bigint }[]>`
        SELECT t.name, count(*) as count
        FROM "Topic" t
        JOIN "_NewsToTopic" nt ON t.id = nt."B"
        JOIN "News" a ON a.id = nt."A"
        WHERE a."publishedAt" >= ${since}
        GROUP BY t.name
        ORDER BY count(*) DESC
      `
    );

    const dynamicChips: NewsFilterChip[] = rows
      .filter((r) => r.name !== GENERIC_TOPIC_FALLBACK && !COMPANY_TOPIC_LABELS.has(r.name))
      .slice(0, MAX_DYNAMIC_CHIPS)
      .map((r) => ({ id: r.name, label: r.name }));

    return [{ id: "all", label: "All News" }, { id: "trending", label: "Trending" }, ...dynamicChips];
  }

  /** Top 5 publishers by article count — a real popularity signal instead of a hardcoded list. */
  async getPopularSources(): Promise<string[]> {
    const publishers = await this.prisma.publisher.findMany({
      include: { _count: { select: { articles: true } } },
      orderBy: { articles: { _count: "desc" } },
      take: 5,
    });
    return publishers.map((p) => p.id);
  }

  /**
   * The public NewsArticleDTO.id is the article's SLUG (see withTrendingScores),
   * not its real database id — so vote/bookmark/comment writes, which foreign-key
   * against News.id, need this to resolve slug -> real id first.
   */
  async getArticleIdBySlug(slug: string): Promise<string | null> {
    const row = await this.prisma.news.findUnique({ where: { slug }, select: { id: true } });
    return row?.id ?? null;
  }

  /**
   * Toggles the clientId's vote: clicking the same direction again removes it
   * (matches the old app's local-toggle UX), clicking the other direction
   * switches it. Recomputes News.upvotes/downvotes from the NewsVote rows
   * after every change, same "aggregate recomputed from source rows" pattern
   * used elsewhere in this stack (see AiOrbit's recomputeToolRating).
   */
  async setVote(articleId: string, clientId: string, value: 1 | -1) {
    const existing = await this.prisma.newsVote.findUnique({
      where: { articleId_clientId: { articleId, clientId } },
    });

    let myVote: 1 | -1 | null;
    if (existing && existing.value === value) {
      await this.prisma.newsVote.delete({ where: { id: existing.id } });
      myVote = null;
    } else {
      await this.prisma.newsVote.upsert({
        where: { articleId_clientId: { articleId, clientId } },
        update: { value },
        create: { articleId, clientId, value },
      });
      myVote = value;
    }

    const [upvotes, downvotes] = await Promise.all([
      this.prisma.newsVote.count({ where: { articleId, value: 1 } }),
      this.prisma.newsVote.count({ where: { articleId, value: -1 } }),
    ]);
    await this.prisma.news.update({ where: { id: articleId }, data: { upvotes, downvotes } });

    return { upvotes, downvotes, myVote };
  }

  async addBookmark(articleId: string, clientId: string): Promise<{ bookmarked: true }> {
    await this.prisma.newsBookmark.upsert({
      where: { articleId_clientId: { articleId, clientId } },
      update: {},
      create: { articleId, clientId },
    });
    return { bookmarked: true };
  }

  async removeBookmark(articleId: string, clientId: string): Promise<{ bookmarked: false }> {
    await this.prisma.newsBookmark.deleteMany({ where: { articleId, clientId } });
    return { bookmarked: false };
  }

  async addComment(articleId: string, clientId: string, authorName: string | undefined, body: string) {
    const comment = await this.prisma.newsComment.create({
      data: {
        articleId,
        clientId,
        body,
        ...(authorName ? { authorName } : {}),
      },
    });
    return { id: comment.id, authorName: comment.authorName, body: comment.body, createdAt: comment.createdAt.toISOString() };
  }

  /** Newest first, matching the old (session-only) comment box's display order. Never exposes clientId — that's the anonymous poster's own identifier, not public. */
  async getComments(articleId: string) {
    const rows = await this.prisma.newsComment.findMany({
      where: { articleId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((c) => ({ id: c.id, authorName: c.authorName, body: c.body, createdAt: c.createdAt.toISOString() }));
  }
}
