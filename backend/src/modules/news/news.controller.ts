import { Context } from "hono";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { NewsService } from "./news.services.js";
import type { NewsSlugParamInput } from "./news.schemas.js";

function getService(c: Context) {
  const adapter = new PrismaNeon({ connectionString: c.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  return new NewsService(prisma);
}

export class NewsController {
  /** GET /api/news — bundles the full article list plus everything the listing page's client-side filter/sort/search/pagination needs. */
  static async getListing(c: Context) {
    try {
      const service = getService(c);
      const [articles, sources, categories, filterChips] = await Promise.all([
        service.getArticles(),
        service.getSourcesMap(),
        service.getCategories(),
        service.getFilterChips(),
      ]);
      return c.json({ articles, sources, categories, filterChips });
    } catch (error: any) {
      console.error("News listing error:", error);
      return c.json({ error: "Internal server error." }, 500);
    }
  }

  /** GET /api/news/:slug — a single article plus related stories, sources, and popular sources for the sidebar. */
  static async getDetail(c: Context) {
    try {
      const { slug } = c.req.valid("param" as never) as unknown as NewsSlugParamInput;
      const service = getService(c);

      const article = await service.getArticleBySlug(slug);
      if (!article) {
        return c.json({ error: "Article not found" }, 404);
      }

      const [related, sources, popularSources] = await Promise.all([
        service.getRelatedArticles(article),
        service.getSourcesMap(),
        service.getPopularSources(),
      ]);

      return c.json({ article, related, sources, popularSources });
    } catch (error: any) {
      console.error("News detail error:", error);
      return c.json({ error: "Internal server error." }, 500);
    }
  }
}
