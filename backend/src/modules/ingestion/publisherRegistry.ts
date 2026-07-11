/**
 * Publisher (news OUTLET) resolution and creation. Ported from the old
 * ainews-mod8 app's ingestion/publisherRegistry.ts.
 *
 * The Publisher is whoever wrote/published the article — its logo is
 * resolved and cached ONCE here, then reused by every future article from
 * that domain. The company mentioned in an article's title is never a logo
 * source.
 *
 * One deliberate difference from the old app: `prisma` is passed in rather
 * than imported as a module-level singleton, since this backend creates a
 * PrismaClient per request/invocation via the Neon adapter (see index.ts),
 * not a shared process-lifetime instance the way the old Next.js app could.
 *
 * resolveLogo() below now takes an R2Bucket — the real logo-download tier
 * (logoResolver.ts) is back in the mix, storing to R2 instead of the old
 * app's local disk.
 */
import type { PrismaClient } from "@prisma/client";
import type { R2Bucket } from "@cloudflare/workers-types";
import { SOURCE_LOGOS } from "./sourceLogos.js";
import { resolvePublisherLogo } from "./logoResolver.js";

/**
 * Hand-curated display metadata for well-known publishers, so a domain we
 * already recognize gets its real name/color/bundled logo instead of a
 * guessed one. Auto-discovered domains not in this list still get a
 * Publisher row — just with a guessed display name and a favicon-resolved
 * logo instead (see resolveLogo below).
 */
const KNOWN_BY_DOMAIN: Record<string, { sourceKey: string; name: string; color: string; followers: string }> = {
  "openai.com": { sourceKey: "openai", name: "OpenAI", color: "#10A37F", followers: "3.2M" },
  "anthropic.com": { sourceKey: "anthropic", name: "Anthropic", color: "#D97757", followers: "1.8M" },
  "deepmind.google": { sourceKey: "google", name: "Google DeepMind", color: "#4285F4", followers: "4.5M" },
  "ai.meta.com": { sourceKey: "meta", name: "Meta AI", color: "#0866FF", followers: "2.9M" },
  "nvidia.com": { sourceKey: "nvidia", name: "NVIDIA", color: "#76B900", followers: "2.1M" },
  "microsoft.com": { sourceKey: "microsoft", name: "Microsoft", color: "#00A4EF", followers: "3.6M" },
  "huggingface.co": { sourceKey: "huggingface", name: "Hugging Face", color: "#FFD21E", followers: "890K" },
  "mistral.ai": { sourceKey: "mistralai", name: "Mistral AI", color: "#FF7000", followers: "640K" },
  "perplexity.ai": { sourceKey: "perplexity", name: "Perplexity", color: "#20808D", followers: "410K" },
  "reuters.com": { sourceKey: "reuters", name: "Reuters", color: "#FF8000", followers: "2.1M" },
  "techcrunch.com": { sourceKey: "techcrunch", name: "TechCrunch", color: "#0ABF53", followers: "1.9M" },
  "theverge.com": { sourceKey: "theverge", name: "The Verge", color: "#7A5CFF", followers: "1.2M" },
  "bloomberg.com": { sourceKey: "bloomberg", name: "Bloomberg", color: "#3D7DFF", followers: "1.6M" },
  "technologyreview.com": { sourceKey: "mittr", name: "MIT Technology Review", color: "#E7413A", followers: "1.1M" },
  "venturebeat.com": { sourceKey: "venturebeat", name: "VentureBeat", color: "#E23B58", followers: "640K" },
  "theinformation.com": { sourceKey: "theinfo", name: "The Information", color: "#E86A4B", followers: "480K" },
  "arstechnica.com": { sourceKey: "arstechnica", name: "Ars Technica", color: "#FF4E00", followers: "820K" },
  "wired.com": { sourceKey: "wired", name: "Wired", color: "#12C2C2", followers: "1.4M" },
  "nature.com": { sourceKey: "nature", name: "Nature", color: "#3AA76D", followers: "900K" },
  "siliconangle.com": { sourceKey: "siliconangle", name: "SiliconANGLE", color: "#E0304F", followers: "210K" },
  "theregister.com": { sourceKey: "theregister", name: "The Register", color: "#F0483E", followers: "390K" },
  "zdnet.com": { sourceKey: "zdnet", name: "ZDNet", color: "#E1341E", followers: "560K" },
  "marktechpost.com": { sourceKey: "marktechpost", name: "MarkTechPost", color: "#2F6FED", followers: "180K" },
  "kdnuggets.com": { sourceKey: "kdnuggets", name: "KDnuggets", color: "#E4A426", followers: "220K" },
  "theguardian.com": { sourceKey: "guardian", name: "The Guardian", color: "#052962", followers: "1.5M" },
  "blog.google": { sourceKey: "googleblog", name: "Google AI Blog", color: "#4285F4", followers: "2.4M" },
  "techradar.com": { sourceKey: "techradar", name: "TechRadar", color: "#E71D36", followers: "650K" },
  "fastcompany.com": { sourceKey: "fastcompany", name: "Fast Company", color: "#000000", followers: "790K" },
  "importai.substack.com": { sourceKey: "importai", name: "Import AI", color: "#FF6719", followers: "95K" },
  "thegradient.pub": { sourceKey: "thegradient", name: "The Gradient", color: "#6C63FF", followers: "60K" },
  "analyticsvidhya.com": { sourceKey: "analyticsvidhya", name: "Analytics Vidhya", color: "#1A73E8", followers: "310K" },
};

function guessDisplayName(domain: string): string {
  const label = domain.split(".")[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Resolves a publisher's logo at creation time:
 *   1. A bundled brand SVG, if this is a known source (SOURCE_LOGOS) — cheap,
 *      no network call, so this is checked before the real download tier.
 *   2. Otherwise, if an R2 bucket is available, the real resolver
 *      (logoResolver.ts): fetch the domain's homepage, parse <head> icon
 *      links + manifest, download the highest-resolution one, and store it
 *      in R2.
 *   3. Falls back to a live favicon/aggregator URL if the download
 *      genuinely fails (network error, no icons found, known
 *      bot-protected domain) — or if no bucket was given at all, which
 *      happens when this runs as a plain Node script outside Workers (see
 *      scripts/ingest.ts) with no R2 binding to reach. Same degradation
 *      the whole pipeline used before R2 was wired up. Publisher creation
 *      never hard-fails either way.
 * The result is stored on the Publisher row — never re-resolved per article.
 */
async function resolveLogo(bucket: R2Bucket | undefined, domain: string, sourceKey?: string): Promise<{ logoUrl: string; faviconUrl: string }> {
  const faviconUrl = `https://${domain}/favicon.ico`;

  const bundled = sourceKey ? SOURCE_LOGOS[sourceKey] : undefined;
  if (bundled) return { logoUrl: `/logos/${bundled}`, faviconUrl };

  if (bucket) {
    const downloaded = await resolvePublisherLogo(bucket, domain);
    if (downloaded) return { logoUrl: downloaded, faviconUrl };
  }

  return { logoUrl: `https://www.google.com/s2/favicons?domain=${domain}&sz=128`, faviconUrl };
}

/**
 * Finds the Publisher for a given article domain, creating it on first sight.
 * `nameHint` lets a caller pass a feed's own site name (e.g. from RSS
 * `<title>` or OpenGraph `og:site_name`) when the domain isn't one we
 * already know about.
 */
export async function resolvePublisher(prisma: PrismaClient, bucket: R2Bucket | undefined, domain: string, nameHint?: string | null) {
  const existing = await prisma.publisher.findUnique({ where: { domain } });
  if (existing) return existing;

  const known = KNOWN_BY_DOMAIN[domain];
  const { logoUrl, faviconUrl } = await resolveLogo(bucket, domain, known?.sourceKey);

  return prisma.publisher.create({
    data: {
      name: known?.name ?? cleanNameHint(nameHint) ?? guessDisplayName(domain),
      domain,
      website: `https://${domain}`,
      logoUrl,
      faviconUrl,
      colorHex: known?.color ?? null,
      followersLabel: known?.followers ?? null,
      // Auto-discovered publishers start slightly less trusted than the
      // hand-curated seed list until proven out over multiple crawls.
      credibilityScore: known ? 0.85 : 0.7,
    },
  });
}

function cleanNameHint(nameHint?: string | null): string | null {
  if (!nameHint) return null;
  const trimmed = nameHint.trim();
  return trimmed.length > 0 && trimmed.length < 80 ? trimmed : null;
}
