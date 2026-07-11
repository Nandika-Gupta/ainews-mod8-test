/**
 * Declarative registry of news feeds to crawl. Ported verbatim from the old
 * ainews-mod8 app's ingestion/sources.ts.
 *
 * `aiOnly: true` means the feed itself is already scoped to AI coverage (a
 * dedicated "/artificial-intelligence/" category feed) so every entry is
 * ingested. `aiOnly: false` means it's a general feed and each entry is
 * passed through isAiRelevant() first.
 *
 * Feed paths on publisher sites do drift over time — verify these still
 * resolve before relying on them; this list is a starting point, not a
 * guarantee.
 */
export interface FeedSource {
  name: string;
  feedUrl: string;
  category: string;
  aiOnly: boolean;
  /**
   * "feed" (default) means every entry's own domain IS this source (an RSS
   * feed's entries link back to the feed's own site), so `name` is a safe
   * publisher-name hint for a newly-discovered domain. "discovery" means
   * entries link to arbitrary OTHER sites (e.g. Hacker News discovery — see
   * hnDiscovery.ts) and `name` describes the discovery mechanism, not the
   * publisher, so it must never be used as a publisher-name hint.
   */
  kind?: "feed" | "discovery";
}

export const FEED_SOURCES: FeedSource[] = [
  {
    name: "TechCrunch AI",
    feedUrl: "https://techcrunch.com/category/artificial-intelligence/feed/",
    category: "research",
    aiOnly: true,
  },
  {
    name: "VentureBeat AI",
    feedUrl: "https://venturebeat.com/category/ai/feed/",
    category: "research",
    aiOnly: true,
  },
  {
    name: "Ars Technica",
    feedUrl: "https://feeds.arstechnica.com/arstechnica/index",
    category: "research",
    aiOnly: false,
  },
  {
    name: "MIT Technology Review",
    feedUrl: "https://www.technologyreview.com/feed/",
    category: "research",
    aiOnly: false,
  },
  {
    name: "Wired",
    feedUrl: "https://www.wired.com/feed/tag/ai/latest/rss",
    category: "research",
    aiOnly: true,
  },
  {
    name: "The Verge AI",
    feedUrl: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    category: "research",
    aiOnly: true,
  },
  {
    name: "The Register AI/ML",
    feedUrl: "https://www.theregister.com/software/ai_ml/headlines.atom",
    category: "research",
    aiOnly: true,
  },
  {
    name: "Nature (Machine Learning)",
    feedUrl: "https://www.nature.com/subjects/machine-learning.rss",
    category: "research",
    aiOnly: true,
  },
  {
    name: "SiliconANGLE AI",
    feedUrl: "https://siliconangle.com/category/ai/feed/",
    category: "research",
    aiOnly: true,
  },
  {
    name: "ZDNet AI",
    feedUrl: "https://www.zdnet.com/topic/artificial-intelligence/rss.xml",
    category: "research",
    aiOnly: true,
  },
  {
    name: "MarkTechPost",
    feedUrl: "https://www.marktechpost.com/feed/",
    category: "research",
    aiOnly: true,
  },
  {
    name: "KDnuggets",
    feedUrl: "https://www.kdnuggets.com/feed",
    category: "research",
    aiOnly: false,
  },
  {
    name: "The Guardian AI",
    feedUrl: "https://www.theguardian.com/technology/artificialintelligenceai/rss",
    category: "research",
    aiOnly: true,
  },
  {
    name: "Google AI Blog",
    feedUrl: "https://blog.google/technology/ai/rss/",
    category: "research",
    aiOnly: true,
  },
  {
    name: "TechRadar AI",
    feedUrl: "https://www.techradar.com/feeds/tag/artificial-intelligence",
    category: "research",
    aiOnly: true,
  },
  {
    name: "Fast Company Tech",
    feedUrl: "https://www.fastcompany.com/technology/rss",
    category: "research",
    aiOnly: false,
  },
  {
    name: "Import AI",
    feedUrl: "https://importai.substack.com/feed",
    category: "research",
    aiOnly: true,
  },
  {
    name: "The Gradient",
    feedUrl: "https://thegradient.pub/rss/",
    category: "research",
    aiOnly: true,
  },
  {
    name: "Analytics Vidhya",
    feedUrl: "https://www.analyticsvidhya.com/feed/",
    category: "research",
    aiOnly: false,
  },
];
