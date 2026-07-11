/**
 * Lightweight keyword-based topic tagging. Ported verbatim from the old
 * ainews-mod8 app's ingestion/topicTagging.ts — a deliberate, honest
 * stand-in for real NLP/LLM tagging: matches known AI entity/topic keywords
 * against the title+summary and returns whichever match, falling back to a
 * generic "AI" tag. No model call, no chunking, just a word-boundary regex.
 */
const KNOWN_TOPICS: { label: string; pattern: RegExp; kind: "company" | "theme" }[] = [
  { label: "OpenAI", pattern: /\bopenai\b/i, kind: "company" },
  { label: "Anthropic", pattern: /\banthropic|claude\b/i, kind: "company" },
  { label: "Google DeepMind", pattern: /\bgoogle deepmind|deepmind|gemini\b/i, kind: "company" },
  { label: "Meta AI", pattern: /\bmeta ai|llama\b/i, kind: "company" },
  { label: "Microsoft", pattern: /\bmicrosoft|copilot\b/i, kind: "company" },
  { label: "NVIDIA", pattern: /\bnvidia\b/i, kind: "company" },
  { label: "Mistral AI", pattern: /\bmistral\b/i, kind: "company" },
  { label: "Hugging Face", pattern: /\bhugging face\b/i, kind: "company" },
  { label: "Perplexity", pattern: /\bperplexity\b/i, kind: "company" },
  { label: "AI Regulation", pattern: /\bregulation|ai act|policy\b/i, kind: "theme" },
  { label: "Funding", pattern: /\bfunding|raises|valuation|series [a-e]\b/i, kind: "theme" },
  { label: "Robotics", pattern: /\brobot|robotics|humanoid\b/i, kind: "theme" },
  { label: "Open Source", pattern: /\bopen[- ]source|open[- ]weight\b/i, kind: "theme" },
  { label: "Model Release", pattern: /\bmodel|release|launch/i, kind: "theme" },
];

/** Generic fallback when no keyword matches — never a real topical category, always excluded from anything presented as a filter/chip. */
export const GENERIC_TOPIC_FALLBACK = "AI";

/**
 * Topic labels that name a single company (OpenAI, Anthropic, ...) rather than
 * a genuine theme (Funding, Robotics, ...). Naming one company in a filter
 * chip on a general AI news aggregator reads as favoritism, so anything that
 * builds a chip/filter list from real topic data should exclude these — see
 * news.services.ts's getFilterChips().
 */
export const COMPANY_TOPIC_LABELS = new Set(KNOWN_TOPICS.filter((t) => t.kind === "company").map((t) => t.label));

export function deriveTopics(title: string, summary: string): string[] {
  const text = `${title} ${summary}`;
  const matched = KNOWN_TOPICS.filter((t) => t.pattern.test(text)).map((t) => t.label);
  return matched.length > 0 ? matched.slice(0, 4) : [GENERIC_TOPIC_FALLBACK];
}

const AI_RELEVANCE_RE =
  /\b(ai|a\.i\.|llm|llms|gpt|chatgpt|claude|gemini|deepseek|openai|anthropic|machine learning|generative ai|artificial intelligence|neural network|transformer|robotics|fine-tuning|inference|vllm|hugging face)\b/i;

/** Used to filter a publisher's general feed down to AI-relevant items. */
export function isAiRelevant(title: string, summary: string): boolean {
  return AI_RELEVANCE_RE.test(`${title} ${summary}`);
}
