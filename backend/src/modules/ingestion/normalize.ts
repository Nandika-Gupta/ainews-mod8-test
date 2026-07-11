/**
 * URL/date/text normalization utilities. Ported verbatim from the old
 * ainews-mod8 app's ingestion/normalize.ts — pure string/URL logic, no
 * Workers-specific concerns at all.
 */

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "fbclid",
  "gclid",
]);

/**
 * Canonicalizes an article URL: forces https, strips "www.", removes
 * tracking query params, collapses duplicate slashes, drops a trailing
 * slash. This is the value stored as News.articleUrl and is what makes
 * duplicate-detection across crawls reliable.
 */
export function normalizeUrl(value: string, baseUrl?: string): string | null {
  if (!value) return null;
  let raw = value.trim();

  if (raw.startsWith("//")) raw = `https:${raw}`;
  if (raw.startsWith("/") && baseUrl) raw = new URL(raw, baseUrl).toString();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  for (const key of Array.from(url.searchParams.keys())) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }

  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  let result = url.toString();
  if (result.length > 1 && result.endsWith("/") && !url.search) {
    result = result.slice(0, -1);
  }
  return result;
}

/** Registrable domain with no "www." prefix and no scheme — used to match a Publisher. */
export function domainFromUrl(value: string): string | null {
  const normalized = normalizeUrl(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).hostname;
  } catch {
    return null;
  }
}

/** Fixes the mis-encoded smart quotes/dashes that show up from badly-decoded scrapes. */
export function cleanText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"')
    .replace(/â€”/g, "—")
    .replace(/â€“/g, "–")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strips any HTML tags a feed's <description>/<content:encoded> may contain, leaving plain text. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return cleanText(html.replace(/<[^>]*>/g, " "));
}

const RELATIVE_TIME_RE = /(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/i;

/**
 * Parses whatever date shape a feed or JSON-LD blob gives us (RFC-822, ISO
 * 8601, or a relative "N hours ago" string) into a real Date. Returns null
 * rather than guessing when the input can't be parsed at all.
 */
export function robustParseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  const relative = RELATIVE_TIME_RE.exec(value);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const msPerUnit: Record<string, number> = {
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
      month: 2_592_000_000,
      year: 31_536_000_000,
    };
    return new Date(Date.now() - amount * (msPerUnit[unit] ?? 0));
  }

  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Word-token set for fuzzy title comparison — lowercased, punctuation
 * stripped, short/stopword-length tokens (<=2 chars) dropped.
 */
export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2)
  );
}

/**
 * Jaccard similarity between two token sets — a cheap stand-in for fuzzy
 * title-matching, used to catch the same story reported by two different
 * publishers under slightly different headlines (different articleUrl, so
 * exact-URL dedup misses it).
 */
export function titleSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Turns a display name / headline into a URL-safe slug. */
export function slugify(value: string, maxLength = 96): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (slug || "article").slice(0, maxLength);
}
