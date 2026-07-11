import { z } from "zod";

export const ingestionRunQuerySchema = z.object({
  /** Comma-separated FeedSource names (case-insensitive) to restrict the run to. Omit to run every source in FEED_SOURCES. */
  sources: z.string().optional(),
  /** Entries fetched per source. Capped at 30 to match the old app's own per-source limit. */
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.max(1, Math.min(30, parseInt(v, 10) || 5)) : 5)),
  /** "true" to also run Hacker News discovery alongside the RSS sources. */
  includeHackerNews: z.string().optional(),
  /** "false" to skip the post-run prune (useful for isolating ingestion behavior during verification). */
  prune: z.string().optional(),
  /** Overrides the prune cap for this run only (default 150 — see MAX_LIVE_ARTICLES). Mainly for verifying prune behavior against a small test dataset. */
  keep: z
    .string()
    .optional()
    .transform((v) => (v ? Math.max(0, parseInt(v, 10) || 0) : undefined)),
});

export type IngestionRunQueryInput = z.infer<typeof ingestionRunQuerySchema>;
