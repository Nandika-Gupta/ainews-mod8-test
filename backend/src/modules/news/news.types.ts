// Mirrors types/news.ts from the old ainews-mod8 Next.js app — the frontend
// port will consume these exact shapes, so field names must not drift.

export interface NewsSource {
  name: string;
  domain: string;
  color: string;
  followers: string;
  logoUrl: string | null;
}

export interface NewsCategory {
  key: string;
  label: string;
  count: number;
}

export interface NewsFilterChip {
  id: string;
  label: string;
}

export interface NewsArticleRecord {
  id: string;
  headline: string;
  dek: string;
  aiSummary: string;
  articleUrl: string;
  category: string;
  topics: string[];
  source: string;
  hours: number;
  up: number;
  down: number;
  filters: string[];
}

export interface NewsArticleDTO extends NewsArticleRecord {
  score: number;
}
