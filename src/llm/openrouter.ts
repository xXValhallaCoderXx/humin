// OpenRouter is the chat gateway: one OpenAI-compatible API, many models, routed
// per role. Models are configurable so different stages can use different models
// (mvp.md leaves the model open; Phase 0 just needs a capable extractor + judge).
//
// NOTE: embeddings are NOT available via OpenRouter — those go direct to a
// provider; see ./embeddings.ts.
import OpenAI from "openai";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function makeChatClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to .env (see .env.example), or run with --mock.");
  }
  return new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    // Optional OpenRouter attribution headers (used for their dashboards/rankings).
    defaultHeaders: {
      "X-Title": "Humin",
      ...(process.env.HUMIN_APP_URL ? { "HTTP-Referer": process.env.HUMIN_APP_URL } : {}),
    },
  });
}

// Per-role model slugs (use any id from https://openrouter.ai/models). Override
// per stage to orchestrate different models. Defaults are a reasonable starting
// point — confirm the exact slug for your account.
export const extractModel = (): string => process.env.HUMIN_EXTRACT_MODEL ?? "anthropic/claude-opus-4.8";
export const judgeModel = (): string => process.env.HUMIN_JUDGE_MODEL ?? "anthropic/claude-opus-4.8";

// Optional reasoning effort for reasoning-capable models ("low" | "medium" | "high").
// Ignored by models that don't support it. Unset by default.
export const reasoningEffort = (): string | undefined => process.env.HUMIN_REASONING_EFFORT || undefined;
