/**
 * Zero-cost LLM summarization waterfall: Gemini free tier -> Groq free tier
 * -> Pollinations.ai (no key needed, always available). Ported from the old
 * ainews-mod8 app's ingestion/llmSummarizer.ts — same three tiers, same
 * per-tier IntervalGate pacing, same JSON-mode request shapes, same "429
 * triggers fallback" behavior, same markdown-code-fence stripping before
 * JSON.parse.
 *
 * The one real change from the original: API keys and the debug flag are
 * passed in explicitly (see SummarizerKeys) instead of read from
 * `process.env`. Workers has no ambient process.env populated with your
 * bindings/secrets — even with nodejs_compat on, that only polyfills
 * node:* built-ins, it doesn't auto-copy env into process.env — and the
 * caller (the ingestion pipeline, when that's ported) already has the keys
 * from its own `env` parameter, so threading them through here is more
 * correct anyway, not just a Workers workaround.
 *
 * Everything else — the gates, the waterfall, the fetch() calls, the prompt
 * — is unchanged from the original. See the original file's history for why
 * these specific numbers were picked:
 * - Gemini: exact RPM unconfirmed (no static free-tier table published),
 *   paced conservatively at ~13.3 req/min.
 * - Groq (llama-3.1-8b-instant): confirmed 6K TPM is the binding limit, not
 *   the 30 RPM headline number — paced to ~7.5 req/min assuming ~800
 *   tokens/request worst case.
 * - Pollinations.ai: confirmed 1 request per 15s per IP for anonymous/no-key
 *   use — paced with a 500ms margin for clock/network jitter.
 */

const GEMINI_MODEL = "gemini-flash-lite-latest";
const GROQ_MODEL = "llama-3.1-8b-instant";
const REQUEST_TIMEOUT_MS = 20_000;
// A single pass through all 3 tiers, not a repeated full waterfall — see the
// original file's note: retrying the full waterfall again 1.5s later rarely
// changes the outcome for a genuine failure and mostly just doubles
// worst-case latency.
const WATERFALL_RETRIES = 1;

/**
 * Serializes calls with a minimum spacing between them — a proper per-tier
 * rate limiter, unlike a plain concurrency cap (see Semaphore below), which
 * only bounds how many calls are in flight at once and says nothing about
 * how *frequently* a single provider gets hit. Acquisitions are chained
 * through a promise queue so callers are served in order, each waiting out
 * whatever's left of the minimum interval since the last acquisition.
 */
class IntervalGate {
  private nextAvailableAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly minIntervalMs: number) {}

  acquire(): Promise<void> {
    const turn = this.queue.then(async () => {
      const wait = this.nextAvailableAt - Date.now();
      if (wait > 0) await sleep(wait);
      this.nextAvailableAt = Date.now() + this.minIntervalMs;
    });
    // Swallow rejections in the chain itself so one failed wait doesn't
    // wedge every caller queued behind it — callers still see their own
    // turn's promise (which never rejects; sleep() can't throw).
    this.queue = turn.catch(() => {});
    return turn;
  }
}

// ~13.3 req/min — deliberately conservative given the exact Gemini free-tier
// RPM couldn't be confirmed.
const GEMINI_MIN_INTERVAL_MS = 4500;
// ~7.5 req/min — paced to the confirmed 6K TPM budget, not the higher 30 RPM
// headline number.
const GROQ_MIN_INTERVAL_MS = 8000;
// Confirmed 1 req/15s per IP; +500ms margin for clock/network jitter.
const POLLINATIONS_MIN_INTERVAL_MS = 15_500;

const geminiGate = new IntervalGate(GEMINI_MIN_INTERVAL_MS);
const groqGate = new IntervalGate(GROQ_MIN_INTERVAL_MS);
const pollinationsGate = new IntervalGate(POLLINATIONS_MIN_INTERVAL_MS);

function debugLog(enabled: boolean, msg: string): void {
  if (enabled) console.log(`  [llm-debug] ${msg}`);
}

/**
 * A GLOBAL concurrency gate across every call into this module, not just a
 * per-source one — bounds how many articles are mid-summarization (and how
 * many open HTTP connections/timers exist) at once. The per-tier
 * IntervalGates above are what actually keep each provider's real-world
 * rate limit from being violated; this cap is a secondary backstop against
 * an unbounded pile-up of pending waterfall attempts.
 */
class Semaphore {
  private available: number;
  private readonly queue: (() => void)[] = [];

  constructor(count: number) {
    this.available = count;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.available--;
        resolve();
      });
    });
  }

  release(): void {
    this.available++;
    const next = this.queue.shift();
    if (next) next();
  }
}

const GLOBAL_LLM_CONCURRENCY = 4;
const llmGate = new Semaphore(GLOBAL_LLM_CONCURRENCY);

interface WaterfallResult {
  result: Record<string, unknown> | null;
}

const FAILED: WaterfallResult = { result: null };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strips a ```json ... ``` or ``` ... ``` wrapper some models add despite being asked for raw JSON. */
function stripMarkdownFence(text: string): string {
  let t = text.trim();
  if (t.startsWith("```json")) t = t.slice(7);
  else if (t.startsWith("```")) t = t.slice(3);
  if (t.endsWith("```")) t = t.slice(0, -3);
  return t.trim();
}

function safeParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stripMarkdownFence(text));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Tier 1: Gemini free tier. */
async function tryGemini(prompt: string, apiKey: string, debug: boolean): Promise<WaterfallResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json", maxOutputTokens: MAX_COMPLETION_TOKENS },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 429) {
      debugLog(debug, `Gemini -> 429 rate limited`);
      return FAILED;
    }
    if (!res.ok) {
      debugLog(debug, `Gemini -> HTTP ${res.status} ${res.statusText}`);
      return FAILED;
    }

    const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") {
      debugLog(debug, `Gemini -> no text in response: ${JSON.stringify(data).slice(0, 200)}`);
      return FAILED;
    }
    const parsed = safeParseJson(text);
    debugLog(debug, `Gemini -> ${parsed ? "success" : `failed to parse JSON from: ${text.slice(0, 150)}`}`);
    return { result: parsed };
  } catch (err) {
    debugLog(debug, `Gemini -> exception: ${(err as Error).name}: ${(err as Error).message}`);
    return FAILED;
  }
}

/** Tier 2: Groq free tier — OpenAI-compatible chat completions API. */
async function tryGroq(prompt: string, apiKey: string, debug: boolean): Promise<WaterfallResult> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: MAX_COMPLETION_TOKENS,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 429) {
      debugLog(debug, `Groq -> 429 rate limited`);
      return FAILED;
    }
    if (!res.ok) {
      debugLog(debug, `Groq -> HTTP ${res.status} ${res.statusText}`);
      return FAILED;
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      debugLog(debug, `Groq -> no content in response: ${JSON.stringify(data).slice(0, 200)}`);
      return FAILED;
    }
    const parsed = safeParseJson(text);
    debugLog(debug, `Groq -> ${parsed ? "success" : `failed to parse JSON from: ${text.slice(0, 150)}`}`);
    return { result: parsed };
  } catch (err) {
    debugLog(debug, `Groq -> exception: ${(err as Error).name}: ${(err as Error).message}`);
    return FAILED;
  }
}

/** Tier 3: Pollinations.ai — free, public, no API key. Response body is the raw completion text, not a wrapped JSON envelope. */
async function tryPollinations(prompt: string, debug: boolean): Promise<WaterfallResult> {
  try {
    const res = await fetch("https://text.pollinations.ai/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }], model: "openai", jsonMode: true }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      debugLog(debug, `Pollinations -> HTTP ${res.status} ${res.statusText}`);
      return FAILED;
    }
    const text = await res.text();
    const parsed = safeParseJson(text);
    debugLog(debug, `Pollinations -> ${parsed ? "success" : `failed to parse JSON from: ${text.slice(0, 150)}`}`);
    return { result: parsed };
  } catch (err) {
    debugLog(debug, `Pollinations -> exception: ${(err as Error).name}: ${(err as Error).message}`);
    return FAILED;
  }
}

/** API keys and debug flag, threaded in explicitly from the caller's `env` — see the file header for why. */
export interface SummarizerKeys {
  geminiKey?: string;
  groqKey?: string;
  debug?: boolean;
}

/** Waterfall: Gemini -> Groq -> Pollinations, retried a couple of times with a short backoff between full passes. */
async function generateJsonGated(prompt: string, keys: SummarizerKeys): Promise<Record<string, unknown> | null> {
  const { geminiKey, groqKey, debug = false } = keys;
  debugLog(debug, `starting waterfall — GEMINI_API_KEY ${geminiKey ? "present" : "MISSING"}, GROQ_API_KEY ${groqKey ? "present" : "MISSING"}`);

  for (let attempt = 0; attempt < WATERFALL_RETRIES; attempt++) {
    if (geminiKey) {
      await geminiGate.acquire();
      const { result } = await tryGemini(prompt, geminiKey, debug);
      if (result) return result;
      // No extra ad-hoc backoff on a 429 here — geminiGate already enforces
      // real spacing between every Gemini call globally (including the
      // very next article's attempt), which supersedes a local per-call
      // sleep.
    } else {
      debugLog(debug, `skipping Gemini — no key`);
    }

    if (groqKey) {
      await groqGate.acquire();
      const { result } = await tryGroq(prompt, groqKey, debug);
      if (result) return result;
    } else {
      debugLog(debug, `skipping Groq — no key`);
    }

    await pollinationsGate.acquire();
    const { result } = await tryPollinations(prompt, debug);
    if (result) return result;

    if (attempt < WATERFALL_RETRIES - 1) await sleep(1500 * (attempt + 1));
  }

  debugLog(debug, `all tiers failed after ${WATERFALL_RETRIES} attempt(s)`);
  return null;
}

/**
 * Acquires a global concurrency slot (see llmGate above) before starting the
 * waterfall, and holds it for the whole attempt — including any rate-limit
 * backoff sleep — so at most GLOBAL_LLM_CONCURRENCY articles are ever
 * mid-summarization at once across the entire ingest run, regardless of how
 * many sources are running concurrently.
 */
async function generateJson(prompt: string, keys: SummarizerKeys): Promise<Record<string, unknown> | null> {
  await llmGate.acquire();
  try {
    return await generateJsonGated(prompt, keys);
  } finally {
    llmGate.release();
  }
}

// Every upstream source that can feed `description` into this prompt is
// *supposed* to already be length-bounded, except one: a fallback to a
// page's raw OG/JSON-LD meta description has no cap of its own — by
// convention those are short (~150-300 chars), but that's a web-author
// convention, not something enforced. The Groq TPM pacing above assumes a
// bounded worst-case prompt size, so truncating here — the one true
// chokepoint every source funnels through — is what actually makes that
// assumption hold.
const MAX_PROMPT_TITLE_CHARS = 200;
const MAX_PROMPT_SOURCE_CHARS = 600;
// Caps completion size on both Gemini and Groq — without this, Groq's TPM
// budget (which counts prompt + completion together) has no hard ceiling on
// the completion side. 250 tokens is generous headroom over a typical
// 100-180 token summary, keeping worst-case request size (prompt ~460
// tokens + completion 250 = ~710) comfortably under groqGate's 7.5 req/min *
// 800 token/request pacing budget.
const MAX_COMPLETION_TOKENS = 250;

function buildSummaryPrompt(title: string, description: string): string {
  const boundedTitle = title.slice(0, MAX_PROMPT_TITLE_CHARS);
  const boundedDescription = description.slice(0, MAX_PROMPT_SOURCE_CHARS);
  return `You are summarizing an AI industry news article for a news aggregator. Write a factual 4-5 sentence summary in your own words (do not just copy the input) based ONLY on the source text below — do not invent details, numbers, or claims that aren't in it. Capture what happened and why it matters to someone following AI news. Do not start with phrases like "This article discusses" or "The author explains", and do not repeat the title verbatim as a sentence.

Title: ${boundedTitle}
Source text: ${boundedDescription}

Respond with ONLY this JSON shape and nothing else: {"summary": "..."}`;
}

/**
 * Generates a real AI summary for an article via the free-tier waterfall.
 * Returns null (never throws) if every tier fails or no keys are configured
 * — callers should fall back to the RSS description, never block ingestion.
 */
export async function generateAiSummary(title: string, description: string, keys: SummarizerKeys = {}): Promise<string | null> {
  if (!title && !description) return null;

  const result = await generateJson(buildSummaryPrompt(title, description), keys);
  const summary = result?.summary;
  return typeof summary === "string" && summary.trim().length > 0 ? summary.trim() : null;
}
