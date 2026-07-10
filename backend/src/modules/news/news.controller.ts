import { Context } from "hono";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { NewsService } from "./news.services.js";
import type {
  NewsSlugParamInput,
  NewsVoteBodyInput,
  NewsBookmarkBodyInput,
  NewsBookmarkQueryInput,
  NewsCommentBodyInput,
} from "./news.schemas.js";

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
      const articleId = await service.getArticleIdBySlug(slug);

      const [related, sources, popularSources, comments] = await Promise.all([
        service.getRelatedArticles(article),
        service.getSourcesMap(),
        service.getPopularSources(),
        articleId ? service.getComments(articleId) : Promise.resolve([]),
      ]);

      return c.json({ article, related, sources, popularSources, comments });
    } catch (error: any) {
      console.error("News detail error:", error);
      return c.json({ error: "Internal server error." }, 500);
    }
  }

  /** POST /api/news/:slug/vote — clientId-keyed upvote/downvote; clicking the same direction again removes it. */
  static async postVote(c: Context) {
    try {
      const { slug } = c.req.valid("param" as never) as unknown as NewsSlugParamInput;
      const { clientId, value } = c.req.valid("json" as never) as unknown as NewsVoteBodyInput;
      const service = getService(c);

      const articleId = await service.getArticleIdBySlug(slug);
      if (!articleId) {
        return c.json({ error: "Article not found" }, 404);
      }

      const result = await service.setVote(articleId, clientId, value);
      return c.json(result);
    } catch (error: any) {
      console.error("News vote error:", error);
      return c.json({ error: "Internal server error." }, 500);
    }
  }

  /** POST /api/news/:slug/bookmark — clientId-keyed save. */
  static async postBookmark(c: Context) {
    try {
      const { slug } = c.req.valid("param" as never) as unknown as NewsSlugParamInput;
      const { clientId } = c.req.valid("json" as never) as unknown as NewsBookmarkBodyInput;
      const service = getService(c);

      const articleId = await service.getArticleIdBySlug(slug);
      if (!articleId) {
        return c.json({ error: "Article not found" }, 404);
      }

      const result = await service.addBookmark(articleId, clientId);
      return c.json(result);
    } catch (error: any) {
      console.error("News bookmark create error:", error);
      return c.json({ error: "Internal server error." }, 500);
    }
  }

  /** DELETE /api/news/:slug/bookmark?clientId=... — removes the clientId's save. */
  static async deleteBookmark(c: Context) {
    try {
      const { slug } = c.req.valid("param" as never) as unknown as NewsSlugParamInput;
      const { clientId } = c.req.valid("query" as never) as unknown as NewsBookmarkQueryInput;
      const service = getService(c);

      const articleId = await service.getArticleIdBySlug(slug);
      if (!articleId) {
        return c.json({ error: "Article not found" }, 404);
      }

      const result = await service.removeBookmark(articleId, clientId);
      return c.json(result);
    } catch (error: any) {
      console.error("News bookmark delete error:", error);
      return c.json({ error: "Internal server error." }, 500);
    }
  }

  /** POST /api/news/:slug/comments — real persistence, replacing the old session-only comment box. */
  static async postComment(c: Context) {
    try {
      const { slug } = c.req.valid("param" as never) as unknown as NewsSlugParamInput;
      const { clientId, authorName, body } = c.req.valid("json" as never) as unknown as NewsCommentBodyInput;
      const service = getService(c);

      const articleId = await service.getArticleIdBySlug(slug);
      if (!articleId) {
        return c.json({ error: "Article not found" }, 404);
      }

      const comment = await service.addComment(articleId, clientId, authorName, body);
      return c.json({ comment }, 201);
    } catch (error: any) {
      console.error("News comment create error:", error);
      return c.json({ error: "Internal server error." }, 500);
    }
  }
}
