// Match predictions to the gold set (mvp.md §5 step 4). Semantic equivalence is
// decided by an LLM judge (token overlap is too brittle for paraphrased
// commitments); a deterministic token-overlap judge backs the `--mock` path.
//
// Matching is done ONCE here, independent of confidence threshold. The metrics
// layer then sweeps thresholds over these raw matches cheaply.
import type OpenAI from "openai";
import { z } from "zod";
import { addUsage, type ChatUsage, chatJSON, emptyUsage, mapConcurrent } from "../llm/chat.ts";
import { judgeModel, reasoningEffort } from "../llm/openrouter.ts";
import type { CaptureEvent, GoldCommitment, PredictionRecord } from "../types.ts";

export interface RawMatch {
  prediction_id: string;
  matched_gold_id: string | null;
  person_correct: boolean;
  due_date_correct: boolean | "no_date";
  reason: string;
}

const judgeJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    matched_gold_id: { type: "string" },
    person_correct: { type: "boolean" },
    due_date_match: { type: "string", enum: ["yes", "no", "no_date"] },
    reason: { type: "string" },
  },
  required: ["matched_gold_id", "person_correct", "due_date_match", "reason"],
} as const;

const JudgeZ = z.object({
  matched_gold_id: z.string(),
  person_correct: z.boolean(),
  due_date_match: z.enum(["yes", "no", "no_date"]),
  reason: z.string(),
});

const JUDGE_SYSTEM = `You grade a commitment extractor against a human gold set.

Given one PREDICTED commitment and a numbered list of CANDIDATE gold commitments (the ground
truth, all from the same conversation), decide which candidate — if any — is the SAME underlying
commitment. "Same" means the same action, same direction (who owes whom), and the same
counterparty, even if the wording differs.

Return JSON with:
- matched_gold_id: the id of the matching candidate, or "" if none is the same commitment.
- person_correct: true if the predicted person refers to the same counterparty as the matched gold's person (true if the gold has no person).
- due_date_match: "no_date" if the matched gold has no due date; otherwise "yes" if the predicted due date is the same calendar day as the gold's, else "no".
- reason: one short sentence.

If matched_gold_id is "", set person_correct=false and due_date_match="no".`;

function judgeUserPrompt(pred: PredictionRecord, candidates: GoldCommitment[]): string {
  const cand = candidates
    .map(
      (g) =>
        `- id=${g.id} | direction=${g.direction} | person=${g.person ?? "(none)"} | due_date=${g.due_date ?? "(none)"} | "${g.statement}"`,
    )
    .join("\n");
  return (
    `PREDICTED commitment:\n` +
    `direction=${pred.direction} | person=${pred.person ?? "(none)"} | due_date=${pred.due_date ?? "(none)"} | "${pred.statement}"\n\n` +
    `CANDIDATE gold commitments:\n${cand}\n`
  );
}

// ---- candidate generation ----

function eventThreadMap(events: CaptureEvent[]): Map<string, string> {
  return new Map(events.map((e) => [e.id, e.thread_id ?? e.id]));
}

function candidatesFor(pred: PredictionRecord, gold: GoldCommitment[], threadOf: Map<string, string>): GoldCommitment[] {
  const predEvents = new Set([pred.primary_event_id, ...pred.source_event_ids]);
  const predThreads = new Set([...predEvents].map((id) => threadOf.get(id) ?? id));
  return gold.filter((g) => {
    if (g.direction !== pred.direction) return false;
    if (g.source_event_ids.some((id) => predEvents.has(id))) return true;
    return g.source_event_ids.some((id) => predThreads.has(threadOf.get(id) ?? id));
  });
}

// ---- deterministic mock judge ----

const STOP = new Set("a an the to for of and or i ill i'll you your we they them it that this will would also get back".split(" "));
function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
function sameDay(a?: string, b?: string): boolean {
  return !!a && !!b && a.slice(0, 10) === b.slice(0, 10);
}
function personMatch(a?: string, b?: string): boolean {
  if (!b) return true;
  if (!a) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.includes(y) || y.includes(x) || x.split(" ")[0] === y.split(" ")[0];
}

function mockJudge(pred: PredictionRecord, candidates: GoldCommitment[]): RawMatch {
  let best: GoldCommitment | undefined;
  let bestScore = 0;
  const pt = tokens(pred.statement);
  for (const g of candidates) {
    const score = jaccard(pt, tokens(g.statement));
    if (score > bestScore) {
      bestScore = score;
      best = g;
    }
  }
  if (!best || bestScore < 0.1) {
    return { prediction_id: pred.prediction_id, matched_gold_id: null, person_correct: false, due_date_correct: false, reason: "mock: no candidate above overlap threshold" };
  }
  return {
    prediction_id: pred.prediction_id,
    matched_gold_id: best.id,
    person_correct: personMatch(pred.person, best.person),
    due_date_correct: !best.due_date ? "no_date" : sameDay(pred.due_date, best.due_date),
    reason: `mock: token overlap ${bestScore.toFixed(2)}`,
  };
}

// ---- public API ----

export interface MatchOpts {
  mock: boolean;
  client?: OpenAI;
  model?: string;
  concurrency?: number;
  log?: (m: string) => void;
}

export async function matchAll(
  predictions: PredictionRecord[],
  gold: GoldCommitment[],
  events: CaptureEvent[],
  opts: MatchOpts,
): Promise<RawMatch[]> {
  const threadOf = eventThreadMap(events);
  const withCands = predictions.map((p) => ({ pred: p, candidates: candidatesFor(p, gold, threadOf) }));

  // Predictions with no candidate are immediate false positives — no judge needed.
  const noCand: RawMatch[] = withCands
    .filter((w) => w.candidates.length === 0)
    .map((w) => ({ prediction_id: w.pred.prediction_id, matched_gold_id: null, person_correct: false, due_date_correct: false, reason: "no candidate gold in same thread/direction" }));
  const toJudge = withCands.filter((w) => w.candidates.length > 0);

  if (opts.mock) {
    return [...noCand, ...toJudge.map((w) => mockJudge(w.pred, w.candidates))];
  }

  const client = opts.client;
  if (!client) throw new Error("matchAll: client required when mock=false");
  const model = opts.model ?? judgeModel();
  const usage: ChatUsage = emptyUsage();

  const judged = await mapConcurrent(toJudge, opts.concurrency ?? 6, async (w): Promise<RawMatch> => {
    const r = await chatJSON(client, {
      model,
      system: JUDGE_SYSTEM,
      user: judgeUserPrompt(w.pred, w.candidates),
      schemaName: "judge",
      schema: judgeJsonSchema as Record<string, unknown>,
      maxTokens: 2048,
      reasoningEffort: reasoningEffort(),
    });
    addUsage(usage, r.usage);
    if (!r.ok) {
      return { prediction_id: w.pred.prediction_id, matched_gold_id: null, person_correct: false, due_date_correct: false, reason: `judge error: ${r.error}` };
    }
    try {
      const j = JudgeZ.parse(JSON.parse(r.text));
      const matched = j.matched_gold_id && gold.some((g) => g.id === j.matched_gold_id) ? j.matched_gold_id : null;
      return {
        prediction_id: w.pred.prediction_id,
        matched_gold_id: matched,
        person_correct: matched ? j.person_correct : false,
        due_date_correct: !matched ? false : j.due_date_match === "no_date" ? "no_date" : j.due_date_match === "yes",
        reason: j.reason,
      };
    } catch (err) {
      return { prediction_id: w.pred.prediction_id, matched_gold_id: null, person_correct: false, due_date_correct: false, reason: `judge parse error: ${(err as Error).message}` };
    }
  });

  opts.log?.(`Judge (${model}): $${usage.cost_usd.toFixed(4)} (${usage.input_tokens} in / ${usage.output_tokens} out tokens)`);
  return [...noCand, ...judged];
}
