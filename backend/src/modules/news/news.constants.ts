// Duplicated from the old app's ingestion/topicTagging.ts (GENERIC_TOPIC_FALLBACK,
// COMPANY_TOPIC_LABELS) until the RSS ingestion module is ported over — that
// port should make this module import from the shared ingestion constants
// instead of keeping its own copy.

export const GENERIC_TOPIC_FALLBACK = "AI";

export const COMPANY_TOPIC_LABELS = new Set([
  "OpenAI",
  "Anthropic",
  "Google DeepMind",
  "Meta AI",
  "Microsoft",
  "NVIDIA",
  "Mistral AI",
  "Hugging Face",
  "Perplexity",
]);
