/**
 * Structured-metadata extraction from a single article page's HTML — used
 * as a fallback when a publisher has no RSS feed, or to fill in gaps an RSS
 * entry didn't have (e.g. a missing publish date). Ported verbatim from the
 * old ainews-mod8 app's ingestion/metadataExtractor.ts.
 *
 * Pure cheerio/JSON-LD/OpenGraph parsing over an HTML string the caller
 * already fetched — no network calls of its own, no Node built-ins beyond
 * what cheerio itself needs. No Workers-specific concerns.
 */
import * as cheerio from "cheerio";
import { cleanText } from "./normalize.js";

export interface ExtractedArticleMetadata {
  headline: string | null;
  description: string | null;
  datePublished: string | null;
  authorName: string | null;
  publisherName: string | null;
  publisherLogoUrl: string | null;
  imageUrl: string | null;
  /** Plain-text excerpt of the actual article body — last-resort real content when there's no description at all (see pipeline.ts's summary fallback chain). */
  bodyExcerpt: string | null;
}

const BODY_EXCERPT_MAX_LENGTH = 600;
const MIN_PARAGRAPH_CHARS = 40;

/** Common real-article-body containers, most-specific first — narrows the search before falling back to the whole <article>/<main>/<body>. */
const CONTENT_SELECTORS = [
  '[itemprop="articleBody"]',
  ".article-body",
  ".article-content",
  ".entry-content",
  ".post-content",
  ".story-body",
  ".story-content",
  '[data-component="ArticleBody"]',
  "article",
  "main",
  "body",
];

/**
 * Plain-text excerpt of the page's main content. Two defenses against
 * pulling nav/menu/video-player chrome instead of the real article:
 *
 * 1. Removes obvious chrome elements before extracting anything.
 * 2. Extracts text from <p>/<li>/heading/<blockquote> elements specifically,
 *    joined with spaces, rather than every text node inside the container
 *    via .text() — real article prose is almost universally structured as
 *    paragraphs, while nav links/buttons/video-player labels typically
 *    aren't inside a <p> at all. This also fixes a second, related bug:
 *    cheerio's .text() concatenates sibling elements' text with NO
 *    separator, so "Markets" next to "Business" next to "Tech" becomes the
 *    single unbroken word "MarketsBusinessTech" — joining per-element text
 *    with spaces avoids that entirely.
 */
function extractBodyExcerpt(html: string): string | null {
  const $ = cheerio.load(html);
  $(
    "script, style, nav, header, footer, aside, noscript, svg, form, iframe, button, " +
      '.nav, .navigation, .menu, .breadcrumb, [role="navigation"], ' +
      ".social-share, .share-buttons, .related-articles, .newsletter-signup, " +
      ".video-player, .ad, .advertisement, .comments"
  ).remove();

  for (const selector of CONTENT_SELECTORS) {
    const container = $(selector).first();
    if (!container.length) continue;

    const paragraphs = container
      .find("p, li, h2, h3, h4, blockquote")
      .map((_, el) => cleanText($(el).text()))
      .get()
      .filter((t) => t.length >= MIN_PARAGRAPH_CHARS);

    if (paragraphs.length === 0) continue;

    const text = paragraphs.join(" ");
    return text.length > BODY_EXCERPT_MAX_LENGTH ? `${text.slice(0, BODY_EXCERPT_MAX_LENGTH)}…` : text;
  }

  return null;
}

function firstOf<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Parses every JSON-LD block on the page and returns the first NewsArticle-shaped one. */
function extractJsonLd(html: string): Record<string, unknown> | null {
  const $ = cheerio.load(html);
  const blocks = $('script[type="application/ld+json"]');

  for (const el of blocks.toArray()) {
    const raw = $(el).contents().text();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        const graph = (candidate as { "@graph"?: unknown[] })["@graph"];
        const pool = graph && Array.isArray(graph) ? graph : [candidate];
        for (const item of pool) {
          const type = (item as { "@type"?: string | string[] })["@type"];
          const types = Array.isArray(type) ? type : [type];
          if (types.some((t) => typeof t === "string" && /NewsArticle|Article|BlogPosting/i.test(t))) {
            return item as Record<string, unknown>;
          }
        }
      }
    } catch {
      // malformed JSON-LD on the page — skip this block, try the next one
      continue;
    }
  }
  return null;
}

function extractOpenGraph(html: string): Record<string, string> {
  const $ = cheerio.load(html);
  const og: Record<string, string> = {};
  $("meta[property^='og:'], meta[name^='article:'], meta[name='description']").each((_, el) => {
    const key = $(el).attr("property") || $(el).attr("name");
    const value = $(el).attr("content");
    if (key && value) og[key] = value;
  });
  return og;
}

export function extractArticleMetadata(html: string): ExtractedArticleMetadata {
  const jsonLd = extractJsonLd(html);
  const og = extractOpenGraph(html);

  const authorField = jsonLd?.author as { name?: string } | { name?: string }[] | string | undefined;
  const author = firstOf(Array.isArray(authorField) ? authorField : authorField ? [authorField] : []);
  const authorName = typeof author === "string" ? author : author?.name ?? null;

  const publisherField = jsonLd?.publisher as { name?: string; logo?: { url?: string } | string } | undefined;
  const publisherLogo =
    typeof publisherField?.logo === "string" ? publisherField.logo : publisherField?.logo?.url ?? null;

  return {
    headline: cleanText((jsonLd?.headline as string) || og["og:title"]) || null,
    description: cleanText((jsonLd?.description as string) || og["og:description"] || og["description"]) || null,
    datePublished: (jsonLd?.datePublished as string) || og["article:published_time"] || null,
    authorName: authorName ? cleanText(authorName) : null,
    publisherName: publisherField?.name ? cleanText(publisherField.name) : og["og:site_name"] || null,
    publisherLogoUrl: publisherLogo,
    imageUrl: (jsonLd?.image as string) || og["og:image"] || null,
    bodyExcerpt: extractBodyExcerpt(html),
  };
}
