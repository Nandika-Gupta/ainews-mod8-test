/**
 * Centralized source-key -> bundled logo filename mapping, ported verbatim
 * from the old ainews-mod8 app's lib/data/sourceLogos.ts. The actual SVG
 * files live in the Next.js frontend's public/logos/ — this module only
 * needs the filename to build the `/logos/<file>` path stored on
 * Publisher.logoUrl. Carrying the physical SVG files over is a frontend-port
 * concern, not a backend one; the path stored here is correct regardless of
 * when that happens.
 */
export const SOURCE_LOGOS: Record<string, string> = {
  openai: "openai.svg",
  anthropic: "anthropic.svg",
  google: "google.svg",
  meta: "meta.svg",
  nvidia: "nvidia.svg",
  microsoft: "microsoft.svg",
  huggingface: "huggingface.svg",
  mistralai: "mistralai.svg",
  perplexity: "perplexity.svg",
  techcrunch: "techcrunch.svg",
  arstechnica: "arstechnica.svg",
  theregister: "theregister.svg",
};
