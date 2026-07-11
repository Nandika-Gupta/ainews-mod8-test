/**
 * RSS/Atom feed parsing. Ported from the old ainews-mod8 app's
 * ingestion/feedParser.ts, using `rss-parser` for the actual RSS/Atom/date
 * parsing logic, same as before.
 *
 * One real change, found by testing against a live feed through
 * `wrangler dev`, not by inspection: rss-parser's own `parseURL()` fetches
 * the URL internally via Node's classic `http`/`https.get()` client, and
 * Cloudflare's nodejs_compat polyfill genuinely does not implement that API
 * ("[unenv] https.get is not implemented yet!") — no compatibility_date
 * fixes this, it's a real gap, not a version issue. rss-parser's
 * `parseString()` does no network I/O of its own though, so this fetches
 * the feed XML with the standard fetch() (already proven to work
 * everywhere else in this backend) and hands the raw text to
 * parseString() instead — same RSS/Atom parsing logic, none of the broken
 * HTTP client path.
 */
import Parser from "rss-parser";
import { cleanText, stripHtml } from "./normalize.js";

export interface FeedEntry {
  title: string;
  link: string;
  summary: string;
  /** Raw date string as the feed reported it — normalize.ts turns this into a Date. */
  publishedRaw: string | null;
}

const parser = new Parser();
const FEED_FETCH_TIMEOUT_MS = 15_000;

/** Fetches and parses a single RSS/Atom feed URL into a flat list of entries. */
export async function parseFeed(feedUrl: string, limit = 30): Promise<FeedEntry[]> {
  const res = await fetch(feedUrl, { signal: AbortSignal.timeout(FEED_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`feed fetch failed: HTTP ${res.status} ${res.statusText}`);
  const xml = await res.text();

  const feed = await parser.parseString(xml);
  const entries: FeedEntry[] = [];

  for (const item of feed.items.slice(0, limit)) {
    const title = cleanText(item.title);
    const link = (item.link || "").trim();
    if (!title || !link) continue;

    // Deliberately no `|| title` fallback here — a feed item with no real
    // description should leave `summary` empty so pipeline.ts's enrichment
    // step (fetch the article page's own OG/JSON-LD description or body
    // text) can fill it with real content, rather than the title silently
    // masquerading as a description for the rest of the pipeline.
    const summary = stripHtml(item.contentSnippet || item.content || item.summary || "").slice(0, 500);

    entries.push({
      title,
      link,
      summary,
      publishedRaw: item.isoDate || item.pubDate || null,
    });
  }

  return entries;
}
