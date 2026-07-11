/**
 * Company/product-name discovery via Hacker News' Algolia search API —
 * complementary to the RSS feeds in sources.ts, not a replacement. Ported
 * verbatim from the old ainews-mod8 app's ingestion/hnDiscovery.ts — plain
 * fetch() calls to a public JSON API, no Node built-ins, no Workers concerns.
 *
 * Every hit's `url` is the actual linked page — the company's own post — not
 * a Hacker News discussion page, so it flows through the same ingest path as
 * any RSS entry.
 */
import type { FeedEntry } from "./feedParser.js";
import { cleanText } from "./normalize.js";

const ALGOLIA_SEARCH_URL = "https://hn.algolia.com/api/v1/search_by_date";
const MAX_AGE_DAYS = 3;

/** AI company/product names worth searching for on HN — not a feed URL, a discovery query. */
export const HN_DISCOVERY_QUERIES = [
  "OpenAI",
  "Anthropic",
  "DeepMind",
  "Mistral AI",
  "Hugging Face",
  "DeepSeek",
  "xAI",
  "Meta AI",
  "NVIDIA AI",
  "LLM release",
];

interface AlgoliaHit {
  title: string | null;
  url: string | null;
  created_at: string | null;
}

async function searchOneQuery(query: string): Promise<FeedEntry[]> {
  const url = `${ALGOLIA_SEARCH_URL}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=30`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const body = (await res.json()) as { hits?: AlgoliaHit[] };
    const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;

    return (body.hits ?? [])
      .filter((h): h is AlgoliaHit & { title: string; url: string; created_at: string } => !!h.title && !!h.url && !!h.created_at)
      .filter((h) => !h.title.startsWith("Show HN:") && !h.title.startsWith("Ask HN:"))
      .filter((h) => new Date(h.created_at).getTime() >= cutoff)
      .map((h) => ({
        title: cleanText(h.title),
        link: h.url,
        // Deliberately empty, not a copy of the title — HN Algolia hits carry
        // no real article description. Leaving this falsy lets pipeline.ts's
        // enrichFromArticlePage() fetch the linked page's actual OG/JSON-LD
        // description (or body-text excerpt) instead of the LLM/fallback
        // chain ever operating on "summary" that's secretly just the title.
        summary: "",
        publishedRaw: h.created_at,
      }));
  } catch {
    return [];
  }
}

/**
 * Runs every discovery query in parallel and flattens/dedupes hits by link.
 * `limit`, if given, keeps only the most recent N hits (by publishedRaw) —
 * see ingestHackerNewsDiscovery() in pipeline.ts for why this cap exists.
 */
export async function discoverFromHackerNews(queries: string[] = HN_DISCOVERY_QUERIES, limit?: number): Promise<FeedEntry[]> {
  const perQuery = await Promise.all(queries.map(searchOneQuery));
  const byLink = new Map<string, FeedEntry>();
  for (const entries of perQuery) {
    for (const entry of entries) {
      if (!byLink.has(entry.link)) byLink.set(entry.link, entry);
    }
  }

  const all = Array.from(byLink.values());
  all.sort((a, b) => {
    const at = a.publishedRaw ? new Date(a.publishedRaw).getTime() : 0;
    const bt = b.publishedRaw ? new Date(b.publishedRaw).getTime() : 0;
    return bt - at;
  });

  return typeof limit === "number" ? all.slice(0, limit) : all;
}
