/**
 * Orchestrator: fetch a feed -> parse entries -> normalize -> resolve
 * publisher -> upsert News, deduplicated by canonical articleUrl (and,
 * within a single run, by fuzzy title match across publishers — see
 * RecentTitleIndex below). Ported from the old ainews-mod8 app's
 * ingestion/pipeline.ts, adapted to this stack's models (NewsArticle ->
 * News, Vote -> NewsVote, Bookmark -> NewsBookmark) and to a Prisma client
 * + LLM keys that are created per-request (see IngestionContext) instead of
 * imported as module-level singletons.
 */
import type { PrismaClient } from "@prisma/client";
import { parseFeed, type FeedEntry } from "./feedParser.js";
import { normalizeUrl, domainFromUrl, robustParseDate, slugify, cleanText, titleTokens, titleSimilarity } from "./normalize.js";
import { resolvePublisher } from "./publisherRegistry.js";
import { deriveTopics, isAiRelevant } from "./topicTagging.js";
import { extractArticleMetadata } from "./metadataExtractor.js";
import { discoverFromHackerNews } from "./hnDiscovery.js";
import { generateAiSummary, type SummarizerKeys } from "./llmSummarizer.js";
import type { FeedSource } from "./sources.js";

export interface IngestionContext {
  prisma: PrismaClient;
  llmKeys: SummarizerKeys;
}

const THIN_SUMMARY_WORD_THRESHOLD = 40;

/**
 * Shared with any future backfill script, which would treat any row stuck
 * on this exact string as a candidate to retry — this only happens when
 * both the LLM waterfall AND enrichment came up empty for an entry, which
 * is usually a transient site/network failure at that specific moment
 * rather than a permanent one.
 */
export const NO_SUMMARY_PLACEHOLDER = "No summary available for this article.";

/** True for an empty description, or one too short to support a genuine multi-sentence LLM summary. */
function isThinSummary(summary: string): boolean {
  const words = summary.trim().split(/\s+/).filter(Boolean);
  return words.length < THIN_SUMMARY_WORD_THRESHOLD;
}

async function enrichFromArticlePage(articleUrl: string): Promise<{ publishedAt: Date | null; description: string | null; bodyExcerpt: string | null }> {
  try {
    const res = await fetch(articleUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { publishedAt: null, description: null, bodyExcerpt: null };
    const html = await res.text();
    const meta = extractArticleMetadata(html);
    return {
      publishedAt: robustParseDate(meta.datePublished),
      description: meta.description,
      bodyExcerpt: meta.bodyExcerpt,
    };
  } catch {
    return { publishedAt: null, description: null, bodyExcerpt: null };
  }
}

export interface PipelineResult {
  source: string;
  fetched: number;
  created: number;
  skippedDuplicate: number;
  skippedNearDuplicate: number;
  skippedNotAiRelevant: number;
  skippedInvalid: number;
  /** Entry reached summarization but no real content was ever found (no RSS description, no scrapeable body, LLM waterfall exhausted) — never created rather than stored with a placeholder summary. See NO_SUMMARY_PLACEHOLDER. */
  skippedNoContent: number;
  errors: string[];
}

/**
 * In-memory index of recently-published titles (last 48h), used to catch
 * the same story reported by two different publishers under different
 * headlines and URLs — exact-articleUrl dedup alone misses this once
 * multiple overlapping feeds are in play. Shared across a whole ingestAll()
 * run (including concurrent sources) so cross-source duplicates within a
 * single run are caught too, not just duplicates against DB history.
 */
export interface RecentTitleIndex {
  tokensByTitle: { title: string; tokens: Set<string> }[];
}

const NEAR_DUPLICATE_THRESHOLD = 0.6;
const RECENT_TITLE_WINDOW_MS = 48 * 60 * 60 * 1000;

export async function loadRecentTitleIndex(prisma: PrismaClient): Promise<RecentTitleIndex> {
  const rows = await prisma.news.findMany({
    where: { publishedAt: { gte: new Date(Date.now() - RECENT_TITLE_WINDOW_MS) } },
    select: { title: true },
    take: 1000,
  });
  return { tokensByTitle: rows.map((r) => ({ title: r.title, tokens: titleTokens(r.title) })) };
}

function isNearDuplicateTitle(index: RecentTitleIndex, title: string): boolean {
  const tokens = titleTokens(title);
  return index.tokensByTitle.some((entry) => titleSimilarity(tokens, entry.tokens) >= NEAR_DUPLICATE_THRESHOLD);
}

function recordTitle(index: RecentTitleIndex, title: string): void {
  index.tokensByTitle.push({ title, tokens: titleTokens(title) });
}

async function uniqueSlug(prisma: PrismaClient, base: string): Promise<string> {
  const slug = slugify(base);
  const existing = await prisma.news.findUnique({ where: { slug } });
  if (!existing) return slug;
  // Collision (two different articles produced the same slug) — suffix with
  // a short piece of the current time so it stays stable enough to dedupe on
  // articleUrl while still being unique.
  return `${slug}-${Date.now().toString(36).slice(-5)}`;
}

/**
 * Domains that are never a valid news source regardless of which feed or
 * discovery mechanism surfaced them — a video/social-post URL isn't a
 * published article, even when Hacker News discovery (see hnDiscovery.ts)
 * surfaces one as a "story" link.
 */
const BLOCKED_DOMAINS = new Set(["youtube.com"]);

interface ValidatedEntry {
  entry: FeedEntry;
  articleUrl: string;
  domain: string;
  title: string;
  summaryRaw: string;
  publishedAtRaw: Date | null;
  nameHint: string | null;
}

interface PreparedEntry {
  entry: FeedEntry;
  articleUrl: string;
  domain: string;
  title: string;
  summary: string;
  bodyExcerpt: string | null;
  publishedAt: Date;
  nameHint: string | null;
}

type ValidateOutcome = { kind: "validated"; data: ValidatedEntry } | { kind: "duplicate" | "near-duplicate" | "not-relevant" | "invalid" };

/**
 * Fast, sequential-safe checks only — validation and exact-URL/near-
 * duplicate-title dedup. Must stay sequential (entry N's checks complete
 * before entry N+1's) so two entries can't race on the near-duplicate-title
 * index. Deliberately does NOT fetch the article page — that's the slow
 * part (see enrichValidated() below), safe to run concurrently since it
 * touches no shared/DB state, unlike these checks.
 */
async function validateEntry(
  prisma: PrismaClient,
  entry: FeedEntry,
  source: FeedSource,
  titleIndex: RecentTitleIndex,
  seenInBatch: Set<string>
): Promise<ValidateOutcome> {
  const articleUrl = normalizeUrl(entry.link);
  if (!articleUrl) return { kind: "invalid" };
  if (seenInBatch.has(articleUrl)) return { kind: "duplicate" };

  const domain = domainFromUrl(articleUrl);
  if (!domain) return { kind: "invalid" };
  if (BLOCKED_DOMAINS.has(domain)) return { kind: "invalid" };

  if (!source.aiOnly && !isAiRelevant(entry.title, entry.summary)) {
    return { kind: "not-relevant" };
  }

  const existing = await prisma.news.findUnique({ where: { articleUrl } });
  if (existing) return { kind: "duplicate" };

  const title = cleanText(entry.title);
  if (isNearDuplicateTitle(titleIndex, title)) return { kind: "near-duplicate" };

  // "discovery" sources (e.g. Hacker News — see hnDiscovery.ts) link to
  // arbitrary other sites, so their own `name` describes the discovery
  // mechanism, not the linked publisher — never use it as a name hint. Real
  // feed sources link back to their own site, so `name` is a safe hint for
  // a newly-discovered domain.
  const nameHint = source.kind === "discovery" ? null : source.name;

  seenInBatch.add(articleUrl);
  recordTitle(titleIndex, title);

  return {
    kind: "validated",
    data: { entry, articleUrl, domain, title, summaryRaw: entry.summary, publishedAtRaw: robustParseDate(entry.publishedRaw), nameHint },
  };
}

/**
 * The other slow part (alongside the LLM call) — fetching the article page
 * for real content. Run concurrently across many validated entries (see
 * ENRICH_CONCURRENCY below); safe because, unlike validateEntry(), this
 * touches no shared/DB state — it only reads network responses and returns
 * data, nothing here can race with another entry's enrichment.
 */
async function enrichValidated(v: ValidatedEntry): Promise<PreparedEntry> {
  let publishedAt = v.publishedAtRaw;
  let summary = v.summaryRaw;
  let bodyExcerpt: string | null = null;
  // Trigger real-content enrichment not just when the description is
  // missing, but when it's too thin to support a genuine 4-5 sentence
  // summary (e.g. a single-clause RSS blurb) — otherwise the LLM has
  // nothing to work with beyond a sentence fragment and, correctly
  // instructed not to invent facts, produces an accurate but too-short
  // summary. A word-count threshold is a cheap, good-enough proxy for
  // "is there enough real material here."
  if (!publishedAt || isThinSummary(summary)) {
    const enriched = await enrichFromArticlePage(v.articleUrl);
    publishedAt = publishedAt ?? enriched.publishedAt ?? new Date();
    if (!summary && enriched.description) summary = enriched.description;
    bodyExcerpt = enriched.bodyExcerpt;
  }

  return {
    entry: v.entry,
    articleUrl: v.articleUrl,
    domain: v.domain,
    title: v.title,
    summary,
    bodyExcerpt,
    publishedAt: publishedAt ?? new Date(),
    nameHint: v.nameHint,
  };
}

/**
 * The slow part — a real LLM call — run concurrently across many prepared
 * entries (see SUMMARY_CONCURRENCY below). Fallback chain: LLM summary ->
 * raw RSS/OG description -> article body excerpt -> a plainly-labeled "no
 * summary" string. The title is NEVER used as a stand-in summary — feeding a
 * title-only "description" to the LLM invites it to hallucinate
 * plausible-sounding but unverified details, so the LLM is only called when
 * there's real source text that isn't just the headline again.
 */
// Hard wall-clock ceiling on the LLM-summarization phase, separate from and
// in addition to llmSummarizer.ts's per-tier rate-limit gates. Those gates
// correctly pace *how fast* any one provider gets hit, but say nothing about
// *how long the whole run takes*. Ported unchanged from the old app for now;
// this number was tuned against GitHub Actions' 20-minute job budget and
// will need revisiting once this runs on a real Cloudflare Cron Trigger
// (see the earlier discussion — Workers' wall-clock ceiling per invocation
// is almost certainly tighter, but the real number depends on plan tier and
// hasn't been confirmed yet). Not touched in this step since ingestion is
// only being run manually right now, not on a schedule.
const PIPELINE_STARTED_AT = Date.now();
const SUMMARIZATION_BUDGET_MS = 7 * 60_000;

function withinSummarizationBudget(): boolean {
  return Date.now() - PIPELINE_STARTED_AT < SUMMARIZATION_BUDGET_MS;
}

async function summarizePrepared(p: PreparedEntry, llmKeys: SummarizerKeys): Promise<string> {
  const realContent = (p.bodyExcerpt || p.summary || "").trim();
  const hasRealContent = realContent.length > 0 && realContent !== p.title.trim();
  const llmSummary = hasRealContent && withinSummarizationBudget() ? await generateAiSummary(p.title, realContent, llmKeys) : null;
  return llmSummary || p.summary || p.bodyExcerpt || NO_SUMMARY_PLACEHOLDER;
}

/** Sequential DB write, in original entry order — the only phase that touches Publisher/slug/create, so no race risk even though phase 2 (summarization) ran concurrently. */
async function finalizePrepared(prisma: PrismaClient, p: PreparedEntry, aiSummary: string, source: FeedSource): Promise<void> {
  const publisher = await resolvePublisher(prisma, p.domain, p.nameHint);
  const slug = await uniqueSlug(prisma, p.title);
  const topics = deriveTopics(p.entry.title, p.summary);
  const dek = p.summary || p.bodyExcerpt || NO_SUMMARY_PLACEHOLDER;

  await prisma.news.create({
    data: {
      slug,
      title: p.title,
      dek,
      aiSummary,
      articleUrl: p.articleUrl,
      publisherId: publisher.id,
      category: source.category,
      filterTags: [],
      publishedAt: p.publishedAt,
      topics: {
        connectOrCreate: topics.map((name) => ({ where: { name }, create: { name } })),
      },
    },
  });
}

function newPipelineResult(source: string): PipelineResult {
  return {
    source,
    fetched: 0,
    created: 0,
    skippedDuplicate: 0,
    skippedNearDuplicate: 0,
    skippedNotAiRelevant: 0,
    skippedInvalid: 0,
    skippedNoContent: 0,
    errors: [],
  };
}

const ENRICH_CONCURRENCY = 5;
const SUMMARY_CONCURRENCY = 4;

/**
 * Four phases per source: (1) sequential validation/dedup — the only phase
 * that must stay serial, so concurrent entries can't race on the
 * near-duplicate-title index; (2) concurrent article-page enrichment (fetch
 * real content for thin/missing descriptions); (3) concurrent LLM
 * summarization; (4) sequential DB writes, original order.
 */
async function ingestEntries(ctx: IngestionContext, entries: FeedEntry[], source: FeedSource, titleIndex: RecentTitleIndex): Promise<PipelineResult> {
  const { prisma, llmKeys } = ctx;
  const result = newPipelineResult(source.name);
  result.fetched = entries.length;
  const seenInBatch = new Set<string>();

  const validated: ValidatedEntry[] = [];
  for (const entry of entries) {
    try {
      const outcome = await validateEntry(prisma, entry, source, titleIndex, seenInBatch);
      if (outcome.kind === "validated") validated.push(outcome.data);
      else if (outcome.kind === "duplicate") result.skippedDuplicate++;
      else if (outcome.kind === "near-duplicate") result.skippedNearDuplicate++;
      else if (outcome.kind === "not-relevant") result.skippedNotAiRelevant++;
      else result.skippedInvalid++;
    } catch (err) {
      result.errors.push(`"${entry.title}": ${(err as Error).message}`);
    }
  }

  const prepared = await mapWithConcurrency(validated, ENRICH_CONCURRENCY, async (v) => {
    try {
      return await enrichValidated(v);
    } catch (err) {
      result.errors.push(`"${v.title}" (enrichment): ${(err as Error).message}`);
      return { entry: v.entry, articleUrl: v.articleUrl, domain: v.domain, title: v.title, summary: v.summaryRaw, bodyExcerpt: null, publishedAt: v.publishedAtRaw ?? new Date(), nameHint: v.nameHint };
    }
  });

  const summaries = await mapWithConcurrency(prepared, SUMMARY_CONCURRENCY, async (p) => {
    try {
      return await summarizePrepared(p, llmKeys);
    } catch (err) {
      result.errors.push(`"${p.title}" (summarization): ${(err as Error).message}`);
      return p.summary || p.bodyExcerpt || NO_SUMMARY_PLACEHOLDER;
    }
  });

  for (let i = 0; i < prepared.length; i++) {
    // No real content anywhere (no description, no scrapeable body, LLM
    // waterfall exhausted) — don't create a row that would just show a
    // placeholder instead of a real summary. Real content or nothing.
    if (summaries[i] === NO_SUMMARY_PLACEHOLDER) {
      result.skippedNoContent++;
      continue;
    }
    try {
      await finalizePrepared(prisma, prepared[i], summaries[i], source);
      result.created++;
    } catch (err) {
      result.errors.push(`"${prepared[i].title}": ${(err as Error).message}`);
    }
  }

  return result;
}

export async function ingestSource(ctx: IngestionContext, source: FeedSource, limit = 30, titleIndex?: RecentTitleIndex): Promise<PipelineResult> {
  const index = titleIndex ?? (await loadRecentTitleIndex(ctx.prisma));

  let entries: FeedEntry[];
  try {
    entries = await parseFeed(source.feedUrl, limit);
  } catch (err) {
    const result = newPipelineResult(source.name);
    result.errors.push(`feed fetch failed: ${(err as Error).message}`);
    return result;
  }

  return ingestEntries(ctx, entries, source, index);
}

/**
 * A synthetic "source" for Hacker-News-discovered entries — not a real feed
 * (feedUrl unused), just the display name/category/aiOnly-gate ingestEntry
 * needs. aiOnly is false because a query like "NVIDIA AI" can surface hits
 * with no real AI relevance, so every hit still passes through the same
 * isAiRelevant() gate a general RSS feed would.
 */
const HN_DISCOVERY_SOURCE: FeedSource = {
  name: "Hacker News Discovery",
  feedUrl: "",
  category: "research",
  aiOnly: false,
  kind: "discovery",
};

/** Discovers AI company announcements via Hacker News (see hnDiscovery.ts) and runs them through the same ingest path as an RSS source. */
export async function ingestHackerNewsDiscovery(ctx: IngestionContext, titleIndex?: RecentTitleIndex): Promise<PipelineResult> {
  const index = titleIndex ?? (await loadRecentTitleIndex(ctx.prisma));

  let entries: FeedEntry[];
  try {
    entries = await discoverFromHackerNews();
  } catch (err) {
    const result = newPipelineResult(HN_DISCOVERY_SOURCE.name);
    result.errors.push(`HN discovery failed: ${(err as Error).message}`);
    return result;
  }

  return ingestEntries(ctx, entries, HN_DISCOVERY_SOURCE, index);
}

/** Runs a bounded number of async jobs concurrently, sized conservatively so we don't hammer many independent publisher domains at once. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const SOURCE_CONCURRENCY = 4;

export async function ingestAll(ctx: IngestionContext, sources: FeedSource[], limit = 30, titleIndex?: RecentTitleIndex): Promise<PipelineResult[]> {
  const index = titleIndex ?? (await loadRecentTitleIndex(ctx.prisma));
  return mapWithConcurrency(sources, SOURCE_CONCURRENCY, (source) => ingestSource(ctx, source, limit, index));
}
