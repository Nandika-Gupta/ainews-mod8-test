/**
 * Shared ingestion orchestration — everything a "run ingestion" trigger
 * needs to do, regardless of whether that trigger is the manual
 * POST /api/ingestion/run route or the real scheduled() Cron handler.
 * Keeping this in one place means the two entry points can't drift apart
 * on prune caps, HN discovery limits, or source selection.
 */
import { FEED_SOURCES, type FeedSource } from "./sources.js";
import { ingestAll, ingestHackerNewsDiscovery, loadRecentTitleIndex, type IngestionContext, type PipelineResult } from "./pipeline.js";
import { pruneToMostRecent } from "./prune.js";

/** Keep the 150 most recent articles — see prune.ts. */
export const MAX_LIVE_ARTICLES = 150;

/**
 * Caps HN discovery to the same per-run volume a single RSS source already
 * gets (see FeedSource/parseFeed's own `limit` convention) — HN discovery
 * previously had no analogous cap, which is fine against a generous
 * GitHub Actions budget but not against a hard 15-minute Cloudflare Cron
 * Trigger ceiling. See ingestHackerNewsDiscovery() in pipeline.ts.
 */
export const HN_DISCOVERY_LIMIT = 30;

export interface IngestionRunOptions {
  sources?: FeedSource[];
  limit?: number;
  includeHackerNews?: boolean;
  prune?: boolean;
  keep?: number;
}

export interface IngestionRunSummary {
  totalCreated: number;
  pruned: number;
  results: PipelineResult[];
}

export async function runIngestion(ctx: IngestionContext, options: IngestionRunOptions = {}): Promise<IngestionRunSummary> {
  const sources = options.sources ?? FEED_SOURCES;
  const limit = options.limit ?? 30;
  const includeHackerNews = options.includeHackerNews ?? true;
  const shouldPrune = options.prune ?? true;

  const titleIndex = await loadRecentTitleIndex(ctx.prisma);
  const [results, hnResult] = await Promise.all([
    ingestAll(ctx, sources, limit, titleIndex),
    includeHackerNews ? ingestHackerNewsDiscovery(ctx, titleIndex, HN_DISCOVERY_LIMIT) : Promise.resolve(null),
  ]);
  const allResults = hnResult ? [...results, hnResult] : results;

  const pruned = shouldPrune ? await pruneToMostRecent(ctx.prisma, options.keep ?? MAX_LIVE_ARTICLES) : 0;

  return {
    totalCreated: allResults.reduce((sum, r) => sum + r.created, 0),
    pruned,
    results: allResults,
  };
}
