import { Context } from "hono";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { FEED_SOURCES } from "./sources.js";
import { ingestAll, ingestHackerNewsDiscovery, loadRecentTitleIndex, type IngestionContext } from "./pipeline.js";
import { pruneToMostRecent } from "./prune.js";
import type { IngestionRunQueryInput } from "./ingestion.schemas.js";

const MAX_LIVE_ARTICLES = 150;

export class IngestionController {
  /**
   * POST /api/ingestion/run — manually-triggered ingestion, standing in for
   * a Cloudflare Cron Trigger until that's wired up separately. Runs the
   * requested (or all) RSS sources, optionally Hacker News discovery, and
   * prunes down to MAX_LIVE_ARTICLES afterward.
   */
  static async run(c: Context) {
    try {
      const query = c.req.valid("query" as never) as unknown as IngestionRunQueryInput;
      const adapter = new PrismaNeon({ connectionString: c.env.DATABASE_URL });
      const prisma = new PrismaClient({ adapter });
      const ctx: IngestionContext = {
        prisma,
        llmKeys: { geminiKey: c.env.GEMINI_API_KEY, groqKey: c.env.GROQ_API_KEY },
      };

      const requestedNames = query.sources?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const selectedSources = requestedNames?.length
        ? FEED_SOURCES.filter((s) => requestedNames.includes(s.name.toLowerCase()))
        : FEED_SOURCES;

      const titleIndex = await loadRecentTitleIndex(prisma);
      const [results, hnResult] = await Promise.all([
        ingestAll(ctx, selectedSources, query.limit, titleIndex),
        query.includeHackerNews === "true" ? ingestHackerNewsDiscovery(ctx, titleIndex) : Promise.resolve(null),
      ]);
      const allResults = hnResult ? [...results, hnResult] : results;

      const pruned = query.prune === "false" ? 0 : await pruneToMostRecent(prisma, query.keep ?? MAX_LIVE_ARTICLES);

      const totalCreated = allResults.reduce((sum, r) => sum + r.created, 0);
      return c.json({ totalCreated, pruned, results: allResults });
    } catch (error: any) {
      console.error("Ingestion run error:", error);
      return c.json({ error: error.message }, 500);
    }
  }
}
