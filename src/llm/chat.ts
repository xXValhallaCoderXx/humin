// Provider-agnostic JSON chat helper over the OpenAI-compatible API (OpenRouter).
// Requests strict json_schema structured output, falls back to json_object for
// models/providers that don't support strict schemas, retries transient errors,
// and reports token usage + USD cost (from OpenRouter's usage accounting).
import type OpenAI from "openai";

export interface ChatUsage {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface ChatJSONResult {
  ok: boolean;
  text: string;
  usage: ChatUsage;
  error?: string;
}

export const emptyUsage = (): ChatUsage => ({ input_tokens: 0, output_tokens: 0, cost_usd: 0 });

export function addUsage(acc: ChatUsage, u: ChatUsage): void {
  acc.input_tokens += u.input_tokens;
  acc.output_tokens += u.output_tokens;
  acc.cost_usd += u.cost_usd;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const statusOf = (e: unknown): number | undefined => (e as { status?: number } | null)?.status;

/** Provider-requested backoff from the Retry-After header (seconds), capped. */
function retryAfterMs(e: unknown): number | undefined {
  const h = (e as { headers?: unknown } | null)?.headers as
    | { get?: (k: string) => string | null }
    | Record<string, string>
    | undefined;
  const raw = typeof h?.get === "function" ? h.get("retry-after") : (h as Record<string, string> | undefined)?.["retry-after"];
  if (!raw) return undefined;
  const secs = Number(raw);
  return Number.isFinite(secs) ? Math.min(secs * 1000, 60_000) : undefined;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const s = statusOf(e);
      if (s !== undefined && s !== 429 && s < 500) throw e; // 4xx (except rate limit) → don't retry
      lastErr = e;
      // Respect Retry-After when the provider sends it; otherwise exponential backoff + jitter.
      await sleep(retryAfterMs(e) ?? 600 * 2 ** attempt + Math.floor(Math.random() * 250));
    }
  }
  throw lastErr;
}

function usageFrom(res: OpenAI.Chat.Completions.ChatCompletion): ChatUsage {
  const u = res.usage as { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined;
  return { input_tokens: u?.prompt_tokens ?? 0, output_tokens: u?.completion_tokens ?? 0, cost_usd: u?.cost ?? 0 };
}

export interface ChatJSONOpts {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  reasoningEffort?: string;
}

/** One JSON chat call. Never throws — per-item failures come back as { ok:false, error }. */
export async function chatJSON(client: OpenAI, opts: ChatJSONOpts): Promise<ChatJSONResult> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  const base: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model: opts.model,
    messages,
    max_tokens: opts.maxTokens ?? 4096,
    response_format: { type: "json_schema", json_schema: { name: opts.schemaName, strict: true, schema: opts.schema } },
  };
  // OpenRouter extras not present in the OpenAI types: cost accounting + optional reasoning.
  (base as unknown as Record<string, unknown>).usage = { include: true };
  if (opts.reasoningEffort) (base as unknown as Record<string, unknown>).reasoning = { effort: opts.reasoningEffort };

  const run = (p: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming) =>
    withRetry(() => client.chat.completions.create(p));

  try {
    let res: OpenAI.Chat.Completions.ChatCompletion;
    try {
      res = await run(base);
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      if (statusOf(e) === 400 && /json[_ ]?schema|response_format|structured|not support/i.test(msg)) {
        // Model/provider doesn't support strict json_schema — fall back to json_object.
        const fb = { ...base, response_format: { type: "json_object" } } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
        res = await run(fb);
      } else {
        throw e;
      }
    }
    const text = res.choices[0]?.message?.content ?? "";
    return { ok: text.trim().length > 0, text, usage: usageFrom(res), error: text.trim() ? undefined : "empty response" };
  } catch (e) {
    return { ok: false, text: "", usage: emptyUsage(), error: `${statusOf(e) ?? ""} ${(e as Error)?.message ?? String(e)}`.trim() };
  }
}

/** Run `fn` over `items` with bounded concurrency, preserving input order. */
export async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, worker));
  return out;
}
