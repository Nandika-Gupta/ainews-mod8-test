import { Context } from "hono";
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { FEED_SOURCES } from "./sources.js";
import type { IngestionContext } from "./pipeline.js";
import { runIngestion } from "./ingestion.service.js";
import type { IngestionRunQueryInput } from "./ingestion.schemas.js";

export class IngestionController {
  /**
   * POST /api/ingestion/run — manually-triggered ingestion, standing
   * alongside the real Cron Trigger (see scheduled() in index.ts) for
   * on-demand runs and verification. Shares runIngestion() with the Cron
   * path so the two can't drift apart on caps/limits.
   */
  static async run(c: Context) {
    try {
      const query = c.req.valid("query" as never) as unknown as IngestionRunQueryInput;
      const adapter = new PrismaNeon({ connectionString: c.env.DATABASE_URL });
      const prisma = new PrismaClient({ adapter });
      const ctx: IngestionContext = {
        prisma,
        llmKeys: { geminiKey: c.env.GEMINI_API_KEY, groqKey: c.env.GROQ_API_KEY },
        bucket: c.env.LOGO_BUCKET,
      };

      const requestedNames = query.sources?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const selectedSources = requestedNames?.length
        ? FEED_SOURCES.filter((s) => requestedNames.includes(s.name.toLowerCase()))
        : undefined;

      const summary = await runIngestion(ctx, {
        sources: selectedSources,
        limit: query.limit,
        includeHackerNews: query.includeHackerNews === "true",
        prune: query.prune !== "false",
        keep: query.keep,
      });

      return c.json(summary);
    } catch (error: any) {
      console.error("Ingestion run error:", error);
      return c.json({ error: error.message }, 500);
    }
  }
}
