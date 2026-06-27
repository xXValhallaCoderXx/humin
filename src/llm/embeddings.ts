// Embeddings go DIRECT to a provider — OpenRouter does not serve an embeddings
// endpoint. This is the ready seam for when Phase 1 needs vectors (e.g. semantic
// cross-source dedup, mvp.md §10). Phase 0 does NOT call this yet.
//
// Configure independently of the OpenRouter chat client:
//   HUMIN_EMBED_API_KEY   — provider key (e.g. OpenAI, Voyage, Cohere)
//   HUMIN_EMBED_BASE_URL  — provider base URL (default OpenAI)
//   HUMIN_EMBED_MODEL     — embedding model id
import OpenAI from "openai";

export const embedModel = (): string => process.env.HUMIN_EMBED_MODEL ?? "text-embedding-3-small";

export function makeEmbeddingsClient(): OpenAI {
  const apiKey = process.env.HUMIN_EMBED_API_KEY;
  if (!apiKey) {
    throw new Error("HUMIN_EMBED_API_KEY is not set — embeddings use a direct provider, not OpenRouter.");
  }
  return new OpenAI({ apiKey, baseURL: process.env.HUMIN_EMBED_BASE_URL ?? "https://api.openai.com/v1" });
}

/** Embed texts via the direct provider. Returns one vector per input, in order. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = makeEmbeddingsClient();
  const res = await client.embeddings.create({ model: embedModel(), input: texts });
  return res.data.map((d) => d.embedding as number[]);
}
