// CLI: run the extractor over the capture events (mvp.md §5 step 3 / Workstream C).
//   pnpm run extract                       # real run via OpenRouter (needs OPENROUTER_API_KEY)
//   pnpm run extract -- --mock             # offline deterministic baseline (no API key)
//   pnpm run extract -- --model openai/gpt-5 --concurrency 8
//   pnpm run extract -- --limit 25         # smoke-test on the first 25 events
//   pnpm run extract -- --refresh          # ignore the checkpoint cache and recompute
//   pnpm run extract -- --no-cache         # don't read or write the cache
//
// Results are checkpointed per event, so a crash or rate-limit wall loses nothing —
// re-running resumes and skips events already done (keyed by model + prompt version).
import { mkdirSync, writeFileSync } from "node:fs";
import { loadEnv, optNum, optStr, parseArgs } from "../src/cli.ts";
import { addUsage, type ChatUsage, chatJSON, emptyUsage, mapConcurrent } from "../src/llm/chat.ts";
import { cachePath, readCache, writeCache } from "../src/llm/cache.ts";
import { extractModel, makeChatClient, reasoningEffort } from "../src/llm/openrouter.ts";
import { mockExtract } from "../src/extract/mock.ts";
import { buildUserPrompt, PROMPT_VERSION, SYSTEM_PROMPT } from "../src/extract/prompt.ts";
import { ExtractionResultZ, extractionJsonSchema } from "../src/extract/schema.ts";
import { loadCaptureEvents } from "../src/import/normalize.ts";
import { CAPTURE_EVENTS, EXTRACT_CACHE_DIR, PREDICTIONS_DIR } from "../src/paths.ts";
import type { CaptureEvent, ExtractedCommitment, PredictionRecord, PredictionRun } from "../src/types.ts";

const CONTEXT_LIMIT = 8;

interface CacheEntry {
  commitments: ExtractedCommitment[];
  usage: ChatUsage;
}
interface Outcome {
  target: CaptureEvent;
  commitments?: ExtractedCommitment[];
  usage: ChatUsage;
  ok: boolean;
  error?: string;
  cached: boolean;
}

loadEnv();
const args = parseArgs(process.argv.slice(2));
const mock = args.mock === true;
const limit = optNum(args, "limit", Infinity);
const concurrency = optNum(args, "concurrency", 6);
const model = optStr(args, "model") ?? extractModel();
const useCache = args["no-cache"] !== true;
const refresh = args.refresh === true;

const events = loadCaptureEvents(CAPTURE_EVENTS).slice(0, limit);
if (events.length === 0) {
  console.error(`No capture events at ${CAPTURE_EVENTS}. Run "pnpm run import" first.`);
  process.exit(1);
}
const founderLabel = (process.env.HUMIN_FOUNDER_IDENTITIES ?? "").split(",")[0]?.trim() ?? "";

// Build per-event context windows (prior messages in the same thread).
const byThread = new Map<string, CaptureEvent[]>();
for (const e of events) {
  const key = e.thread_id ?? e.id;
  let arr = byThread.get(key);
  if (!arr) {
    arr = [];
    byThread.set(key, arr);
  }
  arr.push(e);
}
const jobs: { target: CaptureEvent; context: CaptureEvent[] }[] = [];
for (const arr of byThread.values()) {
  arr.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  arr.forEach((target, i) => jobs.push({ target, context: arr.slice(Math.max(0, i - CONTEXT_LIMIT), i) }));
}

const records: PredictionRecord[] = [];
const usage: ChatUsage = emptyUsage();
let validJson = 0;
let invalidJson = 0;
let cached = 0;
let fresh = 0;

function pushCommitments(eventId: string, commitments: ExtractedCommitment[]): void {
  commitments.forEach((c, k) => {
    records.push({
      ...c,
      person: c.person?.trim() ? c.person.trim() : undefined,
      due_date: c.due_date?.trim() ? c.due_date.trim() : undefined,
      confidence: Math.max(0, Math.min(1, c.confidence)),
      source_event_ids: c.source_event_ids?.length ? c.source_event_ids : [eventId],
      prediction_id: `${eventId}-${k}`,
      primary_event_id: eventId,
    });
  });
}

if (mock) {
  console.log(`Extracting (MOCK) over ${jobs.length} event(s)…`);
  for (const { target } of jobs) {
    pushCommitments(target.id, mockExtract(target));
    validJson++;
  }
} else {
  const client = makeChatClient();
  console.log(
    `Extracting via OpenRouter (${model}) over ${jobs.length} event(s), concurrency ${concurrency}${useCache ? (refresh ? ", cache refresh" : ", cache on") : ", cache off"}…`,
  );
  const outcomes = await mapConcurrent(jobs, concurrency, async ({ target, context }): Promise<Outcome> => {
    const cpath = cachePath(EXTRACT_CACHE_DIR, model, PROMPT_VERSION, target.id);
    if (useCache && !refresh) {
      const hit = readCache<CacheEntry>(cpath);
      if (hit) return { target, commitments: hit.commitments, usage: emptyUsage(), ok: true, cached: true };
    }
    const r = await chatJSON(client, {
      model,
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(target, context, founderLabel),
      schemaName: "commitments",
      schema: extractionJsonSchema as Record<string, unknown>,
      maxTokens: 8192,
      reasoningEffort: reasoningEffort(),
    });
    if (!r.ok) return { target, usage: r.usage, ok: false, error: r.error, cached: false };
    try {
      const parsed = ExtractionResultZ.parse(JSON.parse(r.text));
      if (useCache) writeCache(cpath, { commitments: parsed.commitments, usage: r.usage } satisfies CacheEntry);
      return { target, commitments: parsed.commitments, usage: r.usage, ok: true, cached: false };
    } catch (err) {
      return { target, usage: r.usage, ok: false, error: `invalid JSON/schema — ${(err as Error).message}`, cached: false };
    }
  });
  for (const o of outcomes) {
    addUsage(usage, o.usage);
    if (!o.ok || !o.commitments) {
      invalidJson++;
      if (o.error) console.warn(`  ✗ ${o.target.id}: ${o.error}`);
      continue;
    }
    pushCommitments(o.target.id, o.commitments);
    validJson++;
    if (o.cached) cached++;
    else fresh++;
  }
}

const run: PredictionRun = {
  prompt_version: mock ? `${PROMPT_VERSION}-mock` : PROMPT_VERSION,
  model: mock ? "mock" : model,
  created_at: new Date().toISOString(),
  predictions: records,
  stats: {
    events_processed: jobs.length,
    valid_json: validJson,
    invalid_json: invalidJson,
    predictions_emitted: records.length,
    usage,
  },
};

const outPath = optStr(args, "out") ?? `${PREDICTIONS_DIR}/predictions.${run.prompt_version}.json`;
mkdirSync(PREDICTIONS_DIR, { recursive: true });
writeFileSync(outPath, JSON.stringify(run, null, 2) + "\n");

console.log(`\nExtracted ${records.length} commitment(s) from ${jobs.length} event(s).`);
if (mock) {
  console.log(`Valid JSON: ${validJson}/${validJson} (100.0%)  [target ≥99%]`);
} else {
  const freshCalls = fresh + invalidJson;
  const pct = freshCalls ? ((fresh / freshCalls) * 100).toFixed(1) : "100.0";
  console.log(`Events: ${fresh} fresh · ${cached} cached · ${invalidJson} failed`);
  console.log(`Valid JSON (fresh calls): ${fresh}/${freshCalls} (${pct}%)  [target ≥99%]`);
  console.log(`Cost: $${usage.cost_usd.toFixed(4)} (fresh only · ${usage.input_tokens} in / ${usage.output_tokens} out · ${model})`);
}
console.log(`Wrote ${outPath}`);
